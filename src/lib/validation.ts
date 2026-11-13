import { tfMs, type Candle, type Position, type Side } from '../types';
import { runBacktest, type BacktestConfig, type BacktestResult } from './backtest';
import { closePosition, openPosition } from './tradeMath';

/**
 * FASE 3 — Validação de estratégia.
 * Objetivo: medir se o resultado do backtest se sustenta fora do período em que foi ajustado,
 * em períodos diferentes e contra referências simples. Não prova lucratividade futura.
 */

export const WARMUP = 40; // candles de aquecimento para SMA21/RSI14

/** Aquecimento necessário: maior quando o filtro de tendência (SMA longa) está ligado. */
export const warmupFor = (cfg: Pick<BacktestConfig, 'trendFilter' | 'trendPeriod'>) =>
  cfg.trendFilter ? Math.max(WARMUP, (cfg.trendPeriod ?? 200) + 5) : WARMUP;

/** Backtest num intervalo [start, end) usando candles anteriores só como aquecimento. */
export function backtestWindow(candles: Candle[], start: number, end: number, cfg: BacktestConfig): BacktestResult {
  const from = Math.max(0, start - warmupFor(cfg));
  return runBacktest(candles.slice(from, end), { ...cfg, tradeFromTs: candles[start].ts });
}

// ---------- Compra e segura ----------

export interface BuyHold {
  pnl: number;
  pnlPct: number;
  entry: number;
  exit: number;
}

/** Compra no início do período (1X, 100% do capital), vende no fim. Com taxa e slippage. */
export function buyAndHold(candles: Candle[], start: number, end: number, cfg: Pick<BacktestConfig, 'initialCapital' | 'feePct' | 'slippagePct'>): BuyHold {
  const s = cfg.slippagePct / 100;
  const f = cfg.feePct / 100;
  const entry = candles[start].open * (1 + s);
  const exit = candles[end - 1].close * (1 - s);
  const qty = cfg.initialCapital / entry;
  const pnl = qty * (exit - entry) - cfg.initialCapital * f - exit * qty * f;
  return { pnl, pnlPct: (pnl / cfg.initialCapital) * 100, entry, exit };
}

// ---------- Entradas aleatórias (Monte Carlo) ----------

/** PRNG determinístico (mulberry32) — mesma semente, mesmo resultado (testável). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Estratégia de referência: entra em direção ALEATÓRIA com a mesma frequência média,
 * mesmo SL/TP, alavancagem, tamanho, taxas e slippage; sai por SL/TP ou após o tempo médio da estratégia.
 */
export function randomBacktest(candles: Candle[], start: number, end: number, cfg: BacktestConfig, opts: { entryProb: number; maxHoldBars: number; seed: number }) {
  const rand = rng(opts.seed);
  let equity = cfg.initialCapital;
  let pos: Position | null = null;
  let held = 0;
  let pending: Side | null = null;
  let trades = 0;
  for (let i = start; i < end; i++) {
    const c = candles[i];
    if (!pos && pending && equity > 0) {
      pos = openPosition({ instId: cfg.instId, timeframe: cfg.timeframe, side: pending, rawPrice: c.open, time: c.ts, equity, cfg, signalCandleTs: c.ts });
      held = 0;
      trades++;
    }
    pending = null;
    if (pos) {
      held++;
      const long = pos.side === 'LONG';
      const hitStop = long ? c.low <= pos.stopPrice : c.high >= pos.stopPrice;
      const hitTake = long ? c.high >= pos.takePrice : c.low <= pos.takePrice;
      let t = null;
      if (hitStop) t = closePosition(pos, long ? Math.min(pos.stopPrice, c.open) : Math.max(pos.stopPrice, c.open), c.ts, 'Stop Loss', cfg);
      else if (hitTake) t = closePosition(pos, pos.takePrice, c.ts, 'Take Profit', cfg);
      else if (held >= opts.maxHoldBars || i === end - 1) t = closePosition(pos, c.close, c.ts, 'Fim do período', cfg);
      if (t) {
        equity += t.pnl;
        pos = null;
      }
    }
    if (!pos && i < end - 1 && rand() < opts.entryProb) pending = rand() < 0.5 ? 'LONG' : 'SHORT';
  }
  return { pnl: equity - cfg.initialCapital, trades };
}

