import { useState } from 'react';
import { FlaskRound, Loader2, PlugZap, RefreshCw, ShieldCheck } from 'lucide-react';
import { useBots } from '../hooks/BotsContext';
import { demoReady } from '../lib/okxDemo';
import { fmtDateTime, fmtNum, fmtPrice } from '../lib/format';
import { Card, Empty, Notice, NumberField, Segmented, Toggle } from './ui';

const Badge = () => <span className="rounded-md bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-bold text-sky-300">TRADING SIMULADO OKX</span>;

/** Configurações (aba Config.). */
export function DemoSettingsCard() {
  const { demo, sim, setDemoConfig, refreshDemo, demoStatus, demoBusy } = useBots();
  const [url, setUrl] = useState(demo.config.url);
  const [token, setToken] = useState(demo.config.token);
  const [show, setShow] = useState(false);
  const dirty = url.trim() !== demo.config.url || token.trim() !== demo.config.token;
  const save = () => {
    const u = url.trim(), t = token.trim();
    setUrl(u); setToken(t);
    setDemoConfig({ ...demo.config, url: u, token: t });
  };
  const max = demo.config.quote === 'BRL' ? 2000 : 400;

  return (
    <Card title="Ordens automáticas (Trading simulado)" icon={<FlaskRound className="h-4 w-4 text-sky-400" />} right={<Badge />}>
      <p className="text-xs leading-relaxed text-zinc-400">
        Quando ligado, cada compra e cada saída do Robô Simulador viram <b className="text-zinc-200">ordens à vista no Trading simulado da OKX</b> (dinheiro fictício da OKX). O Stop Loss e o Take Profit ficam registrados na própria OKX.
        As chaves da OKX ficam no Supabase; aqui só ficam o endereço da função e o token.
      </p>
      <div className="mt-3 space-y-3">
        <label className="block">
          <span className="text-xs text-zinc-400">URL da função</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://SEU-PROJETO.supabase.co/functions/v1/okx-demo" autoCapitalize="off" autoCorrect="off"
            className="mt-1 w-full rounded-xl bg-zinc-950 px-3 py-2 text-sm text-zinc-100 ring-1 ring-zinc-800" />
        </label>
        <label className="block">
          <span className="text-xs text-zinc-400">Token (o mesmo BOT_TOKEN do Supabase)</span>
          <div className="mt-1 flex items-center rounded-xl bg-zinc-950 ring-1 ring-zinc-800">
            <input type={show ? 'text' : 'password'} value={token} onChange={(e) => setToken(e.target.value)} autoCapitalize="off" autoCorrect="off"
              className="w-full bg-transparent px-3 py-2 text-sm text-zinc-100 outline-none" />
            <button onClick={() => setShow(!show)} className="px-3 text-[11px] text-zinc-500">{show ? 'ocultar' : 'mostrar'}</button>
          </div>
        </label>
        <div className="flex gap-2">
          <button disabled={!dirty} onClick={save} className="flex-1 rounded-xl bg-emerald-600 py-2 text-sm font-semibold text-white disabled:opacity-40">Salvar</button>
          <button disabled={demoBusy || !demoReady({ ...demo.config, url, token })} onClick={() => { if (dirty) save(); refreshDemo(); }} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-zinc-800 py-2 text-sm disabled:opacity-40">
            {demoBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />} Testar conexão
          </button>
        </div>
        {!demoStatus && !demoBusy && demo.log[0]?.action === 'status' && !demo.log[0].ok && (
          <div className="rounded-xl bg-red-500/10 p-3 text-xs text-red-300 ring-1 ring-red-500/30">
            ✗ Falha no teste ({fmtDateTime(demo.log[0].ts)}): {demo.log[0].msg}
          </div>
        )}
        {demoStatus && (
          <div className="rounded-xl bg-zinc-950/60 p-3 text-xs ring-1 ring-zinc-800">
            <div className="text-emerald-400">✓ Conectado ao Trading simulado</div>
            <div className="mt-1 text-zinc-400">
              Saldo: {Object.entries(demoStatus.balances).map(([c, b]) => `${fmtNum(b.avail, c === 'BTC' || c === 'ETH' ? 6 : 2)} ${c}`).join(' · ') || '—'}
            </div>
          </div>
        )}
        <div>
          <span className="text-xs text-zinc-400">Moeda da conta</span>
          <div className="mt-1"><Segmented options={[{ id: 'BRL' as const, label: 'BRL (ETH-BRL, BTC-BRL)' }, { id: 'USDT' as const, label: 'USDT' }]} value={demo.config.quote} onChange={(v) => setDemoConfig({ ...demo.config, quote: v, orderValue: v === 'BRL' ? 500 : 100 })} /></div>
        </div>
        <NumberField label="Valor de cada compra" suffix={demo.config.quote} step={50} value={demo.config.orderValue}
          onChange={(v) => setDemoConfig({ ...demo.config, orderValue: Math.min(v, max) })} hint={`Limite de segurança: ${max} ${demo.config.quote} por ordem`} />
        <Toggle
          label="Espelhar o Robô Simulador no Trading simulado"
          hint={!sim.config.longOnly ? 'Ative "Somente LONG" no Simulador: a conta à vista não faz SHORT.' : 'Novas compras do simulador viram ordens na OKX. Posições já abertas não são enviadas.'}
          checked={demo.config.enabled}
          disabled={!demoReady(demo.config)}
          onChange={(v) => setDemoConfig({ ...demo.config, enabled: v })}
        />
        <Notice>Só funciona no <b>Trading simulado</b>: a função envia sempre o modo de simulação da OKX, e chaves reais não funcionam lá. Só compra e venda à vista de BTC e ETH, sem alavancagem e sem saques.</Notice>
      </div>
    </Card>
  );
}

