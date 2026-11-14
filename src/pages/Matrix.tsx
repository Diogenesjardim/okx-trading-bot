import { useState } from 'react';
import { Grid3x3, Loader2, Play } from 'lucide-react';
import { INSTRUMENTS, TIMEFRAMES, instLabel, type InstId, type Timeframe } from '../types';
import { getHistoricalCandles } from '../lib/okx';
import { validate, type ValidationResult } from '../lib/validation';
import type { BacktestConfig } from '../lib/backtest';
import { KEYS, load, save } from '../lib/storage';
import { fmtDateTime, fmtNum, fmtPct, pnlColor } from '../lib/format';
import { Card, Notice, Segmented } from '../components/ui';
import { SUMMARY, Table } from './Validation';

interface Row {
  instId: InstId;
  tf: Timeframe;
  error?: string;
  r?: Pick<ValidationResult, 'summary' | 'candleCount'> & {
    trades: number; win: number | null; pct: number; outPct: number; posWindows: string; beatRandom: number | null; bhPct: number;
  };
}

interface Saved {
  at: number;
  candles: number;
  params: string;
  rows: Row[];
}

const DEFAULTS: BacktestConfig = {
  instId: 'ETH-USDT', timeframe: '15m', initialCapital: 100, leverage: 1, stopLossPct: 1.5, takeProfitPct: 3,
  positionSizePct: 100, feePct: 0.05, slippagePct: 0.03, rsiFilter: true, trendFilter: false, trendPeriod: 200, exitOnOppositeCross: true, longOnly: true,
};

