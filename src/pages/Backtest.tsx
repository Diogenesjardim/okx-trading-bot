import { useEffect, useState } from 'react';
import { FlaskConical, History, Info, Loader2, Play } from 'lucide-react';
import { INSTRUMENTS, TIMEFRAMES } from '../types';
import { getHistoricalCandles } from '../lib/okx';
import { runBacktest, type BacktestConfig, type BacktestResult } from '../lib/backtest';
import { KEYS, load, save } from '../lib/storage';
import { fmtDateTime, fmtPct, fmtSignedUSD, pnlColor } from '../lib/format';
import { Card, ErrorBox, Notice, NumberField, Segmented } from '../components/ui';
import { StrategyFields, validateStrategy } from '../components/StrategyFields';
import { CsvButtons, ReportCharts, StatsGrid } from '../components/Report';
import { TradesTable } from '../components/TradesTable';
import { Validation } from './Validation';
import { Matrix } from './Matrix';

const DEFAULT: BacktestConfig & { candles: number } = {
  instId: 'ETH-USDT', timeframe: '1H', initialCapital: 100, candles: 1000,
  leverage: 1, stopLossPct: 2, takeProfitPct: 4, positionSizePct: 100, feePct: 0.05, slippagePct: 0.03,
  rsiFilter: true, exitOnOppositeCross: true, longOnly: true,
};

const SIZES = [300, 500, 1000, 2000, 3000];

export function Backtest() {
  const [tab, setTab] = useState<'backtest' | 'validacao' | 'matriz'>('backtest');
  return (
    <>
      <Segmented
        options={[{ id: 'backtest', label: 'Backtest' }, { id: 'validacao', label: 'Validação' }, { id: 'matriz', label: 'Matriz' }]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'backtest' && <SimpleBacktest />}
      {tab === 'validacao' && <Validation />}
      {tab === 'matriz' && <Matrix />}
    </>
  );
}

function SimpleBacktest() {
  const [cfg, setCfg] = useState(() => ({ ...DEFAULT, ...load(KEYS.backtestCfg, {}) }));
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(BacktestResult & { cfg: typeof cfg; ranAt: number }) | null>(null);
  useEffect(() => save(KEYS.backtestCfg, cfg), [cfg]);

  const errors = [
    ...validateStrategy(cfg),
    ...(Number.isFinite(cfg.initialCapital) && cfg.initialCapital >= 10 ? [] : ['Capital inicial mínimo: US$ 10.']),
  ];

  const run = async () => {
    if (errors.length) return;
    setLoading(true);
    setError(null);
    setProgress(0);
    try {
      const candles = await getHistoricalCandles(cfg.instId, cfg.timeframe, cfg.candles, setProgress);
      if (candles.length < 50) throw new Error('A OKX retornou poucos candles para este período.');
      const r = runBacktest(candles, cfg);
      setResult({ ...r, cfg, ranAt: Date.now() });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao executar o backtest.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Card title="Backtest com dados históricos da OKX" icon={<FlaskConical className="h-4 w-4 text-emerald-400" />}>
        <div className="space-y-3">
          <Segmented options={INSTRUMENTS.map((i) => ({ id: i.id, label: i.label }))} value={cfg.instId} onChange={(v) => setCfg({ ...cfg, instId: v })} disabled={loading} />
          <Segmented options={TIMEFRAMES.map((t) => ({ id: t.id, label: t.label }))} value={cfg.timeframe} onChange={(v) => setCfg({ ...cfg, timeframe: v })} disabled={loading} />
          <div>
            <span className="text-xs text-zinc-400">Quantidade de candles</span>
            <div className="mt-1">
              <Segmented options={SIZES.map((s) => ({ id: s, label: String(s) }))} value={cfg.candles} onChange={(v) => setCfg({ ...cfg, candles: v })} disabled={loading} />
            </div>
          </div>
          <NumberField label="Capital inicial" suffix="USD" step={10} value={cfg.initialCapital} onChange={(v) => setCfg({ ...cfg, initialCapital: v })} disabled={loading} />
          <StrategyFields value={cfg} onChange={(v) => setCfg({ ...cfg, ...v })} disabled={loading} />
          {errors.length > 0 && <ul className="text-[11px] text-rose-400">{errors.map((e) => <li key={e}>• {e}</li>)}</ul>}
          <button onClick={run} disabled={loading || errors.length > 0} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white disabled:opacity-50">
            {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Baixando candles… {progress}/{cfg.candles}</> : <><Play className="h-4 w-4" /> Executar backtest</>}
          </button>
          {error && <ErrorBox message={error} onRetry={run} />}
        </div>
      </Card>

      {result && (
        <>
          <Card title="Resultado do backtest" right={<span className="text-[11px] text-zinc-500">fictício</span>}>
            <div className="mb-3 rounded-xl bg-zinc-950/60 p-3 text-xs text-zinc-400 ring-1 ring-zinc-800">
              <div><b className="text-zinc-200">{result.cfg.instId.replace('-', '/')}</b> · {result.cfg.timeframe} · {result.cfg.leverage}X · SL {result.cfg.stopLossPct}% · TP {result.cfg.takeProfitPct}%</div>
              <div className="mt-1">Período: {fmtDateTime(result.firstTs)} → {fmtDateTime(result.lastTs)}</div>
              <div>Candles analisados: <b className="text-zinc-200">{result.candleCount}</b> (somente fechados)</div>
              <div className="mt-1">
                Resultado líquido: <b className={pnlColor(result.stats.pnl)}>{fmtSignedUSD(result.stats.pnl)} ({fmtPct(result.stats.pnlPct, 2, true)})</b>
              </div>
            </div>
            <StatsGrid stats={result.stats} label="Saldo final (fictício)" />
          </Card>

          <ReportCharts stats={result.stats} trades={result.trades} />

          <Card title="Operações do backtest" icon={<History className="h-4 w-4 text-zinc-400" />} right={<CsvButtons trades={result.trades} filename={`backtest-${result.cfg.instId}-${result.cfg.timeframe}.csv`} />}>
            <TradesTable trades={result.trades} emptyText="Nenhum cruzamento gerou operação neste período." />
          </Card>
        </>
      )}

      <Card title="Regras e limitações" icon={<Info className="h-4 w-4 text-amber-400" />}>
        <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-zinc-400">
          <li>Indicadores em cada candle usam apenas dados disponíveis até aquele candle (sem olhar o futuro).</li>
          <li>Sinal confirmado no fechamento do candle; entrada simulada na abertura do candle seguinte.</li>
          <li>Stop Loss e Take Profit verificados pela máxima e mínima dos candles posteriores. Se ambos forem atingidos no mesmo candle, assume-se o Stop Loss (conservador).</li>
          <li>Se o preço abrir além do stop (gap), a saída é na abertura — pior preço.</li>
          <li>Taxas e slippage aplicados na entrada e na saída. Uma posição por vez, sem sobreposição.</li>
          <li>Não há dados intrabar: a ordem real dos movimentos dentro do candle é desconhecida.</li>
          <li>Não considera funding rate, liquidez do livro, latência nem liquidação real da corretora (a perda é limitada à margem).</li>
          <li>Resultados passados não garantem resultados futuros. Otimizar parâmetros no mesmo período tende a superestimar o desempenho.</li>
        </ul>
      </Card>
      <Notice tone="warn">Backtest é uma estimativa histórica com valores fictícios. Não representa lucro real.</Notice>
    </>
  );
}
