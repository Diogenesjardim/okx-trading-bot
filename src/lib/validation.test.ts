import { describe, expect, it } from 'vitest';
import type { Candle } from '../types';
import { runBacktest, type BacktestConfig } from './backtest';
import { backtestWindow, buyAndHold, randomBacktest, rng, validate, WARMUP } from './validation';

const H = 3_600_000;
/** Série sintética oscilante (gera cruzamentos) com tendência leve. */
function series(n: number, drift = 0): Candle[] {
  const out: Candle[] = [];
  let prev = 100;
  for (let i = 0; i < n; i++) {
    const c = 100 + drift * i + 6 * Math.sin(i / 7) + 2 * Math.sin(i / 2.3);
    out.push({ ts: i * H, open: prev, high: Math.max(prev, c) * 1.002, low: Math.min(prev, c) * 0.998, close: c, volume: 1, confirmed: true });
    prev = c;
  }
  return out;
}

const cfg: BacktestConfig = {
  instId: 'ETH-USDT', timeframe: '1H', initialCapital: 100, leverage: 1, stopLossPct: 2, takeProfitPct: 4,
  positionSizePct: 100, feePct: 0.05, slippagePct: 0.02, rsiFilter: false, exitOnOppositeCross: true,
};

describe('validação', () => {
  it('backtestWindow só opera dentro da janela (aquecimento não gera operações)', () => {
    const cs = series(400);
    const r = backtestWindow(cs, 200, 300, cfg);
    expect(r.trades.length).toBeGreaterThan(0);
    for (const t of r.trades) {
      expect(t.entryTime).toBeGreaterThan(cs[200].ts);
      expect(t.exitTime).toBeLessThanOrEqual(cs[299].ts);
    }
    expect(r.candleCount).toBe(100);
  });

  it('janela com tradeFromTs não altera operações posteriores do backtest completo', () => {
    const cs = series(400);
    const full = runBacktest(cs, cfg);
    const late = runBacktest(cs, { ...cfg, tradeFromTs: cs[0].ts });
    expect(late.trades.map((t) => t.entryTime)).toEqual(full.trades.map((t) => t.entryTime));
  });

  it('comprar e segurar: cálculo com taxas e slippage', () => {
    const cs = series(100, 0.5);
    const bh = buyAndHold(cs, 0, 100, { initialCapital: 100, feePct: 0, slippagePct: 0 });
    expect(bh.pnlPct).toBeCloseTo((cs[99].close / cs[0].open - 1) * 100);
    const withCosts = buyAndHold(cs, 0, 100, { initialCapital: 100, feePct: 0.1, slippagePct: 0.05 });
    expect(withCosts.pnl).toBeLessThan(bh.pnl);
  });

  it('entradas aleatórias são determinísticas pela semente', () => {
    const cs = series(500);
    const a = randomBacktest(cs, WARMUP, 500, cfg, { entryProb: 0.05, maxHoldBars: 10, seed: 42 });
    const b = randomBacktest(cs, WARMUP, 500, cfg, { entryProb: 0.05, maxHoldBars: 10, seed: 42 });
    const c = randomBacktest(cs, WARMUP, 500, cfg, { entryProb: 0.05, maxHoldBars: 10, seed: 43 });
    expect(a).toEqual(b);
    expect(a.trades).toBeGreaterThan(0);
    expect(c.pnl).not.toBe(a.pnl);
    const r = rng(1);
    for (let i = 0; i < 100; i++) {
      const x = r();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('validação completa: divisão treino/teste, janelas e veredito', () => {
    const cs = series(1000, 0.01);
    const v = validate(cs, cfg, { splitPct: 70, windows: 5, randomRuns: 50 });
    expect(v.windows).toHaveLength(5);
    expect(v.splitTs).toBeGreaterThan(v.firstTs);
    // nenhuma operação do treino entra depois do corte; nenhuma do teste antes
    v.inSample.trades.forEach((t) => expect(t.entryTime).toBeLessThan(v.splitTs + H));
    v.outSample.trades.forEach((t) => expect(t.entryTime).toBeGreaterThan(v.splitTs));
    expect(v.verdicts.length).toBeGreaterThanOrEqual(5);
    expect(['insuficiente', 'fraca', 'promissora']).toContain(v.summary);
    if (v.optimized) expect(v.optimized.best.trades).toBeGreaterThanOrEqual(5);
  });

  it('poucas operações → evidência insuficiente', () => {
    const cs = series(200);
    const v = validate(cs, { ...cfg, stopLossPct: 50, takeProfitPct: 200 }, { splitPct: 70, windows: 3, randomRuns: 20 });
    expect(v.full.trades.length).toBeLessThan(30);
    expect(v.summary).toBe('insuficiente');
  });

  it('recusa histórico curto', () => {
    expect(() => validate(series(100), cfg, { splitPct: 70, windows: 3 })).toThrow();
  });
});

describe('filtro de tendência', () => {
  it('reduz ou mantém o número de operações e exige aquecimento maior', async () => {
    const { warmupFor } = await import('./validation');
    const cs = series(800, 0.05); // tendência de alta
    const sem = runBacktest(cs, cfg);
    const com = runBacktest(cs, { ...cfg, trendFilter: true, trendPeriod: 200 });
    expect(com.trades.length).toBeLessThanOrEqual(sem.trades.length);
    // nenhuma operação antes de existir a SMA200
    com.trades.forEach((t) => expect(t.entryTime).toBeGreaterThan(cs[199].ts));
    expect(warmupFor({ trendFilter: true, trendPeriod: 200 })).toBeGreaterThanOrEqual(205);
    expect(warmupFor({ trendFilter: false })).toBe(WARMUP);
  });

  it('em tendência de alta forte, não abre SHORT', () => {
    const cs = series(800, 0.3);
    const com = runBacktest(cs, { ...cfg, trendFilter: true, trendPeriod: 200 });
    expect(com.trades.every((t) => t.side === 'LONG')).toBe(true);
  });
});

describe('modo só LONG (à vista)', () => {
  it('backtest nunca abre SHORT e força 1X', () => {
    const cs = series(600);
    const both = runBacktest(cs, { ...cfg, leverage: 3 });
    const long = runBacktest(cs, { ...cfg, leverage: 3, longOnly: true });
    expect(both.trades.some((t) => t.side === 'SHORT')).toBe(true);
    expect(long.trades.length).toBeGreaterThan(0);
    expect(long.trades.every((t) => t.side === 'LONG' && t.leverage === 1)).toBe(true);
  });
  it('referência aleatória também só compra', () => {
    const cs = series(500);
    const r = randomBacktest(cs, WARMUP, 500, { ...cfg, longOnly: true }, { entryProb: 0.05, maxHoldBars: 10, seed: 7 });
    expect(r.trades).toBeGreaterThan(0);
  });
});
