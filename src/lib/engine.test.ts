import { describe, expect, it } from 'vitest';
import type { Candle } from '../types';
import { crossAt, rsi, sma } from './indicators';
import { runBacktest, type BacktestConfig } from './backtest';
import { computeStats } from './metrics';

const H = 3_600_000;
const mk = (closes: number[], opts: Partial<Candle>[] = []): Candle[] =>
  closes.map((c, i) => ({
    ts: i * H, open: i ? closes[i - 1] : c, high: Math.max(c, i ? closes[i - 1] : c) * 1.001,
    low: Math.min(c, i ? closes[i - 1] : c) * 0.999, close: c, volume: 1, confirmed: true, ...opts[i],
  }));

// 25 candles caindo, depois subida forte → cruzamento de alta
const down = Array.from({ length: 25 }, (_, i) => 100 - i * 0.5);
const up = Array.from({ length: 10 }, (_, i) => 88 + (i + 1) * 2);

const cfg: BacktestConfig = {
  instId: 'ETH-USDT', timeframe: '1H', initialCapital: 100, leverage: 1, stopLossPct: 50, takeProfitPct: 200,
  positionSizePct: 100, feePct: 0, slippagePct: 0, rsiFilter: false, exitOnOppositeCross: true,
};

describe('indicadores', () => {
  it('SMA', () => {
    expect(sma([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5]);
  });
  it('RSI só alta = 100', () => {
    const r = rsi(Array.from({ length: 20 }, (_, i) => i + 1), 14);
    expect(r[14]).toBe(100);
    expect(r[13]).toBeNull();
  });
  it('cruzamento', () => {
    expect(crossAt([1, 3], [2, 2], 1)).toBe('UP');
    expect(crossAt([3, 1], [2, 2], 1)).toBe('DOWN');
    expect(crossAt([3, 4], [2, 2], 1)).toBeNull();
  });
});

describe('backtest', () => {
  it('entra na abertura do candle seguinte ao cruzamento', () => {
    const candles = mk([...down, ...up]);
    const s9 = sma(candles.map((c) => c.close), 9);
    const s21 = sma(candles.map((c) => c.close), 21);
    let crossIdx = -1;
    for (let i = 1; i < candles.length; i++) if (crossAt(s9, s21, i) === 'UP') { crossIdx = i; break; }
    expect(crossIdx).toBeGreaterThan(0);
    const r = runBacktest(candles, cfg);
    expect(r.trades.length).toBe(1);
    expect(r.trades[0].side).toBe('LONG');
    expect(r.trades[0].entryTime).toBe(candles[crossIdx + 1].ts);
    expect(r.trades[0].entryPrice).toBe(candles[crossIdx + 1].open);
    expect(r.trades[0].exitReason).toBe('Fim do período');
  });

  it('SL e TP no mesmo candle → assume Stop Loss', () => {
    const closes = [...down, ...up];
    const candles = mk(closes);
    const r0 = runBacktest(candles, cfg);
    const entryIdx = candles.findIndex((c) => c.ts === r0.trades[0].entryTime);
    // candle de entrada com amplitude enorme (bate SL e TP)
    candles[entryIdx] = { ...candles[entryIdx], high: candles[entryIdx].open * 2, low: candles[entryIdx].open * 0.5 };
    const r = runBacktest(candles, { ...cfg, stopLossPct: 5, takeProfitPct: 5 });
    expect(r.trades[0].exitReason).toBe('Stop Loss');
    expect(r.trades[0].pnl).toBeLessThan(0);
  });

  it('taxas reduzem o resultado', () => {
    const candles = mk([...down, ...up]);
    const a = runBacktest(candles, cfg);
    const b = runBacktest(candles, { ...cfg, feePct: 0.1, slippagePct: 0.05 });
    expect(b.stats.pnl).toBeLessThan(a.stats.pnl);
    expect(b.trades[0].fees).toBeGreaterThan(0);
  });

  it('não usa dados futuros: alterar candles depois do sinal não muda a entrada', () => {
    const base = mk([...down, ...up]);
    const r1 = runBacktest(base, cfg);
    const changed = base.map((c, i) => (c.ts > r1.trades[0].entryTime ? { ...c, close: c.close * 3, high: c.high * 3 } : c));
    const r2 = runBacktest(changed, { ...cfg });
    expect(r2.trades[0].entryTime).toBe(r1.trades[0].entryTime);
    expect(r2.trades[0].entryPrice).toBe(r1.trades[0].entryPrice);
  });
});

describe('métricas', () => {
  it('drawdown', () => {
    const t = (pnl: number, i: number) => ({ id: String(i), instId: 'ETH-USDT' as const, timeframe: '1H' as const, side: 'LONG' as const, entryTime: i, exitTime: i, entryPrice: 1, exitPrice: 1, qty: 1, margin: 10, leverage: 1, fees: 0, pnl, pnlPctMargin: 0, exitReason: 'Stop Loss' as const });
    const s = computeStats([t(10, 1), t(-22, 2), t(5, 3)], 100);
    expect(s.balance).toBe(93);
    expect(s.maxDrawdownAbs).toBe(22);
    expect(s.maxDrawdownPct).toBeCloseTo(20);
    expect(s.maxLoss).toBe(-22);
    expect(s.winRate).toBeCloseTo(66.67, 1);
    expect(s.maxLossStreak).toBe(1);
    const s2 = computeStats([t(-1, 1), t(-1, 2), t(-1, 3), t(5, 4), t(-1, 5)], 100);
    expect(s2.maxLossStreak).toBe(3);
    expect(s2.maxWinStreak).toBe(1);
    expect(s2.expectancy).toBeCloseTo(0.2);
    expect(s2.grossPnl).toBeCloseTo(1); // sem grossPnl informado e taxas 0 → bruto = líquido
  });
});
