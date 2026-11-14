import { useEffect, useState } from 'react';
import { CheckCircle2, Grid3x3, History, Info, Loader2, Play, ShieldQuestion, XCircle } from 'lucide-react';
import { INSTRUMENTS, TIMEFRAMES, instLabel, type InstId, type Timeframe } from '../types';
import { getHistoricalCandles } from '../lib/okx';
import { validate, type ValidationResult } from '../lib/validation';
import type { BacktestConfig, BacktestResult } from '../lib/backtest';
import { KEYS, load, save } from '../lib/storage';
import { fmtDateTime, fmtNum, fmtPct, fmtSignedUSD, pnlColor } from '../lib/format';
import { Card, ConfirmButton, ErrorBox, NumberField, Segmented } from '../components/ui';
import { StrategyFields, validateStrategy } from '../components/StrategyFields';

type Cfg = BacktestConfig & { candles: number; splitPct: number; windows: number };

const DEFAULT: Cfg = {
  instId: 'ETH-USDT', timeframe: '15m', initialCapital: 100, candles: 2000, splitPct: 70, windows: 5,
  leverage: 1, stopLossPct: 1.5, takeProfitPct: 3, positionSizePct: 100, feePct: 0.05, slippagePct: 0.03,
  rsiFilter: true, trendFilter: false, trendPeriod: 200, exitOnOppositeCross: true, longOnly: true,
};

interface SavedRun {
  at: number;
  instId: InstId;
  timeframe: Timeframe;
  params: string;
  candles: number;
  trades: number;
  netPct: number;
  outPct: number;
  summary: ValidationResult['summary'];
}

