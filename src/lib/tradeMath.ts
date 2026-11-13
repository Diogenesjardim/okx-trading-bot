import type { ExitReason, InstId, Position, Side, StrategyConfig, Timeframe, Trade } from '../types';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/** Preço com slippage desfavorável. */
export function withSlippage(price: number, side: Side, action: 'entry' | 'exit', slippagePct: number) {
  const s = slippagePct / 100;
  const buying = (side === 'LONG' && action === 'entry') || (side === 'SHORT' && action === 'exit');
  return buying ? price * (1 + s) : price * (1 - s);
}

export function openPosition(args: {
  instId: InstId;
  timeframe: Timeframe;
  side: Side;
  rawPrice: number;
  time: number;
  equity: number;
  cfg: Pick<StrategyConfig, 'positionSizePct' | 'slippagePct' | 'leverage' | 'feePct' | 'stopLossPct' | 'takeProfitPct'>;
  signalCandleTs: number;
  signalId?: string;
}): Position | null {
  const { cfg, side } = args;
  const margin = args.equity * (cfg.positionSizePct / 100);
  if (!(margin > 0)) return null;
  const entry = withSlippage(args.rawPrice, side, 'entry', cfg.slippagePct);
  const notional = margin * cfg.leverage;
  const qty = notional / entry;
  const sl = cfg.stopLossPct / 100;
  const tp = cfg.takeProfitPct / 100;
  return {
    id: uid(),
    instId: args.instId,
    timeframe: args.timeframe,
    side,
    entryTime: args.time,
    entryPrice: entry,
    qty,
    margin,
    leverage: cfg.leverage,
    entryFee: notional * (cfg.feePct / 100),
    stopPrice: side === 'LONG' ? entry * (1 - sl) : entry * (1 + sl),
    takePrice: side === 'LONG' ? entry * (1 + tp) : entry * (1 - tp),
    signalCandleTs: args.signalCandleTs,
    signalId: args.signalId,
  };
}

/** PnL bruto (sem taxas) a um preço. */
export function grossPnl(pos: Position, price: number) {
  const dir = pos.side === 'LONG' ? 1 : -1;
  return (price - pos.entryPrice) * pos.qty * dir;
}

export function closePosition(
  pos: Position,
  rawPrice: number,
  time: number,
  reason: ExitReason,
  cfg: Pick<StrategyConfig, 'feePct' | 'slippagePct'>,
): Trade {
  const exit = withSlippage(rawPrice, pos.side, 'exit', cfg.slippagePct);
  const exitFee = exit * pos.qty * (cfg.feePct / 100);
  const fees = pos.entryFee + exitFee;
  const gross = grossPnl(pos, exit);
  let pnl = gross - fees;
  let exitReason = reason;
  // Na simulação a perda máxima é a margem alocada (aproximação de liquidação).
  if (pnl < -pos.margin) {
    pnl = -pos.margin;
    exitReason = 'Liquidação simulada';
  }
  return {
    id: pos.id,
    instId: pos.instId,
    timeframe: pos.timeframe,
    side: pos.side,
    entryTime: pos.entryTime,
    exitTime: time,
    entryPrice: pos.entryPrice,
    exitPrice: exit,
    qty: pos.qty,
    margin: pos.margin,
    leverage: pos.leverage,
    fees,
    grossPnl: gross,
    pnl,
    signalId: pos.signalId,
    pnlPctMargin: (pnl / pos.margin) * 100,
    exitReason,
  };
}
