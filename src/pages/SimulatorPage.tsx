import { useEffect, useState } from 'react';
import { Bot, GitBranch, History, ListChecks, Pause, Play, RotateCcw, Settings2, Square, StopCircle, Target } from 'lucide-react';
import { INSTRUMENTS, TIMEFRAMES, instLabel, type SimConfig } from '../types';
import { useBots } from '../hooks/BotsContext';
import { computeStats } from '../lib/metrics';
import { dailyUsage, limitReason, simPhase, unrealized } from '../lib/simEngine';
import { fmtDateTime, fmtPrice, fmtSignedUSD, fmtTime, fmtUSD, pnlColor } from '../lib/format';
import { Card, ChipMulti, ConfirmButton, ErrorBox, Notice, NumberField, SideBadge } from '../components/ui';
import { StrategyFields, validateStrategy } from '../components/StrategyFields';
import { CsvButtons, ReportCharts, StatsGrid } from '../components/Report';
import { TradesTable } from '../components/TradesTable';
import { SIM_PHASE, SimChip } from '../components/status';

const FLOW = [
  'Analista consulta o mercado',
  'Identifica cruzamento em candle fechado',
  'Registra o sinal no histórico',
  'Simulador verifica as regras de risco',
  'Abre posição fictícia (ou mostra o motivo da rejeição)',
  'Monitora Stop Loss / Take Profit',
  'Encerra a posição conforme as regras',
  'Atualiza saldo e gráficos',
];

