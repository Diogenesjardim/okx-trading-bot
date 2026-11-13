import { useState } from 'react';
import { BarChart3, Copy, Download, PieChart as PieIcon, TrendingUp } from 'lucide-react';
import type { Trade } from '../types';
import type { Stats } from '../lib/metrics';
import { fmtNum, fmtPct, fmtSignedUSD, fmtUSD, pnlColor } from '../lib/format';
import { downloadText, tradesToCsv } from '../lib/csv';
import { Card, Empty, Stat } from './ui';
import { EquityChart, PnlBars, WinLossPie } from './Charts';

export function StatsGrid({ stats, label = 'Saldo atual (fictício)' }: { stats: Stats; label?: string }) {
  const costs = stats.grossPnl - stats.pnl;
  return (
    <div className="space-y-2">
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Stat label="Saldo inicial" value={fmtUSD(stats.initialCapital)} />
      <Stat label={label} value={fmtUSD(stats.balance)} valueClass={pnlColor(stats.pnl)} />
      <Stat label="Lucro / prejuízo" value={fmtSignedUSD(stats.pnl)} sub={fmtPct(stats.pnlPct, 2, true)} valueClass={pnlColor(stats.pnl)} />
      <Stat label="Operações" value={stats.count} sub={`${stats.wins} venc. · ${stats.losses} perd.`} />
      <Stat label="Taxa de acerto" value={fmtPct(stats.winRate, 1)} />
      <Stat label="Maior perda" value={fmtSignedUSD(stats.maxLoss)} valueClass={stats.maxLoss ? 'text-rose-400' : 'text-zinc-100'} />
      <Stat label="Drawdown máximo" value={fmtPct(stats.maxDrawdownPct, 2)} sub={fmtUSD(stats.maxDrawdownAbs)} valueClass={stats.maxDrawdownPct > 0 ? 'text-rose-400' : 'text-zinc-100'} />
      <Stat
        label="Taxas pagas"
        value={fmtUSD(stats.totalFees)}
        sub={`Fator de lucro: ${stats.profitFactor == null ? '—' : stats.profitFactor === Infinity ? '∞' : fmtNum(stats.profitFactor)}`}
      />
      <Stat label="Resultado bruto" value={fmtSignedUSD(stats.count ? stats.grossPnl : null)} sub="antes das taxas (slippage já incluído)" valueClass={pnlColor(stats.grossPnl)} />
      <Stat label="Maior ganho" value={fmtSignedUSD(stats.maxWin)} valueClass={stats.maxWin ? 'text-emerald-400' : 'text-zinc-100'} />
      <Stat label="Maior sequência de perdas" value={stats.count ? stats.maxLossStreak : '—'} sub={stats.count ? `maior de ganhos: ${stats.maxWinStreak}` : undefined} valueClass={stats.maxLossStreak >= 3 ? 'text-rose-400' : 'text-zinc-100'} />
      <Stat label="Média por operação" value={fmtSignedUSD(stats.expectancy)} sub={`ganho méd. ${fmtUSD(stats.avgWin)} · perda méd. ${fmtUSD(stats.avgLoss == null ? null : -stats.avgLoss)}`} valueClass={pnlColor(stats.expectancy)} />
    </div>
    {stats.count > 0 && (
      <p className={`rounded-xl px-3 py-2 text-xs ${stats.pnl > 0 ? 'bg-emerald-500/10 text-emerald-300' : 'bg-rose-500/10 text-rose-300'}`}>
        {stats.grossPnl > 0 && stats.pnl <= 0
          ? `Lucrativa antes dos custos, mas as taxas (${fmtUSD(costs)}) transformaram em prejuízo.`
          : stats.pnl > 0
            ? `Positiva após taxas e custos em ${stats.count} operações${stats.count < 30 ? ' — amostra pequena, ainda não é evidência estatística' : ''}.`
            : `Negativa após taxas e custos em ${stats.count} operações.`}
      </p>
    )}
    </div>
  );
}

export function ReportCharts({ stats, trades }: { stats: Stats; trades: Trade[] }) {
  if (!trades.length)
    return (
      <Card title="Evolução do saldo fictício" icon={<TrendingUp className="h-4 w-4 text-emerald-400" />}>
        <div className="grid h-40 place-items-center rounded-xl border border-dashed border-zinc-800 px-6 text-center text-xs text-zinc-500">
          O gráfico de capital, o de resultado por operação e o de vencedoras × perdedoras aparecem após a primeira operação simulada fechada.
        </div>
      </Card>
    );
  const ordered = [...trades].sort((a, b) => a.exitTime - b.exitTime);
  return (
    <>
      <Card title="Evolução do saldo fictício" icon={<TrendingUp className="h-4 w-4 text-emerald-400" />}>
        <EquityChart curve={stats.equityCurve} initial={stats.initialCapital} />
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Resultado por operação" icon={<BarChart3 className="h-4 w-4 text-sky-400" />}>
          <PnlBars trades={ordered} />
        </Card>
        <Card title="Vencedoras × perdedoras" icon={<PieIcon className="h-4 w-4 text-amber-400" />}>
          {stats.count ? <WinLossPie wins={stats.wins} losses={stats.losses} /> : <Empty>Sem operações.</Empty>}
        </Card>
      </div>
    </>
  );
}

export function CsvButtons({ trades, filename }: { trades: Trade[]; filename: string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const csv = () => tradesToCsv([...trades].sort((a, b) => a.exitTime - b.exitTime));
  const onDownload = () => {
    const ok = downloadText(filename, csv());
    setMsg(ok ? 'Download iniciado. Se nada acontecer, use “Copiar CSV”.' : 'Download bloqueado neste ambiente. Use “Copiar CSV”.');
  };
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(csv());
      setMsg('CSV copiado para a área de transferência.');
    } catch {
      setMsg('Não foi possível copiar neste navegador.');
    }
  };
  return (
    <div>
      <div className="flex gap-2">
        <button disabled={!trades.length} onClick={onDownload} className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-100 disabled:opacity-40">
          <Download className="h-3.5 w-3.5" /> Baixar CSV
        </button>
        <button disabled={!trades.length} onClick={onCopy} className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-100 disabled:opacity-40">
          <Copy className="h-3.5 w-3.5" /> Copiar CSV
        </button>
      </div>
      {msg && <p className="mt-1.5 text-[11px] text-zinc-500">{msg}</p>}
    </div>
  );
}