export const SUMMARY: Record<ValidationResult['summary'], { label: string; cls: string; desc: string }> = {
  insuficiente: { label: 'Evidência insuficiente', cls: 'bg-rose-500/10 text-rose-300 ring-rose-500/30', desc: 'Não há base para confiar nesta estratégia com estes parâmetros.' },
  fraca: { label: 'Evidência fraca', cls: 'bg-amber-500/10 text-amber-300 ring-amber-500/30', desc: 'Passou em parte dos critérios. Ainda não é uma vantagem comprovada.' },
  promissora: { label: 'Promissora — continue testando', cls: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30', desc: 'Passou nos critérios deste teste. Não garante resultado futuro: valide em simulação contínua.' },
};

const paramsText = (c: BacktestConfig) => `${c.leverage}X · SL ${c.stopLossPct}% · TP ${c.takeProfitPct}% · ${c.rsiFilter ? 'RSI on' : 'RSI off'}${c.trendFilter ? ` · tendência SMA${c.trendPeriod ?? 200}` : ''}${c.exitOnOppositeCross ? '' : ' · só SL/TP'}${c.longOnly ? ' · só LONG' : ''}`;

export function Validation() {
  const [cfg, setCfg] = useState<Cfg>(() => ({ ...DEFAULT, ...load(KEYS.validationCfg, {}) }));
  const [runs, setRuns] = useState<SavedRun[]>(() => load(KEYS.validationRuns, []));
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<(ValidationResult & { cfg: Cfg }) | null>(null);
  useEffect(() => save(KEYS.validationCfg, cfg), [cfg]);
  useEffect(() => save(KEYS.validationRuns, runs), [runs]);

  const errors = validateStrategy(cfg);
  const run = async () => {
    if (errors.length) return;
    setError(null);
    setLoading('Baixando candles…');
    try {
      const candles = await getHistoricalCandles(cfg.instId, cfg.timeframe, cfg.candles, (n) => setLoading(`Baixando candles… ${n}/${cfg.candles}`));
      setLoading('Calculando (treino/teste, janelas, 300 simulações aleatórias)…');
      await new Promise((r) => setTimeout(r, 30));
      const v = validate(candles, cfg, { splitPct: cfg.splitPct, windows: cfg.windows });
      setRes({ ...v, cfg });
      setRuns((rs) => [{
        at: Date.now(), instId: cfg.instId, timeframe: cfg.timeframe, params: paramsText(cfg), candles: v.candleCount,
        trades: v.full.trades.length, netPct: v.full.stats.pnlPct, outPct: v.outSample.stats.pnlPct, summary: v.summary,
      }, ...rs].slice(0, 30));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha na validação.');
    } finally {
      setLoading(null);
    }
  };

  return (
    <>
      <Card title="Validação da estratégia" icon={<ShieldQuestion className="h-4 w-4 text-emerald-400" />}>
        <p className="mb-3 text-xs leading-relaxed text-zinc-400">
          Testa se o resultado se sustenta <b className="text-zinc-200">fora do período em que foi ajustado</b>, em períodos diferentes e contra referências simples (comprar e segurar, entradas aleatórias).
        </p>
        <div className="space-y-3">
          <Segmented options={INSTRUMENTS.map((i) => ({ id: i.id, label: i.label }))} value={cfg.instId} onChange={(v) => setCfg({ ...cfg, instId: v })} disabled={!!loading} />
          <Segmented options={TIMEFRAMES.map((t) => ({ id: t.id, label: t.label }))} value={cfg.timeframe} onChange={(v) => setCfg({ ...cfg, timeframe: v })} disabled={!!loading} />
          <Field label="Candles de histórico"><Segmented options={[1000, 2000, 3000].map((n) => ({ id: n, label: String(n) }))} value={cfg.candles} onChange={(v) => setCfg({ ...cfg, candles: v })} disabled={!!loading} /></Field>
          <Field label="Treino / teste"><Segmented options={[60, 70, 80].map((n) => ({ id: n, label: `${n}/${100 - n}` }))} value={cfg.splitPct} onChange={(v) => setCfg({ ...cfg, splitPct: v })} disabled={!!loading} /></Field>
          <Field label="Janelas de tempo"><Segmented options={[4, 5, 6].map((n) => ({ id: n, label: String(n) }))} value={cfg.windows} onChange={(v) => setCfg({ ...cfg, windows: v })} disabled={!!loading} /></Field>
          <NumberField label="Capital inicial" suffix="USD" step={10} value={cfg.initialCapital} onChange={(v) => setCfg({ ...cfg, initialCapital: v })} disabled={!!loading} />
          <StrategyFields value={cfg} onChange={(v) => setCfg({ ...cfg, ...v })} disabled={!!loading} />
          {errors.length > 0 && <ul className="text-[11px] text-rose-400">{errors.map((e) => <li key={e}>• {e}</li>)}</ul>}
          <button onClick={run} disabled={!!loading || errors.length > 0} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white disabled:opacity-50">
            {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> {loading}</> : <><Play className="h-4 w-4" /> Executar validação</>}
          </button>
          {error && <ErrorBox message={error} onRetry={run} />}
        </div>
      </Card>

      {res && <ValidationReport r={res} />}

      <Card title="Histórico de validações" icon={<History className="h-4 w-4 text-zinc-400" />}>
        {runs.length ? (
          <>
            <ul className="divide-y divide-zinc-800/70 text-xs">
              {runs.map((r) => (
                <li key={r.at} className="py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-zinc-200">{instLabel(r.instId)} · {r.timeframe}</span>
                    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${SUMMARY[r.summary].cls}`}>{SUMMARY[r.summary].label.split(' —')[0]}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-zinc-500">
                    {fmtDateTime(r.at)} · {r.params} · {r.candles} candles · {r.trades} ops · total <span className={pnlColor(r.netPct)}>{fmtPct(r.netPct, 1, true)}</span> · teste <span className={pnlColor(r.outPct)}>{fmtPct(r.outPct, 1, true)}</span>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-2"><ConfirmButton label="Limpar histórico" confirmText="Apagar o histórico de validações?" onConfirm={() => setRuns([])} className="w-full text-xs text-zinc-500" /></div>
          </>
        ) : (
          <p className="text-sm text-zinc-500">Nenhuma validação executada. Cada execução fica registrada aqui para comparar parâmetros.</p>
        )}
      </Card>

      <Card title="Como ler esta validação" icon={<Info className="h-4 w-4 text-amber-400" />}>
        <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-zinc-400">
          <li><b className="text-zinc-200">Treino × teste:</b> o histórico é dividido. O teste usa dados que não serviram para escolher nada.</li>
          <li><b className="text-zinc-200">Melhor do treino:</b> testa 16 combinações de SL/TP só no treino e aplica a melhor no teste. Se ela piora muito no teste, há sobreajuste.</li>
          <li><b className="text-zinc-200">Janelas:</b> mesma estratégia em períodos seguidos. Consistência importa mais que um período excelente.</li>
          <li><b className="text-zinc-200">Entradas aleatórias:</b> 300 simulações com a mesma frequência, SL/TP, alavancagem e custos, mas direção sorteada. Se a estratégia não supera a maioria, o resultado pode ser acaso.</li>
          <li><b className="text-zinc-200">Comprar e segurar:</b> referência de quem só comprou e esperou (1X).</li>
          <li>Limitações: mesmas do backtest (sem dados intrabar, sem funding, sem livro de ofertas). 3.000 candles de 15 min ≈ 1 mês — pouco para conclusões fortes. O histórico público da OKX limita o período disponível.</li>
        </ul>
      </Card>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="text-xs text-zinc-400">{label}</span>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function ValidationReport({ r }: { r: ValidationResult & { cfg: Cfg } }) {
  const s = SUMMARY[r.summary];
  const row = (label: string, b: BacktestResult) => ({ label, trades: b.trades.length, win: b.stats.winRate, pct: b.stats.pnlPct, pnl: b.stats.pnl, dd: b.stats.maxDrawdownPct });
  const rows = [
    row('Seus parâm. · treino', r.inSample),
    row('Seus parâm. · teste', r.outSample),
    ...(r.optimized
      ? [row(`Otimizado SL ${r.optimized.best.stopLossPct}/TP ${r.optimized.best.takeProfitPct} · treino`, r.optimized.inSample), row(`Otimizado · teste`, r.optimized.outSample)]
      : []),
  ];
  return (
    <>
      <Card title="Resultado da validação" right={<span className="text-[11px] text-zinc-500">fictício</span>}>
        <div className={`rounded-xl p-3 ring-1 ${s.cls}`}>
          <div className="text-base font-bold">{s.label}</div>
          <p className="mt-0.5 text-xs opacity-90">{s.desc}</p>
        </div>
        <div className="mt-2 text-[11px] text-zinc-500">
          {instLabel(r.cfg.instId)} · {r.cfg.timeframe} · {paramsText(r.cfg)} · {r.candleCount} candles ({fmtDateTime(r.firstTs)} → {fmtDateTime(r.lastTs)}) · corte treino/teste em {fmtDateTime(r.splitTs)}
        </div>
        <ul className="mt-3 space-y-1.5">
          {r.verdicts.map((v) => (
            <li key={v.text} className="flex gap-2 text-xs">
              {v.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />}
              <span className="text-zinc-300">{v.text}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Treino × teste (fora da amostra)">
        <Table
          head={['Cenário', 'Ops', 'Acerto', 'Líquido', 'DD']}
          rows={[
            ...rows.map((x) => [x.label, x.trades, fmtPct(x.win, 0), <span className={pnlColor(x.pnl)}>{fmtPct(x.pct, 1, true)}</span>, fmtPct(x.dd, 1)]),
            ['Comprar e segurar · teste', '—', '—', <span className={pnlColor(r.buyHoldOut.pnl)}>{fmtPct(r.buyHoldOut.pnlPct, 1, true)}</span>, '—'],
          ]}
        />
      </Card>

      <Card title={`Consistência em ${r.windows.length} janelas`} icon={<Grid3x3 className="h-4 w-4 text-sky-400" />}>
        <Table
          head={['#', 'Período', 'Ops', 'Acerto', 'Estratégia', 'Comprar e segurar']}
          rows={r.windows.map((w) => [
            w.idx,
            `${fmtDateTime(w.from).slice(0, 8)} → ${fmtDateTime(w.to).slice(0, 8)}`,
            w.trades,
            fmtPct(w.winRate, 0),
            <span className={pnlColor(w.pnl)}>{fmtPct(w.pnlPct, 1, true)}</span>,
            <span className={pnlColor(w.buyHoldPct)}>{fmtPct(w.buyHoldPct, 1, true)}</span>,
          ])}
        />
      </Card>

      <Card title="Referências (período todo)">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <Box k="Estratégia" v={<span className={pnlColor(r.full.stats.pnl)}>{fmtSignedUSD(r.full.stats.pnl)} ({fmtPct(r.full.stats.pnlPct, 1, true)})</span>} sub={`${r.full.trades.length} ops · bruto ${fmtSignedUSD(r.full.stats.grossPnl)}`} />
          <Box k="Comprar e segurar" v={<span className={pnlColor(r.buyHold.pnl)}>{fmtSignedUSD(r.buyHold.pnl)} ({fmtPct(r.buyHold.pnlPct, 1, true)})</span>} sub="1X, 100% do capital" />
          {r.random ? (
            <>
              <Box k="Aleatório — mediana" v={<span className={pnlColor(r.random.median)}>{fmtSignedUSD(r.random.median)}</span>} sub={`90% entre ${fmtSignedUSD(r.random.p5)} e ${fmtSignedUSD(r.random.p95)}`} />
              <Box k="Estratégia superou" v={`${fmtNum(r.random.strategyPercentile, 0)}%`} sub={`das ${r.random.runs} simulações · ${fmtNum(r.random.pctPositive, 0)}% delas lucraram`} />
            </>
          ) : (
            <Box k="Entradas aleatórias" v="—" sub="sem operações da estratégia para comparar" />
          )}
        </div>
      </Card>
    </>
  );
}

function Box({ k, v, sub }: { k: string; v: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl bg-zinc-950/60 p-3 ring-1 ring-zinc-800">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{k}</div>
      <div className="mt-1 text-sm font-semibold tabular-nums text-zinc-100">{v}</div>
      {sub && <div className="mt-0.5 text-[11px] text-zinc-500">{sub}</div>}
    </div>
  );
}

export function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-[420px] text-left text-xs">
        <thead className="text-[10px] uppercase text-zinc-500">
          <tr className="border-b border-zinc-800">{head.map((h) => <th key={h} className="py-2 pr-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-zinc-800/60">
              {r.map((c, j) => <td key={j} className={`py-2 pr-2 ${j === 0 ? 'text-zinc-300' : 'text-zinc-400'}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

