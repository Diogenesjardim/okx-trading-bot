import type { Candle, Signal } from '../types';
import { crossAt, rsi, sma, type Cross, type Series } from './indicators';

export interface Indicators {
  closes: number[];
  sma9: Series;
  sma21: Series;
  rsi14: Series;
}

export function computeIndicators(candles: Candle[]): Indicators {
  const closes = candles.map((c) => c.close);
  return { closes, sma9: sma(closes, 9), sma21: sma(closes, 21), rsi14: rsi(closes, 14) };
}

export interface SignalResult {
  signal: Signal;
  cross: Cross;
  blockedByRsi: boolean;
}

/**
 * Estratégia SMA9/SMA21: só gera LONG/SHORT quando há um NOVO cruzamento no candle i.
 * Filtro RSI opcional: não compra com RSI ≥ 70 nem vende com RSI ≤ 30.
 */
export function signalAt(ind: Indicators, i: number, rsiFilter: boolean): SignalResult {
  const cross = crossAt(ind.sma9, ind.sma21, i);
  const r = ind.rsi14[i];
  if (cross === 'UP') {
    if (rsiFilter && r != null && r >= 70) return { signal: 'AGUARDAR', cross, blockedByRsi: true };
    return { signal: 'LONG', cross, blockedByRsi: false };
  }
  if (cross === 'DOWN') {
    if (rsiFilter && r != null && r <= 30) return { signal: 'AGUARDAR', cross, blockedByRsi: true };
    return { signal: 'SHORT', cross, blockedByRsi: false };
  }
  return { signal: 'AGUARDAR', cross: null, blockedByRsi: false };
}

export interface Analysis {
  closedCount: number;
  lastClosed: Candle | null;
  sma9: number | null;
  sma21: number | null;
  rsi: number | null;
  trend: 'alta' | 'baixa' | 'indefinida';
  signal: SignalResult;
  lastCross: { type: 'UP' | 'DOWN'; ts: number; barsAgo: number } | null;
}

/** Analisa apenas candles FECHADOS. */
export function analyze(allCandles: Candle[], rsiFilter: boolean): Analysis {
  const candles = allCandles.filter((c) => c.confirmed);
  const ind = computeIndicators(candles);
  const n = candles.length;
  const i = n - 1;
  let lastCross: Analysis['lastCross'] = null;
  for (let k = i; k >= 1; k--) {
    const c = crossAt(ind.sma9, ind.sma21, k);
    if (c) {
      lastCross = { type: c, ts: candles[k].ts, barsAgo: i - k };
      break;
    }
  }
  const s9 = i >= 0 ? ind.sma9[i] : null;
  const s21 = i >= 0 ? ind.sma21[i] : null;
  return {
    closedCount: n,
    lastClosed: n ? candles[i] : null,
    sma9: s9,
    sma21: s21,
    rsi: i >= 0 ? ind.rsi14[i] : null,
    trend: s9 == null || s21 == null ? 'indefinida' : s9 > s21 ? 'alta' : 'baixa',
    signal: n ? signalAt(ind, i, rsiFilter) : { signal: 'AGUARDAR', cross: null, blockedByRsi: false },
    lastCross,
  };
}