export function Matrix() {
  const [candles, setCandles] = useState(1000);
  const [progress, setProgress] = useState<string | null>(null);
  const [history, setHistory] = useState<Saved[]>(() => {
    const v = load<Saved | Saved[] | null>(KEYS.matrix, null);
    return Array.isArray(v) ? v : v ? [v] : [];
  });
  const [sel, setSel] = useState(0);
  const saved = history[sel] ?? null;

  const run = async () => {
    // usa os mesmos parâmetros de estratégia da aba Validação
    const base = { ...DEFAULTS, ...load<Partial<BacktestConfig>>(KEYS.validationCfg, {}) };
    const params = `${base.leverage}X · SL ${base.stopLossPct}% · TP ${base.takeProfitPct}% · taxa ${base.feePct}% · ${base.rsiFilter ? 'RSI on' : 'RSI off'}${base.trendFilter ? ` · tendência SMA${base.trendPeriod ?? 200}` : ''}${base.exitOnOppositeCross ? '' : ' · só SL/TP'}${base.longOnly ? ' · só LONG' : ''}`;
    const rows: Row[] = [];
    const startedAt = Date.now();
    const combos = INSTRUMENTS.flatMap((i) => TIMEFRAMES.map((t) => [i.id, t.id] as [InstId, Timeframe]));
    for (let k = 0; k < combos.length; k++) {
      const [instId, tf] = combos[k];
      setProgress(`${k + 1}/${combos.length} · ${instLabel(instId)} ${tf}`);
      try {
        const cs = await getHistoricalCandles(instId, tf, candles);
        await new Promise((r) => setTimeout(r, 10));
        const v = validate(cs, { ...base, instId, timeframe: tf }, { splitPct: 70, windows: 4, randomRuns: 150 });
        rows.push({
          instId, tf,
          r: {
            summary: v.summary, candleCount: v.candleCount, trades: v.full.trades.length, win: v.full.stats.winRate,
            pct: v.full.stats.pnlPct, outPct: v.outSample.stats.pnlPct,
            posWindows: `${v.windows.filter((w) => w.pnl > 0).length}/${v.windows.length}`,
            beatRandom: v.random?.strategyPercentile ?? null, bhPct: v.buyHold.pnlPct,
          },
        });
      } catch (e) {
        rows.push({ instId, tf, error: e instanceof Error ? e.message : 'Falha' });
      }
      const snapshot: Saved = { at: startedAt, candles, params, rows: [...rows] };
      setHistory((h) => {
        const next = [snapshot, ...h.filter((x) => x.at !== startedAt)].slice(0, 5);
        save(KEYS.matrix, next);
        return next;
      });
      setSel(0);
    }
    setProgress(null);
  };

  return (
    <>
      <Card title="Matriz: ativos × tempos gráficos" icon={<Grid3x3 className="h-4 w-4 text-emerald-400" />}>
        <p className="mb-3 text-xs leading-relaxed text-zinc-400">
          Roda a validação nos 8 mercados (BTC e ETH × 5 min, 15 min, 1 h, 4 h) com os <b className="text-zinc-200">parâmetros da aba Validação</b>. Mostra onde a estratégia se comporta melhor ou pior.
        </p>
        <span className="text-xs text-zinc-400">Candles por mercado</span>
        <div className="mt-1"><Segmented options={[500, 1000, 2000].map((n) => ({ id: n, label: String(n) }))} value={candles} onChange={setCandles} disabled={!!progress} /></div>
        <button onClick={run} disabled={!!progress} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white disabled:opacity-50">
          {progress ? <><Loader2 className="h-4 w-4 animate-spin" /> {progress}</> : <><Play className="h-4 w-4" /> Executar matriz</>}
        </button>
        <p className="mt-1.5 text-center text-[11px] text-zinc-500">Pode levar 1–2 minutos (muitas consultas à OKX).</p>
      </Card>

      {saved && (
        <Card title="Resultado" right={<span className="text-[11px] text-zinc-500">{fmtDateTime(saved.at)}</span>}>
          {history.length > 1 && (
            <div className="mb-3">
              <span className="text-[11px] text-zinc-500">Execuções salvas (compare com e sem filtros):</span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {history.map((h, i) => (
                  <button key={h.at} onClick={() => setSel(i)} className={`rounded-lg px-2.5 py-1 text-[11px] ring-1 ${i === sel ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40' : 'bg-zinc-950 text-zinc-400 ring-zinc-800'}`}>
                    {fmtDateTime(h.at).slice(-5)}{h.params.includes('tendência') ? ' · tendência' : ''}
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="mb-2 text-[11px] text-zinc-500">{saved.params} · até {saved.candles} candles · treino/teste 70/30 · 4 janelas</p>
          <MatrixSummary rows={saved.rows} />
          <Table
            head={['Mercado', 'Ops', 'Acerto', 'Total', 'Teste', 'Janelas +', 'Vs. aleatório', 'Comprar e segurar', 'Evidência']}
            rows={saved.rows.map((row) =>
              row.r
                ? [
                    `${instLabel(row.instId)} ${row.tf}`,
                    row.r.trades,
                    fmtPct(row.r.win, 0),
                    <span className={pnlColor(row.r.pct)}>{fmtPct(row.r.pct, 1, true)}</span>,
                    <span className={pnlColor(row.r.outPct)}>{fmtPct(row.r.outPct, 1, true)}</span>,
                    row.r.posWindows,
                    row.r.beatRandom == null ? '—' : `${fmtNum(row.r.beatRandom, 0)}%`,
                    <span className={pnlColor(row.r.bhPct)}>{fmtPct(row.r.bhPct, 1, true)}</span>,
                    <span className={`rounded px-1 py-0.5 text-[10px] ring-1 ${SUMMARY[row.r.summary].cls}`}>{SUMMARY[row.r.summary].label.split(' —')[0]}</span>,
                  ]
                : [`${instLabel(row.instId)} ${row.tf}`, <span className="text-rose-400">{row.error}</span>, '', '', '', '', '', '', ''],
            )}
          />
        </Card>
      )}

      <Notice tone="warn">
        Comparar 8 mercados aumenta a chance de um deles parecer bom só por sorte. Um resultado isolado positivo na matriz deve ser confirmado na aba Validação com mais histórico e depois em simulação contínua.
      </Notice>
    </>
  );
}

function MatrixSummary({ rows }: { rows: Row[] }) {
  const ok = rows.filter((r) => r.r);
  if (!ok.length) return null;
  const avg = ok.reduce((a, r) => a + r.r!.pct, 0) / ok.length;
  const pos = ok.filter((r) => r.r!.pct > 0).length;
  const ops = ok.reduce((a, r) => a + r.r!.trades, 0);
  return (
    <div className="mb-3 grid grid-cols-3 gap-2 text-center text-xs">
      <div className="rounded-lg bg-zinc-950/60 p-2 ring-1 ring-zinc-800"><div className="text-zinc-500">Média total</div><div className={`font-semibold ${pnlColor(avg)}`}>{fmtPct(avg, 1, true)}</div></div>
      <div className="rounded-lg bg-zinc-950/60 p-2 ring-1 ring-zinc-800"><div className="text-zinc-500">Mercados +</div><div className="font-semibold">{pos}/{ok.length}</div></div>
      <div className="rounded-lg bg-zinc-950/60 p-2 ring-1 ring-zinc-800"><div className="text-zinc-500">Operações</div><div className="font-semibold">{ops}</div></div>
    </div>
  );
}
