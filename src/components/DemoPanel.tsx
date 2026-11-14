import { useState } from 'react';
import { FlaskRound, Loader2, PlugZap, RefreshCw, Wrench, X } from 'lucide-react';
import { useBots } from '../hooks/BotsContext';
import { demoReady } from '../lib/okxDemo';
import { fmtDateTime, fmtNum, fmtPrice, pnlColor } from '../lib/format';
import type { InstId } from '../types';
import { Card, Empty, Notice, Toggle } from './ui';

const usdt = (v: number | null | undefined, signed = false) =>
  v == null || !Number.isFinite(v) ? '—' : `${signed && v > 0 ? '+' : ''}${v.toFixed(2).replace('.', ',')} USDT`;

const Badge = () => <span className="rounded-md bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-bold text-sky-300">CONTA DEMO OKX</span>;

/** Configurações (aba Config.). */
export function DemoSettingsCard() {
  const { demo, setDemoConfig, refreshDemo, prepareDemo, demoStatus, demoBusy } = useBots();
  const [url, setUrl] = useState(demo.config.url);
  const [token, setToken] = useState(demo.config.token);
  const [show, setShow] = useState(false);
  const dirty = url !== demo.config.url || token !== demo.config.token;
  const ready = demoReady({ ...demo.config, url, token });
  const needsPrep = demoStatus && (demoStatus.acctLv === '1' || demoStatus.posMode !== 'net_mode');

  return (
    <Card title="Ordens automáticas (conta Demo)" icon={<FlaskRound className="h-4 w-4 text-sky-400" />} right={<Badge />}>
      <p className="text-xs leading-relaxed text-zinc-400">
        Quando ligado, cada posição aberta ou fechada pelo Robô Simulador é <b className="text-zinc-200">enviada como ordem para a sua conta Demo da OKX</b> (dinheiro fictício da OKX), com Stop Loss e Take Profit registrados na própria OKX.
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
          <button disabled={!dirty} onClick={() => setDemoConfig({ ...demo.config, url: url.trim(), token: token.trim() })} className="flex-1 rounded-xl bg-emerald-600 py-2 text-sm font-semibold text-white disabled:opacity-40">Salvar</button>
          <button disabled={!demoReady(demo.config) || demoBusy || dirty} onClick={refreshDemo} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-zinc-800 py-2 text-sm disabled:opacity-40">
            {demoBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />} Testar conexão
          </button>
        </div>
        {demoStatus && (
          <div className="rounded-xl bg-zinc-950/60 p-3 text-xs ring-1 ring-zinc-800">
            <div className="text-emerald-400">✓ Conectado à conta Demo</div>
            <div className="mt-1 text-zinc-400">Saldo: {usdt(demoStatus.usdt?.eq)} · disponível {usdt(demoStatus.usdt?.avail)}</div>
            <div className="text-zinc-500">Modo da conta: {demoStatus.acctLv === '1' ? 'Spot (não permite SHORT)' : 'Spot e futuros'} · posições: {demoStatus.posMode === 'net_mode' ? 'compra/venda' : 'long/short'}</div>
            {needsPrep && (
              <button onClick={prepareDemo} disabled={demoBusy} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                <Wrench className="h-3.5 w-3.5" /> Preparar conta Demo
              </button>
            )}
          </div>
        )}
        <Toggle
          label="Espelhar o Robô Simulador na conta Demo"
          hint={ready ? 'Novas posições do simulador viram ordens na Demo. Posições já abertas não são enviadas.' : 'Salve a URL e o token primeiro.'}
          checked={demo.config.enabled}
          disabled={!demoReady(demo.config)}
          onChange={(v) => setDemoConfig({ ...demo.config, enabled: v })}
        />
        <Notice>Só funciona na conta <b>Demo</b>: a função envia sempre o modo de simulação da OKX, e chaves reais não funcionam lá. Limite de segurança: até 200 USDT de margem por ordem, alavancagem máxima 3X, só BTC e ETH.</Notice>
      </div>
    </Card>
  );
}

/** Situação da conta Demo (aba Simulador). */
export function DemoAccountCard() {
  const { demo, demoStatus, demoBusy, refreshDemo, closeDemo } = useBots();
  if (!demoReady(demo.config)) return null;
  return (
    <Card
      title="Conta Demo OKX"
      icon={<FlaskRound className="h-4 w-4 text-sky-400" />}
      right={
        <button onClick={refreshDemo} disabled={demoBusy} className="inline-flex items-center gap-1 text-[11px] text-zinc-400 disabled:opacity-50">
          <RefreshCw className={`h-3 w-3 ${demoBusy ? 'animate-spin' : ''}`} /> Atualizar
        </button>
      }
    >
      <div className="flex items-center justify-between text-xs">
        <Badge />
        <span className={demo.config.enabled ? 'text-emerald-400' : 'text-zinc-500'}>{demo.config.enabled ? 'Espelhando o simulador' : 'Espelhamento desligado (Config.)'}</span>
      </div>
      {demoStatus ? (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-zinc-950/60 p-2 ring-1 ring-zinc-800"><div className="text-zinc-500">Saldo Demo</div><div className="font-semibold tabular-nums">{usdt(demoStatus.usdt?.eq)}</div></div>
            <div className="rounded-lg bg-zinc-950/60 p-2 ring-1 ring-zinc-800"><div className="text-zinc-500">Posições abertas</div><div className="font-semibold">{demoStatus.positions.length}</div></div>
          </div>
          {demoStatus.positions.map((p) => (
            <div key={p.instId + p.posSide} className="mt-2 rounded-xl bg-zinc-950/60 p-3 text-xs ring-1 ring-zinc-800">
              <div className="flex justify-between">
                <span className="font-semibold">{p.instId} · {Number(p.pos) > 0 || p.posSide === 'long' ? 'LONG' : 'SHORT'} · {p.lever}X</span>
                <span className={pnlColor(p.upl)}>{usdt(p.upl, true)} ({fmtNum(p.uplRatio * 100, 1)}%)</span>
              </div>
              <div className="mt-0.5 text-zinc-500">Entrada {fmtPrice(p.avgPx)} · atual {fmtPrice(p.markPx)} · liquidação {fmtPrice(p.liqPx)}</div>
              <button onClick={() => closeDemo(p.instId.replace('-SWAP', '') as InstId)} disabled={demoBusy} className="mt-2 inline-flex items-center gap-1 rounded-lg bg-zinc-800 px-2.5 py-1 text-[11px] disabled:opacity-50">
                <X className="h-3 w-3" /> Fechar na Demo
              </button>
            </div>
          ))}
          <div className="mt-3 text-[11px] font-semibold text-zinc-400">Últimas ordens na Demo</div>
          {demoStatus.orders.length ? (
            <ul className="mt-1 divide-y divide-zinc-800/70 text-[11px]">
              {demoStatus.orders.slice(0, 10).map((o) => (
                <li key={o.ordId} className="flex justify-between gap-2 py-1.5">
                  <span className="text-zinc-400">{fmtDateTime(o.cTime)} · {o.instId.replace('-USDT-SWAP', '')} {o.side === 'buy' ? 'compra' : 'venda'} {o.sz} @ {fmtPrice(o.avgPx)}{o.category && o.category !== 'normal' ? ` (${o.category})` : ''}</span>
                  <span className={pnlColor(o.pnl)}>{o.pnl ? usdt(o.pnl, true) : ''}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Nenhuma ordem na Demo ainda.</Empty>
          )}
        </>
      ) : (
        <p className="mt-3 text-xs text-zinc-500">Toque em Atualizar para ver saldo, posições e ordens da conta Demo.</p>
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
