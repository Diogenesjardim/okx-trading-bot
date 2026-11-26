import { describe, expect, it } from 'vitest';
import type { Candle, InstId, Timeframe } from '../types';
import { analyzeStream } from './analystEngine';
import { runCycle, type CloudConfig } from './cloudCycle';

const H = 3_600_000;
const cfg: CloudConfig = {
  enabled: true,
  analyst: { instruments: ['ETH-USDT'], timeframes: ['1H'], rsiFilter: true, trendFilter: true, trendPeriod: 200 },
  sim: { allowedInst: ['ETH-USDT'], allowedTf: ['1H'], longOnly: true, leverage: 1, stopLossPct: 1.5, takeProfitPct: 3 },
  demo: { enabled: true, quote: 'USDT', orderValue: 100 },
};

/** Série de alta longa, correção e retomada: procura o 1º candle com LONG válido (acima da SMA200, RSI < 70). */
function buildSeries(): { candles: Candle[]; crossIdx: number } {
  const closes: number[] = [];
  for (let i = 0; i < 260; i++) closes.push(100 + i * 0.2 + Math.sin(i / 3) * 0.3);
  for (let i = 0; i < 25; i++) closes.push(closes[closes.length - 1] - 0.35);
  for (let i = 0; i < 25; i++) closes.push(closes[closes.length - 1] + 0.3);
  const t0 = 1_700_000_000_000;
  const candles = closes.map((c, i) => ({ ts: t0 + i * H, open: c, high: c + 0.1, low: c - 0.1, close: c, volume: 1, confirmed: true }));
  for (let n = 262; n <= candles.length; n++) {
    const r = analyzeStream({ instId: 'ETH-USDT', tf: '1H', candles: candles.slice(0, n), lastProcessedTs: candles[n - 2].ts, rsiFilter: true, trendFilter: true, trendPeriod: 200, risk: { stopLossPct: 1.5, takeProfitPct: 3 }, now: 0 });
    if (r.record?.side === 'LONG' && !r.record.blockedByTrend && !r.record.blockedByRsi) return { candles, crossIdx: n - 1 };
  }
  throw new Error('série sem cruzamento válido');
}

describe('runCycle (robô na nuvem)', () => {
  it('abre na Demo quando há LONG válido e fecha pelo Stop Loss reproduzido com candles de 5 min', async () => {
    const { candles, crossIdx } = buildSeries();
    const calls: { action: string; payload: Record<string, unknown> }[] = [];
    let view = candles.slice(0, crossIdx); // 1ª execução: candle do cruzamento ainda não fechou
    let price = view[view.length - 1].close;
    let now = view[view.length - 1].ts + H + 60_000;
    let fiveMin: Candle[] = [];
    const deps = {
      now: () => now,
      ticker: async (_: InstId) => price,
      candles: async (_: InstId, tf: Timeframe) => (tf === '5m' ? fiveMin : view),
      demo: async (action: 'open' | 'close', payload: Record<string, unknown>) => {
        calls.push({ action, payload });
        return action === 'open' ? { ordId: '1', instId: 'ETH-USDT', refPrice: price, stop: '1', take: '2' } : { message: 'Vendido.' };
      },
    };

    const r1 = await runCycle(null, cfg, deps);
    expect(r1.state.sim.position).toBeNull();
    expect(calls).toHaveLength(0);

    // 2ª execução: o candle do cruzamento fechou
    view = candles.slice(0, crossIdx + 1);
    price = view[view.length - 1].close;
    now = view[view.length - 1].ts + H + 5 * 60_000;
    const r2 = await runCycle(r1.state, cfg, deps);
    const pos = r2.state.sim.position!;
    expect(pos).toBeTruthy();
    expect(pos.side).toBe('LONG');
    expect(calls.map((c) => c.action)).toEqual(['open']);
    expect(calls[0].payload).toMatchObject({ instId: 'ETH-USDT', quote: 'USDT', orderValue: 100, ref: pos.signalId });

    // 3ª execução: num candle de 5 min o preço tocou o stop e voltou
    const t = now + 60_000;
    fiveMin = [{ ts: t, open: price, high: price, low: pos.stopPrice - 0.5, close: price, volume: 1, confirmed: true }];
    now = t + 5 * 60_000;
    const r3 = await runCycle(r2.state, cfg, deps);
    expect(r3.state.sim.position).toBeNull();
    expect(r3.state.sim.trades[0].exitReason).toBe('Stop Loss');
    expect(r3.state.sim.trades[0].exitPrice).toBeLessThan(pos.entryPrice);
    expect(calls.map((c) => c.action)).toEqual(['open', 'close']);

    // 4ª execução: nada se repete
    const r4 = await runCycle(r3.state, cfg, deps);
    expect(calls).toHaveLength(2);
    expect(r4.state.runs).toBe(4);
  });

  it('com enabled=false pausa o simulador e não abre posição', async () => {
    const { candles, crossIdx } = buildSeries();
    let view = candles.slice(0, crossIdx);
    let now = view[view.length - 1].ts + H + 60_000;
    const deps = { now: () => now, ticker: async () => view[view.length - 1].close, candles: async () => view };
    const r1 = await runCycle(null, { ...cfg, enabled: false }, deps);
    expect(r1.state.sim.mode).not.toBe('ATIVO');
    view = candles.slice(0, crossIdx + 1);
    now = view[view.length - 1].ts + H + 5 * 60_000;
    const r2 = await runCycle(r1.state, { ...cfg, enabled: false }, deps);
    expect(r2.state.sim.position).toBeNull();
  });
});
