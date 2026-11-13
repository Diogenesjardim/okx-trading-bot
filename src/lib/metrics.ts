import type { Trade } from '../types';

export interface Stats {
  initialCapital: number;
  balance: number;
  pnl: number;
  pnlPct: number;
  count: number;
  wins: number;
  losses: number;
  winRate: number | null;
  maxLoss: number | null;
  maxDrawdownPct: number;
  maxDrawdownAbs: number;
  totalFees: number;
  profitFactor: number | null;
  grossPnl: number; // soma antes de taxas/slippage de saída
  maxLossStreak: number;
  maxWinStreak: number;
  maxWin: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  expectancy: number | null; // resultado líquido médio por operação
  equityCurve: { n: number; label: string; equity: number }[];
}

export function computeStats(trades: Trade[], initialCapital: number): Stats {
  const sorted = [...trades].sort((a, b) => a.exitTime - b.exitTime);
  let equity = initialCapital;
  let peak = initialCapital;
  let ddPct = 0;
  let ddAbs = 0;
  let grossWin = 0;
  let grossLoss = 0;
  const curve: Stats['equityCurve'] = [{ n: 0, label: 'Início', equity: initialCapital }];
  sorted.forEach((t, idx) => {
    equity += t.pnl;
    if (t.pnl > 0) grossWin += t.pnl;
    else grossLoss += -t.pnl;
    peak = Math.max(peak, equity);
    const dd = peak - equity;
    ddAbs = Math.max(ddAbs, dd);
    if (peak > 0) ddPct = Math.max(ddPct, (dd / peak) * 100);
    curve.push({ n: idx + 1, label: `#${idx + 1}`, equity });
  });
  let streakL = 0, streakW = 0, maxL = 0, maxW = 0;
  for (const t of sorted) {
    if (t.pnl > 0) { streakW++; streakL = 0; } else { streakL++; streakW = 0; }
    maxL = Math.max(maxL, streakL);
    maxW = Math.max(maxW, streakW);
  }
  const winVals = sorted.filter((t) => t.pnl > 0).map((t) => t.pnl);
  const lossVals = sorted.filter((t) => t.pnl <= 0).map((t) => t.pnl);
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const wins = sorted.filter((t) => t.pnl > 0).length;
  const losses = sorted.length - wins;
  const lossesOnly = sorted.filter((t) => t.pnl <= 0).map((t) => t.pnl);
  return {
    initialCapital,
    balance: equity,
    pnl: equity - initialCapital,
    pnlPct: initialCapital > 0 ? ((equity - initialCapital) / initialCapital) * 100 : 0,
    count: sorted.length,
    wins,
    losses,
    winRate: sorted.length ? (wins / sorted.length) * 100 : null,
    maxLoss: lossesOnly.length ? Math.min(...lossesOnly) : null,
    maxDrawdownPct: ddPct,
    maxDrawdownAbs: ddAbs,
    totalFees: sorted.reduce((s, t) => s + t.fees, 0),
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : null,
    equityCurve: curve,
    grossPnl: sorted.reduce((acc, t) => acc + (t.grossPnl ?? t.pnl + t.fees), 0),
    maxLossStreak: maxL,
    maxWinStreak: maxW,
    maxWin: winVals.length ? Math.max(...winVals) : null,
    avgWin: avg(winVals),
    avgLoss: avg(lossVals),
    expectancy: avg(sorted.map((t) => t.pnl)),
  };
}
