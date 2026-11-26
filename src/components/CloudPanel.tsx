import { useState } from 'react';
import { Cloud, ExternalLink, RefreshCw } from 'lucide-react';
import { useBots } from '../hooks/BotsContext';
import { CLOUD_RUNS_URL, cloudHealth, type CloudHealth } from '../lib/cloud';
import { computeStats } from '../lib/metrics';
import { instLabel } from '../types';
import { fmtDateTime, fmtPrice, fmtSignedUSD, fmtUSD, pnlColor } from '../lib/format';
import { Card, Empty, SideBadge, Stat } from './ui';
import { SignalHistory } from './SignalHistory';
import { TradesTable } from './TradesTable';

const HEALTH: Record<CloudHealth, { label: string; cls: string; desc: string }> = {
  ativo: { label: 'Nuvem ativa', cls: 'bg-emerald-500/15 text-emerald-300', desc: 'Rodando no GitHub a cada ~5 min, sem depender do seu PC ou iPhone.' },
  atrasado: { label: 'Nuvem atrasada', cls: 'bg-amber-500/15 text-amber-300', desc: 'O GitHub está atrasando as execuções (comum em horários de pico). Deve voltar sozinho.' },
  parado: { label: 'Nuvem parada', cls: 'bg-red-500/15 text-red-300', desc: 'Sem execução há mais de 1h30. Veja as execuções no GitHub.' },
  'sem-dados': { label: 'Nuvem sem dados', cls: 'bg-zinc-800 text-zinc-400', desc: 'O robô na nuvem ainda não rodou.' },
};

const ago = (ts: number, now: number) => {
  const m = Math.round((now - ts) / 60_000);
  return m < 1 ? 'agora' : m < 60 ? `há ${m} min` : `há ${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
};

/** Painel do robô que roda no GitHub Actions (Fase 4). Só leitura. */
export function CloudPanel() {
  const { cloud, cloudError, refreshCloud } = useBots();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const now = Date.now();
  const h = cloudHealth(cloud, now);
  const sim = cloud?.sim;
  const pos = sim?.position;
  const stats = sim ? computeStats(sim.trades, sim.config.initialCapital) : null;
  const price = pos ? sim?.lastPrices[pos.instId]?.price : undefined;
  const upnl = pos && price != null ? (price - pos.entryPrice) * pos.qty * (pos.side === 'LONG' ? 1 : -1) : null;

  return (
    <Card
      title="Robô na nuvem"
      icon={<Cloud className="h-4 w-4 text-sky-400" />}
      right={
        <button
          onClick={async () => { setBusy(true); await refreshCloud(); setBusy(false); }}
          className="inline-flex items-center gap-1 text-[11px] text-zinc-400"
        >
          <RefreshCw className={`h-3 w-3 ${busy ? 'animate-spin' : ''}`} /> Atualizar
        </button>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-lg px-2 py-0.5 text-xs font-semibold ${HEALTH[h].cls}`}>{HEALTH[h].label}</span>
        {cloud?.lastOkAt && <span className="text-[11px] text-zinc-500">última execução {fmtDateTime(cloud.lastOkAt)} ({ago(cloud.lastOkAt, now)}) · {cloud.runs} execuções</span>}
      </div>
      <p className="mt-1 text-[11px] text-zinc-500">{HEALTH[h].desc}</p>
      {cloudError && <p className="mt-1 text-[11px] text-red-300">Não foi possível ler o estado da nuvem: {cloudError}</p>}

      {cloud && sim && stats && (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Stat label="Saldo fictício" value={fmtUSD(sim.balance)} valueClass={pnlColor(sim.balance - sim.config.initialCapital)} />
            <Stat label="Operações" value={stats.count} sub={`${stats.wins} venc. · ${stats.losses} perd.`} />
            <Stat label="Demo OKX" value={cloud.config?.demo.enabled ? `${cloud.config.demo.orderValue} ${cloud.config.demo.quote}` : 'desligada'} sub="por compra" />
          </div>

          <div className="mt-3 rounded-xl bg-zinc-950/60 p-3 ring-1 ring-zinc-800">
            {pos ? (
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 text-sm"><SideBadge side={pos.side} /> {instLabel(pos.instId)} · {pos.timeframe}</div>
                  <div className="mt-1 text-xs text-zinc-500">Entrada {fmtPrice(pos.entryPrice)} · SL {fmtPrice(pos.stopPrice)} · TP {fmtPrice(pos.takePrice)}</div>
                </div>
                <div className="text-right">
                  <div className={`text-base font-semibold tabular-nums ${pnlColor(upnl)}`}>{fmtSignedUSD(upnl)}</div>
                  <div className="text-[10px] text-zinc-500">não realizado</div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-zinc-500">
                Sem posição aberta. {sim.mode === 'ATIVO' ? `Aguardando sinal de compra em ${sim.config.allowedTf.join(' ou ')}.` : 'Simulador da nuvem pausado (bot/config.json).'}
              </p>
            )}
          </div>

          <button onClick={() => setOpen(!open)} className="mt-3 w-full rounded-xl bg-zinc-800 py-2 text-xs font-semibold text-zinc-200">
            {open ? 'Esconder detalhes' : 'Ver sinais, ordens e operações da nuvem'}
          </button>
          {open && (
            <div className="mt-3 space-y-3">
              <div>
                <div className="text-[11px] font-semibold text-zinc-400">Ordens na Demo (executor)</div>
                {cloud.demo.log.length ? (
                  <ul className="mt-1 space-y-1 text-[11px]">
                    {cloud.demo.log.slice(0, 10).map((l, i) => (
                      <li key={i} className={l.ok ? 'text-zinc-300' : 'text-red-300'}><span className="text-zinc-500">{fmtDateTime(l.ts)}</span> {l.msg}</li>
                    ))}
                  </ul>
                ) : <Empty>Nenhuma ordem enviada pela nuvem ainda.</Empty>}
              </div>
              <div>
                <div className="text-[11px] font-semibold text-zinc-400">Sinais da nuvem</div>
                <SignalHistory signals={cloud.analyst.signals} limit={5} compact />
              </div>
              <div>
                <div className="text-[11px] font-semibold text-zinc-400">Operações fictícias da nuvem</div>
                <TradesTable trades={sim.trades} emptyText="Nenhuma operação na nuvem ainda." />
              </div>
              {cloud.log.length > 0 && (
                <div>
                  <div className="text-[11px] font-semibold text-zinc-400">Registro da nuvem</div>
                  <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto text-[11px]">
                    {[...cloud.log, ...cloud.analyst.log].sort((a, b) => b.ts - a.ts).slice(0, 30).map((l, i) => (
                      <li key={i} className="text-zinc-400"><span className="text-zinc-500">{fmtDateTime(l.ts)}</span> {l.msg}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </>
      )}
      <a href={CLOUD_RUNS_URL} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-[11px] text-sky-400">
        Ver execuções no GitHub <ExternalLink className="h-3 w-3" />
      </a>
    </Card>
  );
}