export function SimulatorPage() {
  const { sim, analyst, actionError, simStart, simPause, simEnd, simClosePosition, simUpdateConfig, simReset } = useBots();
  const [draft, setDraft] = useState<SimConfig>(sim.config);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => setDraft(sim.config), [sim.config]);

  const now = Date.now();
  const phase = simPhase(sim, now);
  const pos = sim.position;
  const upnl = unrealized(sim);
  const usage = dailyUsage(sim, now);
  const stats = computeStats(sim.trades, sim.config.initialCapital);
  const locked = sim.mode === 'ATIVO' || !!pos;
  const lim = limitReason(sim, now);
  const price = pos ? sim.lastPrices[pos.instId] : undefined;

  const errors = [
    ...validateStrategy({ ...draft, rsiFilter: false }),
    ...(Number.isFinite(draft.initialCapital) && draft.initialCapital >= 10 && draft.initialCapital <= 1_000_000 ? [] : ['Capital inicial: entre US$ 10 e US$ 1.000.000.']),
    ...(Number.isFinite(draft.maxDailyLossPct) && draft.maxDailyLossPct > 0 && draft.maxDailyLossPct <= 100 ? [] : ['Perda máx. diária: entre 0,1% e 100%.']),
    ...(Number.isInteger(draft.maxTradesPerDay) && draft.maxTradesPerDay >= 1 && draft.maxTradesPerDay <= 100 ? [] : ['Operações por dia: inteiro entre 1 e 100.']),
  ];
  const dirty = JSON.stringify(draft) !== JSON.stringify(sim.config);
  const capitalChanged = draft.initialCapital !== sim.config.initialCapital;

  const save = () => {
    if (errors.length) return;
    if (capitalChanged) {
      simReset(draft);
      setMsg('Capital alterado: simulação reiniciada.');
    } else {
      simUpdateConfig(draft);
      setMsg('Configurações salvas.');
    }
    setTimeout(() => setMsg(null), 3000);
  };

  return (
    <>
      <Card title="Robô Simulador" icon={<Bot className="h-4 w-4 text-emerald-400" />}>
        <div className="flex items-center justify-between gap-2">
          <SimChip phase={phase} running={sim.mode === 'ATIVO'} />
          <span className="text-[11px] text-zinc-500">{sim.startedAt ? `início ${fmtDateTime(sim.startedAt)}` : 'não iniciado'}</span>
        </div>
        <p className="mt-1.5 text-[11px] text-zinc-500">{SIM_PHASE[phase].desc}{phase === 'BLOQUEADO_LIMITE' && lim ? ` (${lim})` : ''}</p>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <button onClick={simStart} disabled={sim.mode === 'ATIVO' || dirty} className="inline-flex items-center justify-center gap-1 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
            <Play className="h-4 w-4" /> Iniciar
          </button>
          <button onClick={simPause} disabled={sim.mode !== 'ATIVO'} className="inline-flex items-center justify-center gap-1 rounded-xl bg-zinc-800 py-2.5 text-sm font-semibold disabled:opacity-40">
            <Pause className="h-4 w-4" /> Pausar
          </button>
          <ConfirmButton
            label="Encerrar"
            icon={<StopCircle className="h-4 w-4" />}
            disabled={sim.mode === 'ENCERRADO' && !pos}
            confirmText={pos ? 'Encerrar a simulação e fechar a posição aberta ao preço atual?' : 'Encerrar a simulação? O histórico é mantido.'}
            onConfirm={simEnd}
            className="rounded-xl bg-rose-600/90 py-2.5 text-sm font-semibold text-white"
          />
        </div>
        {dirty && sim.mode !== 'ATIVO' && <p className="mt-2 text-[11px] text-amber-400">Salve as configurações antes de iniciar.</p>}
        {sim.mode === 'ATIVO' && !analyst.enabled && <div className="mt-3"><Notice tone="warn">Robô Analista pausado: o simulador não receberá sinais. Ative-o na aba Analista.</Notice></div>}
        {actionError && <div className="mt-3"><ErrorBox message={actionError} /></div>}

        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
          <Mini k="Saldo" v={fmtUSD(sim.balance)} cls={pnlColor(sim.balance - sim.config.initialCapital)} />
          <Mini k="Hoje" v={`${usage.tradesOpenedToday}/${sim.config.maxTradesPerDay} op.`} />
          <Mini k="Resultado hoje" v={fmtSignedUSD(usage.pnlToday)} cls={pnlColor(usage.pnlToday)} />
        </div>
      </Card>

      <Card title="Posição aberta" icon={<Target className="h-4 w-4 text-sky-400" />}>
        {pos ? (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm"><SideBadge side={pos.side} /> {instLabel(pos.instId)} · {pos.timeframe} · {pos.leverage}X</div>
              <div className={`text-lg font-bold tabular-nums ${pnlColor(upnl)}`}>{fmtSignedUSD(upnl)}</div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <KV k="Entrada" v={fmtPrice(pos.entryPrice)} />
              <KV k={`Preço atual ${price ? fmtTime(price.at) : ''}`} v={fmtPrice(price?.price)} />
              <KV k="Stop Loss" v={fmtPrice(pos.stopPrice)} cls="text-rose-400" />
              <KV k="Take Profit" v={fmtPrice(pos.takePrice)} cls="text-emerald-400" />
              <KV k="Margem" v={fmtUSD(pos.margin)} />
              <KV k="Aberta em" v={fmtDateTime(pos.entryTime)} />
            </div>
            <button onClick={simClosePosition} className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-zinc-800 py-2.5 text-sm font-semibold">
              <Square className="h-4 w-4" /> Fechar só esta posição
            </button>
          </>
        ) : (
          <p className="text-sm text-zinc-500">Nenhuma posição aberta. Máximo de uma por vez.</p>
        )}
      </Card>

      <Card title="Resultados (fictícios)">
        <StatsGrid stats={stats} label="Saldo fictício" />
      </Card>
      <ReportCharts stats={stats} trades={sim.trades} />

      <Card title="Histórico completo" icon={<History className="h-4 w-4 text-zinc-400" />} right={<CsvButtons trades={sim.trades} filename="simulador-operacoes.csv" />}>
        <TradesTable trades={sim.trades} emptyText="Nenhuma operação. Inicie o simulador e aguarde um sinal válido." />
      </Card>

      <Card title="Configurações" icon={<Settings2 className="h-4 w-4 text-zinc-400" />} right={locked ? <span className="text-[11px] text-amber-400">pause e feche a posição para editar</span> : null}>
        <div className="space-y-3">
          <div>
            <span className="text-xs text-zinc-400">Operar sinais de</span>
            <div className="mt-1"><ChipMulti disabled={locked} options={INSTRUMENTS.map((i) => ({ id: i.id, label: i.label }))} value={draft.allowedInst} onChange={(v) => setDraft({ ...draft, allowedInst: v })} /></div>
          </div>
          <div>
            <span className="text-xs text-zinc-400">Tempos gráficos aceitos</span>
            <div className="mt-1"><ChipMulti disabled={locked} options={TIMEFRAMES.map((t) => ({ id: t.id, label: t.label }))} value={draft.allowedTf} onChange={(v) => setDraft({ ...draft, allowedTf: v })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Capital inicial" suffix="USD" step={10} value={draft.initialCapital} onChange={(v) => setDraft({ ...draft, initialCapital: v })} disabled={locked} hint={capitalChanged ? 'Alterar reinicia a simulação' : undefined} />
            <NumberField label="Perda máx. diária" suffix="%" step={1} value={draft.maxDailyLossPct} onChange={(v) => setDraft({ ...draft, maxDailyLossPct: v })} disabled={locked} hint="% do capital inicial" />
            <NumberField label="Operações por dia" step={1} min={1} value={draft.maxTradesPerDay} onChange={(v) => setDraft({ ...draft, maxTradesPerDay: v })} disabled={locked} />
          </div>
          <StrategyFields hideRsi value={{ ...draft, rsiFilter: false }} onChange={({ rsiFilter: _r, trendFilter: _t, trendPeriod: _p, ...v }) => setDraft({ ...draft, ...v })} disabled={locked} />
          {errors.length > 0 && <ul className="text-[11px] text-rose-400">{errors.map((e) => <li key={e}>• {e}</li>)}</ul>}
          <div className="flex gap-2">
            <button onClick={save} disabled={locked || !dirty || errors.length > 0} className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Salvar configurações</button>
            <button onClick={() => setDraft(sim.config)} disabled={!dirty} className="rounded-xl bg-zinc-800 px-4 text-sm disabled:opacity-40">Desfazer</button>
          </div>
          {msg && <p className="text-[11px] text-emerald-400">{msg}</p>}
          <p className="text-[11px] text-zinc-500">Os filtros RSI e de tendência são configurados no Robô Analista (aba Config.).</p>
        </div>
      </Card>

      <Card title="Registro do simulador" icon={<ListChecks className="h-4 w-4 text-zinc-400" />}>
        <ul className="max-h-72 space-y-1.5 overflow-y-auto text-xs">
          {sim.log.map((l, i) => (
            <li key={i} className="flex gap-2">
              <span className="shrink-0 tabular-nums text-zinc-600">{fmtDateTime(l.ts)}</span>
              <span className={l.type === 'entrada' ? 'text-sky-300' : l.type === 'saida' ? 'text-zinc-200' : l.type === 'rejeicao' ? 'text-zinc-500' : l.type === 'alerta' ? 'text-amber-300' : 'text-zinc-400'}>{l.msg}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Como os dois robôs se integram" icon={<GitBranch className="h-4 w-4 text-sky-400" />}>
        <ol className="space-y-1 text-xs text-zinc-400">
          {FLOW.map((f, i) => <li key={f} className="flex gap-2"><span className="w-4 shrink-0 text-right font-semibold text-emerald-500">{i + 1}.</span>{f}</li>)}
        </ol>
        <p className="mt-2 text-[11px] text-zinc-500">
          Regras: 1 posição por vez · cada sinal avaliado uma única vez · cada candle processado uma única vez · sinais anteriores ao início ou com mais de 1 período de atraso são rejeitados.
        </p>
      </Card>

      <Card>
        <ConfirmButton
          label="Nova simulação (zerar saldo e histórico)"
          icon={<RotateCcw className="h-4 w-4" />}
          confirmText={`Apagar operações e voltar ao saldo inicial de ${fmtUSD(sim.config.initialCapital)}?`}
          onConfirm={() => simReset()}
          className="w-full text-sm text-zinc-400"
        />
      </Card>
      <Notice tone="warn">Usa dados reais de mercado, mas <b>nunca executa ordens reais</b>. Todo saldo é fictício.</Notice>
    </>
  );
}

function Mini({ k, v, cls = 'text-zinc-100' }: { k: string; v: string; cls?: string }) {
  return (
    <div className="rounded-lg bg-zinc-950/60 p-2 ring-1 ring-zinc-800">
      <div className="text-zinc-500">{k}</div>
      <div className={`font-semibold tabular-nums ${cls}`}>{v}</div>
    </div>
  );
}

function KV({ k, v, cls = 'text-zinc-200' }: { k: string; v: string; cls?: string }) {
  return (
    <div className="rounded-lg bg-zinc-950/60 px-3 py-2 ring-1 ring-zinc-800">
      <div className="text-[10px] uppercase text-zinc-500">{k}</div>
      <div className={`tabular-nums ${cls}`}>{v}</div>
    </div>
  );
}