export interface RandomBenchmark {
  runs: number;
  median: number;
  p5: number;
  p95: number;
  pctPositive: number;
  /** % das simulações aleatórias que a estratégia superou (0–100). */
  strategyPercentile: number;
}

const quantile = (sorted: number[], q: number) => {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

export function randomBenchmark(candles: Candle[], start: number, end: number, cfg: BacktestConfig, strategy: BacktestResult, runs = 300): RandomBenchmark | null {
  const n = end - start;
  const bar = tfMs(cfg.timeframe);
  const trades = strategy.trades.length;
  if (!trades || n < 10) return null;
  const holdBars = strategy.trades.map((t) => Math.max(1, Math.round((t.exitTime - t.entryTime) / bar) + 1));
  const totalHold = holdBars.reduce((a, b) => a + b, 0);
  const avgHold = Math.max(1, Math.round(totalHold / trades));
  const entryProb = Math.min(1, trades / Math.max(1, n - totalHold));
  const results: number[] = [];
  for (let k = 1; k <= runs; k++) results.push(randomBacktest(candles, start, end, cfg, { entryProb, maxHoldBars: avgHold, seed: k * 7919 }).pnl);
  results.sort((a, b) => a - b);
  const beaten = results.filter((r) => r < strategy.stats.pnl).length;
  return {
    runs,
    median: quantile(results, 0.5),
    p5: quantile(results, 0.05),
    p95: quantile(results, 0.95),
    pctPositive: (results.filter((r) => r > 0).length / runs) * 100,
    strategyPercentile: (beaten / runs) * 100,
  };
}

// ---------- Otimização no período de treino ----------

export const GRID_SL = [1, 1.5, 2, 3];
export const GRID_TP = [2, 3, 4, 6];

export interface GridResult {
  stopLossPct: number;
  takeProfitPct: number;
  pnl: number;
  trades: number;
}

/** Testa combinações de SL/TP SOMENTE no período de treino e devolve a melhor (mín. 5 operações). */
export function optimizeInSample(candles: Candle[], start: number, end: number, cfg: BacktestConfig): { best: GridResult | null; all: GridResult[] } {
  const all: GridResult[] = [];
  for (const sl of GRID_SL)
    for (const tp of GRID_TP) {
      const r = backtestWindow(candles, start, end, { ...cfg, stopLossPct: sl, takeProfitPct: tp });
      all.push({ stopLossPct: sl, takeProfitPct: tp, pnl: r.stats.pnl, trades: r.trades.length });
    }
  const eligible = all.filter((g) => g.trades >= 5).sort((a, b) => b.pnl - a.pnl);
  return { best: eligible[0] ?? null, all };
}

// ---------- Validação completa ----------

export interface WindowRow {
  idx: number;
  from: number;
  to: number;
  trades: number;
  winRate: number | null;
  pnl: number;
  pnlPct: number;
  maxDD: number;
  buyHoldPct: number;
}

export interface Verdict {
  ok: boolean;
  text: string;
}

export interface ValidationResult {
  candleCount: number;
  firstTs: number;
  lastTs: number;
  splitTs: number;
  full: BacktestResult;
  inSample: BacktestResult;
  outSample: BacktestResult;
  optimized: { best: GridResult; inSample: BacktestResult; outSample: BacktestResult } | null;
  windows: WindowRow[];
  buyHold: BuyHold;
  buyHoldOut: BuyHold;
  random: RandomBenchmark | null;
  verdicts: Verdict[];
  summary: 'insuficiente' | 'fraca' | 'promissora';
}

export function validate(candles: Candle[], cfg: BacktestConfig, opts: { splitPct: number; windows: number; randomRuns?: number }): ValidationResult {
  const n = candles.length;
  const warm = warmupFor(cfg);
  if (n < warm + 100) throw new Error(`São necessários pelo menos ${warm + 100} candles para validar${cfg.trendFilter ? ' com o filtro de tendência' : ''}.`);
  const start = warm;
  const split = Math.floor(start + (n - start) * (opts.splitPct / 100));

  const full = backtestWindow(candles, start, n, cfg);
  const inSample = backtestWindow(candles, start, split, cfg);
  const outSample = backtestWindow(candles, split, n, cfg);

  const opt = optimizeInSample(candles, start, split, cfg);
  const optimized = opt.best
    ? {
        best: opt.best,
        inSample: backtestWindow(candles, start, split, { ...cfg, stopLossPct: opt.best.stopLossPct, takeProfitPct: opt.best.takeProfitPct }),
        outSample: backtestWindow(candles, split, n, { ...cfg, stopLossPct: opt.best.stopLossPct, takeProfitPct: opt.best.takeProfitPct }),
      }
    : null;

  const windows: WindowRow[] = [];
  const size = Math.floor((n - start) / opts.windows);
  for (let w = 0; w < opts.windows; w++) {
    const a = start + w * size;
    const b = w === opts.windows - 1 ? n : a + size;
    const r = backtestWindow(candles, a, b, cfg);
    windows.push({
      idx: w + 1, from: candles[a].ts, to: candles[b - 1].ts, trades: r.trades.length, winRate: r.stats.winRate,
      pnl: r.stats.pnl, pnlPct: r.stats.pnlPct, maxDD: r.stats.maxDrawdownPct, buyHoldPct: buyAndHold(candles, a, b, cfg).pnlPct,
    });
  }

  const buyHold = buyAndHold(candles, start, n, cfg);
  const buyHoldOut = buyAndHold(candles, split, n, cfg);
  const random = randomBenchmark(candles, start, n, cfg, full, opts.randomRuns ?? 300);

  // ----- Veredito (regras objetivas, conservadoras) -----
  const v: Verdict[] = [];
  const tr = full.trades.length;
  v.push(tr >= 30
    ? { ok: true, text: `Amostra de ${tr} operações (mínimo recomendado: 30).` }
    : { ok: false, text: `Apenas ${tr} operações — amostra pequena; qualquer resultado pode ser acaso.` });
  v.push(full.stats.pnl > 0
    ? { ok: true, text: `Resultado líquido positivo no período todo (após taxas e slippage).` }
    : { ok: false, text: `Resultado líquido negativo no período todo (após taxas e slippage).` });
  if (full.stats.grossPnl > 0 && full.stats.pnl <= 0) v.push({ ok: false, text: 'Lucrativa antes das taxas, negativa depois: os custos consomem a vantagem.' });
  v.push(outSample.stats.pnl > 0
    ? { ok: true, text: 'Manteve-se positiva no período de teste (fora da amostra).' }
    : { ok: false, text: 'Não se manteve positiva no período de teste (fora da amostra).' });
  if (optimized) {
    if (optimized.inSample.stats.pnl > 0 && optimized.outSample.stats.pnl <= 0)
      v.push({ ok: false, text: `Os melhores parâmetros do treino (SL ${optimized.best.stopLossPct}% / TP ${optimized.best.takeProfitPct}%) falharam no teste — sinal de sobreajuste.` });
    else if (optimized.outSample.stats.pnl > 0)
      v.push({ ok: true, text: `Os melhores parâmetros do treino também foram positivos no teste.` });
  }
  const posW = windows.filter((w) => w.pnl > 0).length;
  v.push(posW / windows.length >= 0.6
    ? { ok: true, text: `Positiva em ${posW} de ${windows.length} janelas de tempo.` }
    : { ok: false, text: `Positiva em apenas ${posW} de ${windows.length} janelas — inconsistente entre períodos.` });
  if (random) {
    v.push(random.strategyPercentile >= 90
      ? { ok: true, text: `Superou ${random.strategyPercentile.toFixed(0)}% das ${random.runs} simulações de entradas aleatórias.` }
      : { ok: false, text: `Superou só ${random.strategyPercentile.toFixed(0)}% das entradas aleatórias — não se distingue claramente do acaso (referência: ≥ 90%).` });
  }
  v.push(full.stats.pnl > buyHold.pnl
    ? { ok: true, text: `Superou “comprar e segurar” (${buyHold.pnlPct.toFixed(1)}%) no mesmo período.` }
    : { ok: false, text: `Ficou abaixo de “comprar e segurar” (${buyHold.pnlPct.toFixed(1)}%) no mesmo período.` });

  const fails = v.filter((x) => !x.ok).length;
  const summary: ValidationResult['summary'] = tr < 30 || full.stats.pnl <= 0 || outSample.stats.pnl <= 0 ? 'insuficiente' : fails > 0 ? 'fraca' : 'promissora';

  return {
    candleCount: n - start, firstTs: candles[start].ts, lastTs: candles[n - 1].ts, splitTs: candles[split].ts,
    full, inSample, outSample, optimized, windows, buyHold, buyHoldOut, random, verdicts: v, summary,
  };
}
