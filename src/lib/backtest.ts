import type { Candle, InstId, Position, Side, StrategyConfig, Timeframe, Trade } from '../types';
import { computeIndicators, signalAt } from './strategy';
import { closePosition, openPosition } from './tradeMath';
import { computeStats, type Stats } from './metrics';

export interface BacktestConfig extends StrategyConfig {
  instId: InstId;
  timeframe: Timeframe;
  initialCapital: number;
  /** Entradas só a partir deste candle (os anteriores servem de aquecimento dos indicadores). */
  tradeFromTs?: number;
}

export interface BacktestResult {
  trades: Trade[];
  stats: Stats;
  candleCount: number;
  firstTs: number | null;
  lastTs: number | null;
  signalsIgnored: number;
}

/**
 * Regras:
 * - Sinal confirmado no FECHAMENTO do candle i (indicadores só usam dados até i).
 * - Entrada/saída por cruzamento na ABERTURA do candle i+1.
 * - SL/TP verificados com máxima/mínima dos candles a partir da entrada.
 * - SL e TP no mesmo candle: assume SL (conservador).
 * - Gap além do stop: executa na abertura (pior preço).
 * - Uma posição por vez.
 */
export function runBacktest(candlesIn: Candle[], cfg: BacktestConfig): BacktestResult {
  const candles = candlesIn.filter((c) => c.confirmed);
  const ind = computeIndicators(candles);
  const trades: Trade[] = [];
  let equity = cfg.initialCapital;
  let pos: Position | null = null;
  let pendingEntry: { side: Side; signalTs: number } | null = null;
  let pendingExit = false;
  let signalsIgnored = 0;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];

    // 1) Execuções pendentes na abertura deste candle
    if (pos && pendingExit) {
      const t = closePosition(pos, c.open, c.ts, 'Cruzamento oposto', cfg);
      trades.push(t);
      equity += t.pnl;
      pos = null;
    }
    pendingExit = false;
    if (!pos && pendingEntry && equity > 0) {
      pos = openPosition({
        instId: cfg.instId, timeframe: cfg.timeframe, side: pendingEntry.side,
        rawPrice: c.open, time: c.ts, equity, cfg, signalCandleTs: pendingEntry.signalTs,
      });
    }
    pendingEntry = null;

    // 2) Stop Loss / Take Profit com máxima e mínima do candle
    if (pos) {
      const long = pos.side === 'LONG';
      const hitStop = long ? c.low <= pos.stopPrice : c.high >= pos.stopPrice;
      const hitTake = long ? c.high >= pos.takePrice : c.low <= pos.takePrice;
      if (hitStop) {
        const fill = long ? Math.min(pos.stopPrice, c.open) : Math.max(pos.stopPrice, c.open);
        const t = closePosition(pos, fill, c.ts, 'Stop Loss', cfg);
        trades.push(t);
        equity += t.pnl;
        pos = null;
      } else if (hitTake) {
        const t = closePosition(pos, pos.takePrice, c.ts, 'Take Profit', cfg);
        trades.push(t);
        equity += t.pnl;
        pos = null;
      }
    }

    // 3) Sinal no fechamento deste candle → executa no próximo
    if (i === candles.length - 1) break;
    const s = signalAt(ind, i, cfg.rsiFilter);
    if (s.cross) {
      if (pos) {
        const opposite = (pos.side === 'LONG' && s.cross === 'DOWN') || (pos.side === 'SHORT' && s.cross === 'UP');
        if (opposite && cfg.exitOnOppositeCross) pendingExit = true;
        else signalsIgnored++;
      }
      const allowed = cfg.tradeFromTs == null || c.ts >= cfg.tradeFromTs;
      if (allowed && s.signal !== 'AGUARDAR' && (!pos || pendingExit)) {
        pendingEntry = { side: s.signal, signalTs: c.ts };
      } else if (s.signal !== 'AGUARDAR' && pos) {
        // posição aberta sem saída por cruzamento: ignora o sinal
      }
    }
  }

  if (pos && candles.length) {
    const last = candles[candles.length - 1];
    const t = closePosition(pos, last.close, last.ts, 'Fim do período', cfg);
    trades.push(t);
    equity += t.pnl;
  }

  return {
    trades,
    stats: computeStats(trades, cfg.initialCapital),
    candleCount: cfg.tradeFromTs == null ? candles.length : candles.filter((c) => c.ts >= cfg.tradeFromTs!).length,
    firstTs: (cfg.tradeFromTs == null ? candles[0] : candles.find((c) => c.ts >= cfg.tradeFromTs!))?.ts ?? null,
    lastTs: candles[candles.length - 1]?.ts ?? null,
    signalsIgnored,
  };
}
