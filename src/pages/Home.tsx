import { Activity, ArrowDownRight, ArrowUpRight, Bell, Bot, History, Radar, Wallet } from 'lucide-react';
import { INSTRUMENTS, instLabel } from '../types';
import { useBots } from '../hooks/BotsContext';
import { computeStats } from '../lib/metrics';
import { dailyUsage, simPhase, unrealized } from '../lib/simEngine';
import { blockLabel, isBlocked } from '../lib/analystEngine';
import { fmtDateTime, fmtPct, fmtPrice, fmtSignedUSD, fmtTime, fmtUSD, pnlColor } from '../lib/format';
import { Card, ErrorBox, Notice, SideBadge, Stat } from '../components/ui';
import { CsvButtons, ReportCharts, StatsGrid } from '../components/Report';
import { TradesTable } from '../components/TradesTable';
import { SignalHistory } from '../components/SignalHistory';
import { ANALYST_STATUS, AnalystChip, DecisionTag, SIM_PHASE, SignalPill, SimChip } from '../components/status';
import type { Route } from '../components/Layout';

export function Home({ go }: { go: (r: Route) => void }) {
  const { analyst, sim, tickers, status, pollNow } = useBots();
  const now = Date.now();
  const stats = computeStats(sim.trades, sim.config.initialCapital);
  const phase = simPhase(sim, now);
  const today = dailyUsage(sim, now);
  const upnl = unrealized(sim);
  const lastSignal = analyst.signals[0];
  const pos = sim.position;

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => go('analista')} className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-3 text-left">
          <div className="flex items-center gap-1.5 text-xs text-zinc-400"><Radar className="h-3.5 w-3.5" /> Robô Analista</div>
          <div className="mt-2"><AnalystChip status={status} /></div>
          <div className="mt-1.5 text-[11px] text-zinc-500">
            {analyst.lastSuccessAt ? `Atualizado ${fmtTime(analyst.lastSuccessAt)}` : ANALYST_STATUS[status].desc}
          </div>
        </button>
        <button onClick={() => go('simulador')} className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-3 text-left">
          <div className="flex items-center gap-1.5 text-xs text-zinc-400"><Bot className="h-3.5 w-3.5" /> Robô Simulador</div>
          <div className="mt-2"><SimChip phase={phase} running={sim.mode === 'ATIVO'} /></div>
          <div className="mt-1.5 text-[11px] text-zinc-500">{sim.mode === 'ATIVO' ? 'Ativo' : sim.mode === 'ENCERRADO' ? 'Encerrado' : 'Pausado'} · {SIM_PHASE[phase].desc.split('.')[0]}</div>
        </button>
      </div>

      {status === 'erro' && analyst.lastError && <ErrorBox message={analyst.lastError} onRetry={pollNow} />}
      {sim.mode === 'ATIVO' && !analyst.enabled && (
        <Notice tone="warn">O Simulador está ativo, mas o Robô Analista está pausado: nenhum sinal novo será recebido.</Notice>
      )}

      <Card title="Último sinal identificado" icon={<Bell className="h-4 w-4 text-amber-400" />}>
        {lastSignal ? (
          <div>
            <div className="flex items-center justify-between gap-2">
              {isBlocked(lastSignal) ? <span className="text-xs font-bold text-zinc-400">{lastSignal.side} bloqueado ({blockLabel(lastSignal)})</span> : <SignalPill signal={lastSignal.side} />}
              <span className="text-[11px] text-zinc-500">{fmtDateTime(lastSignal.closeTime)}</span>
            </div>
            <div className="mt-1.5 text-sm text-zinc-200">{instLabel(lastSignal.instId)} · {lastSignal.tf} · preço {fmtPrice(lastSignal.price)}</div>
            <p className="mt-1 text-[11px] text-zinc-500">{lastSignal.reason}</p>
            <div className="mt-1">{lastSignal.decisions.map((d, i) => <DecisionTag key={i} d={d} />)}</div>
          </div>
        ) : (
          <p className="text-sm text-zinc-500">{analyst.enabled ? 'Nenhum sinal confirmado ainda — 🟡 AGUARDAR.' : 'Ative o Robô Analista para começar a monitorar.'}</p>
        )}
      </Card>

      <Card title="Posição simulada" icon={<Bot className="h-4 w-4 text-sky-400" />}>
        {pos ? (
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm"><SideBadge side={pos.side} /> {instLabel(pos.instId)} · {pos.timeframe} · {pos.leverage}X</div>
              <div className="mt-1 text-xs text-zinc-500">Entrada {fmtPrice(pos.entryPrice)} · SL {fmtPrice(pos.stopPrice)} · TP {fmtPrice(pos.takePrice)}</div>
            </div>
            <div className="text-right">
              <div className={`text-lg font-semibold tabular-nums ${pnlColor(upnl)}`}>{fmtSignedUSD(upnl)}</div>
              <div className="text-[10px] text-zinc-500">não realizado</div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-zinc-500">Nenhuma posição simulada aberta.</p>
        )}
      </Card>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Saldo fictício" value={fmtUSD(sim.balance)} valueClass={pnlColor(sim.balance - sim.config.initialCapital)} />
        <Stat label="Resultado hoje" value={fmtSignedUSD(today.pnlToday)} valueClass={pnlColor(today.pnlToday)} />
        <Stat label="Operações" value={stats.count} sub={`${today.tradesOpenedToday} hoje`} />
      </div>

      <Card title="Mercado OKX" icon={<Activity className="h-4 w-4 text-emerald-400" />}>
        <div className="grid grid-cols-2 gap-2">
          {INSTRUMENTS.map(({ id, label }) => {
            const t = tickers[id];
            const ch = t ? ((t.last - t.open24h) / t.open24h) * 100 : null;
            return (
              <div key={id} className="rounded-xl bg-zinc-950/60 p-3 ring-1 ring-zinc-800">
                <div className="text-xs text-zinc-400">{label}</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">{t ? fmtPrice(t.last) : <span className="text-sm text-zinc-600">{analyst.enabled ? 'carregando…' : 'analista pausado'}</span>}</div>
                {ch != null && (
                  <div className={`mt-0.5 flex items-center gap-0.5 text-xs ${pnlColor(ch)}`}>
                    {ch >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                    {fmtPct(ch, 2, true)} <span className="text-zinc-500">24h · {fmtTime(t!.ts)}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card title="Desempenho da simulação" icon={<Wallet className="h-4 w-4 text-emerald-400" />} right={<span className="text-[11px] text-zinc-500">valores fictícios</span>}>
        <StatsGrid stats={stats} />
      </Card>
      <ReportCharts stats={stats} trades={sim.trades} />

      <Card title="Histórico de alertas" icon={<Bell className="h-4 w-4 text-zinc-400" />} right={<button onClick={() => go('analista')} className="text-xs text-emerald-400">Ver todos →</button>}>
        <SignalHistory signals={analyst.signals} limit={5} compact />
      </Card>

      <Card title="Operações simuladas" icon={<History className="h-4 w-4 text-zinc-400" />} right={<CsvButtons trades={sim.trades} filename="simulacao-operacoes.csv" />}>
        <TradesTable trades={sim.trades} emptyText="Nenhuma operação simulada ainda." />
      </Card>

      <Notice tone="warn">
        Saldos e resultados são <b>fictícios</b>. Sinais são experimentais e <b>não</b> são recomendação de compra ou venda.
      </Notice>
    </>
  );
}