/** Situação da conta Demo (aba Simulador). */
export function DemoAccountCard() {
  const { demo, demoStatus, demoBusy, refreshDemo } = useBots();
  if (!demoReady(demo.config)) return null;
  return (
    <Card
      title="Trading simulado OKX"
      icon={<FlaskRound className="h-4 w-4 text-sky-400" />}
      right={
        <button onClick={refreshDemo} disabled={demoBusy} className="inline-flex items-center gap-1 text-[11px] text-zinc-400 disabled:opacity-50">
          <RefreshCw className={`h-3 w-3 ${demoBusy ? 'animate-spin' : ''}`} /> Atualizar
        </button>
      }
    >
      <div className="flex items-center justify-between text-xs">
        <Badge />
        <span className={demo.config.enabled ? 'text-emerald-400' : 'text-zinc-500'}>{demo.config.enabled ? `Espelhando · ${demo.config.orderValue} ${demo.config.quote}/compra` : 'Espelhamento desligado (Config.)'}</span>
      </div>
      {demoStatus ? (
        <>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            {[demoStatus.quote, 'BTC', 'ETH'].map((c) => (
              <div key={c} className="rounded-lg bg-zinc-950/60 p-2 ring-1 ring-zinc-800">
                <div className="text-zinc-500">{c}</div>
                <div className="font-semibold tabular-nums">{fmtNum(demoStatus.balances[c]?.avail ?? 0, c === 'BTC' || c === 'ETH' ? 5 : 2)}</div>
              </div>
            ))}
          </div>
          {demoStatus.protections.length > 0 && (
            <div className="mt-3 space-y-1">
              {demoStatus.protections.map((p) => (
                <div key={p.algoId} className="flex items-center gap-1.5 rounded-lg bg-zinc-950/60 px-3 py-2 text-[11px] ring-1 ring-zinc-800">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="text-zinc-300">{p.instId} · SL {fmtPrice(p.slTriggerPx)} · TP {fmtPrice(p.tpTriggerPx)} (na OKX)</span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 text-[11px] font-semibold text-zinc-400">Últimas ordens</div>
          {demoStatus.orders.length ? (
            <ul className="mt-1 divide-y divide-zinc-800/70 text-[11px]">
              {demoStatus.orders.slice(0, 10).map((o) => (
                <li key={o.ordId} className="flex justify-between gap-2 py-1.5">
                  <span className="text-zinc-400">{fmtDateTime(o.cTime)} · {o.instId} {o.side === 'buy' ? 'compra' : 'venda'} {o.sz} @ {fmtPrice(o.avgPx)}</span>
                  <span className="text-zinc-500">{o.state === 'filled' ? 'executada' : o.state}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Nenhuma ordem ainda.</Empty>
          )}
        </>
      ) : (
        <p className="mt-3 text-xs text-zinc-500">Toque em Atualizar para ver saldo, proteções e ordens.</p>
      )}
      {demo.log.length > 0 && (
        <>
          <div className="mt-3 text-[11px] font-semibold text-zinc-400">Registro do executor</div>
          <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto text-[11px]">
            {demo.log.map((l, i) => (
              <li key={i} className="flex gap-2">
                <span className="shrink-0 tabular-nums text-zinc-600">{fmtDateTime(l.ts)}</span>
                <span className={l.ok ? 'text-zinc-300' : 'text-rose-400'}>{l.msg}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
