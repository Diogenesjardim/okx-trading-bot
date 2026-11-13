import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Copy, Download, Plus, Scale, X } from 'lucide-react';
import { INSTRUMENTS, instLabel, type InstId, type Side } from '../types';
import { useBots } from '../hooks/BotsContext';
import { KEYS, load, save } from '../lib/storage';
import { estimateFee, journalStats, journalToCsv, realGross, realNet, validateOpen, type RealTrade } from '../lib/journal';
import { isBlocked } from '../lib/analystEngine';
import { computeStats } from '../lib/metrics';
import { uid } from '../lib/tradeMath';
import { downloadText } from '../lib/csv';
import { fmtDateTime, fmtNum, fmtPct, fmtPrice, fmtSignedUSD, pnlColor } from '../lib/format';
import { Card, ConfirmButton, Empty, Notice, NumberField, Segmented, SideBadge } from '../components/ui';

const usdt = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2).replace('.', ',')} USDT`);

interface Draft {
  instId: InstId;
  side: Side;
  entryPrice: number;
  amount: number;
  leverage: 1 | 2 | 3;
  stopPrice: number;
  takePrice: number;
  entryFee: number;
  signalId: string | null;
  notes: string;
}

export function Journal() {
  const { analyst, sim, tickers } = useBots();
  const [trades, setTrades] = useState<RealTrade[]>(() => load(KEYS.journal, []));
  const [showForm, setShowForm] = useState(false);
  const [closing, setClosing] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => save(KEYS.journal, trades), [trades]);

  const stats = useMemo(() => journalStats(trades), [trades]);
  const simStats = computeStats(sim.trades, sim.config.initialCapital);
  const realAvgPct = useMemo(() => {
    const c = trades.filter((t) => t.exitPrice != null);
    return c.length ? c.reduce((a, t) => a + (realNet(t)! / t.amount) * 100, 0) / c.length : null;
  }, [trades]);
  const simAvgPct = sim.trades.length ? sim.trades.reduce((a, t) => a + t.pnlPctMargin, 0) / sim.trades.length : null;

  const open = trades.filter((t) => t.exitPrice == null);
  const closed = trades.filter((t) => t.exitPrice != null).sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));

  const add = (d: Draft) => {
    setTrades((ts) => [{
      id: uid(), instId: d.instId, side: d.side, openedAt: Date.now(), entryPrice: d.entryPrice, amount: d.amount, leverage: d.leverage,
      stopPrice: d.stopPrice > 0 ? d.stopPrice : null, takePrice: d.takePrice > 0 ? d.takePrice : null, entryFee: d.entryFee || 0,
      signalId: d.signalId, notes: d.notes.trim(), closedAt: null, exitPrice: null, exitFee: 0, exitReason: null,
    }, ...ts]);
    setShowForm(false);
  };

  const close = (id: string, exitPrice: number, exitFee: number, reason: RealTrade['exitReason']) => {
    setTrades((ts) => ts.map((t) => (t.id === id ? { ...t, exitPrice, exitFee, exitReason: reason, closedAt: Date.now() } : t)));
    setClosing(null);
  };

  const exportCsv = async (mode: 'download' | 'copy') => {
    const csv = journalToCsv(trades);
    if (mode === 'download') setMsg(downloadText('diario-operacoes-reais.csv', csv) ? 'Download iniciado.' : 'Download bloqueado. Use Copiar.');
    else {
      try {
        await navigator.clipboard.writeText(csv);
        setMsg('CSV copiado.');
      } catch {
        setMsg('Não foi possível copiar.');
      }
    }
  };

  return (
    <>
      <Card title="Diário de operações reais" icon={<BookOpen className="h-4 w-4 text-amber-400" />} right={<span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">DINHEIRO REAL</span>}>
        <p className="text-xs leading-relaxed text-zinc-400">
          O app <b className="text-zinc-200">não envia ordens</b>. Você opera no app da OKX e registra aqui, para comparar o resultado real com o simulador. Estes dados ficam separados dos fictícios.
        </p>
        {stats.withoutStop > 0 && (
          <div className="mt-3"><Notice tone="warn">{stats.withoutStop} operação(ões) aberta(s) sem Stop Loss registrado. Configure o stop também na OKX.</Notice></div>
        )}
        {!showForm ? (
          <button onClick={() => setShowForm(true)} className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white">
            <Plus className="h-4 w-4" /> Registrar entrada
          </button>
        ) : (
          <NewTradeForm
            signals={analyst.signals.filter((s) => !isBlocked(s)).slice(0, 10)}
            prices={{ 'BTC-USDT': tickers['BTC-USDT']?.last, 'ETH-USDT': tickers['ETH-USDT']?.last }}
            onCancel={() => setShowForm(false)}
            onSave={add}
          />
        )}
      </Card>

      <Card title="Real × simulador" icon={<Scale className="h-4 w-4 text-sky-400" />}>
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[340px] text-left text-xs tabular-nums">
            <thead className="text-[10px] uppercase text-zinc-500">
              <tr className="border-b border-zinc-800"><th className="py-2 font-medium" /><th className="font-medium">Real (diário)</th><th className="font-medium">Simulador</th></tr>
            </thead>
            <tbody>
              <Row k="Operações fechadas" a={stats.closed} b={simStats.count} />
              <Row k="Taxa de acerto" a={fmtPct(stats.winRate, 0)} b={fmtPct(simStats.winRate, 0)} />
              <Row k="Média por operação (% da margem)" a={<span className={pnlColor(realAvgPct)}>{fmtPct(realAvgPct, 2, true)}</span>} b={<span className={pnlColor(simAvgPct)}>{fmtPct(simAvgPct, 2, true)}</span>} />
              <Row k="Resultado" a={<span className={pnlColor(stats.net)}>{usdt(stats.closed ? stats.net : null)}</span>} b={<span className={pnlColor(simStats.pnl)}>{fmtSignedUSD(simStats.count ? simStats.pnl : null)} <span className="text-zinc-600">(fict.)</span></span>} />
              <Row k="Maior perda" a={usdt(stats.maxLoss)} b={fmtSignedUSD(simStats.maxLoss)} />
              <Row k="Taxas" a={`${fmtNum(stats.fees, 2)} USDT`} b={fmtSignedUSD(simStats.count ? -simStats.totalFees : null)} />
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-zinc-500">Compare principalmente a <b>média % por operação</b>: os valores investidos são diferentes. Com menos de 20 operações reais, a comparação ainda é pouco confiável.</p>
      </Card>

      <Card title={`Abertas (${open.length})`}>
        {open.length ? (
          <ul className="space-y-3">
            {open.map((t) => {
              const price = tickers[t.instId]?.last;
              const upnl = price ? realGross(t, price) - t.entryFee : null;
              return (
                <li key={t.id} className="rounded-xl bg-zinc-950/60 p-3 ring-1 ring-zinc-800">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm"><SideBadge side={t.side} /> {instLabel(t.instId)} · {t.leverage}X · {fmtNum(t.amount, 2)} USDT</span>
                    <span className={`text-sm font-semibold ${pnlColor(upnl)}`}>{usdt(upnl)}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-zinc-500">
                    Entrada {fmtPrice(t.entryPrice)} · SL {fmtPrice(t.stopPrice)} · TP {fmtPrice(t.takePrice)} · {fmtDateTime(t.openedAt)}
                    {price ? ` · atual ${fmtPrice(price)}` : ' · ative o Analista para ver o preço atual'}
                  </div>
                  {t.notes && <p className="mt-1 text-[11px] italic text-zinc-500">{t.notes}</p>}
                  {closing === t.id ? (
                    <CloseForm trade={t} price={price} onCancel={() => setClosing(null)} onSave={(p, f, r) => close(t.id, p, f, r)} />
                  ) : (
                    <div className="mt-2 flex gap-2">
                      <button onClick={() => setClosing(t.id)} className="flex-1 rounded-lg bg-zinc-800 py-1.5 text-xs font-semibold">Registrar saída</button>
                      <ConfirmButton label="Excluir" confirmText="Excluir este registro?" onConfirm={() => setTrades((ts) => ts.filter((x) => x.id !== t.id))} className="rounded-lg px-3 text-xs text-zinc-500" />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty>Nenhuma operação real aberta.</Empty>
        )}
      </Card>

      <Card
        title={`Fechadas (${closed.length})`}
        right={
          <div className="flex gap-1.5">
            <button disabled={!trades.length} onClick={() => exportCsv('download')} className="inline-flex items-center gap-1 rounded-lg bg-zinc-800 px-2 py-1 text-[11px] disabled:opacity-40"><Download className="h-3 w-3" />CSV</button>
            <button disabled={!trades.length} onClick={() => exportCsv('copy')} className="inline-flex items-center gap-1 rounded-lg bg-zinc-800 px-2 py-1 text-[11px] disabled:opacity-40"><Copy className="h-3 w-3" />Copiar</button>
          </div>
        }
      >
        {msg && <p className="mb-2 text-[11px] text-zinc-500">{msg}</p>}
        {closed.length ? (
          <ul className="divide-y divide-zinc-800/70">
            {closed.map((t) => {
              const net = realNet(t)!;
              const simTrade = t.signalId ? sim.trades.find((s) => s.signalId === t.signalId) : undefined;
              return (
                <li key={t.id} className="py-2.5">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-xs"><SideBadge side={t.side} /> {instLabel(t.instId)} · {t.leverage}X · {t.exitReason}</span>
                    <span className={`text-sm font-semibold ${pnlColor(net)}`}>{usdt(net)}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-zinc-500">
                    {fmtPrice(t.entryPrice)} → {fmtPrice(t.exitPrice)} · {fmtPct((net / t.amount) * 100, 2, true)} da margem · {fmtDateTime(t.closedAt)}
                  </div>
                  {simTrade && (
                    <div className="mt-0.5 text-[11px] text-sky-300">
                      Mesmo sinal no simulador: {fmtPct(simTrade.pnlPctMargin, 2, true)} ({simTrade.exitReason})
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty>Nenhuma operação real fechada ainda.</Empty>
        )}
        {trades.length > 0 && (
          <div className="mt-3"><ConfirmButton label="Apagar diário" confirmText="Apagar todos os registros reais deste aparelho?" onConfirm={() => setTrades([])} className="w-full text-xs text-zinc-500" /></div>
        )}
      </Card>

      <Notice tone="warn">
        Use só valores que você aceita perder. Prefira 1X e coloque Stop Loss na própria OKX. Os dados ficam só neste aparelho: exporte o CSV de vez em quando. Não é recomendação de investimento.
      </Notice>
    </>
  );
}

function Row({ k, a, b }: { k: string; a: React.ReactNode; b: React.ReactNode }) {
  return (
    <tr className="border-b border-zinc-800/60">
      <td className="py-2 pr-2 text-zinc-400">{k}</td>
      <td className="pr-2 text-zinc-200">{a}</td>
      <td className="text-zinc-300">{b}</td>
    </tr>
  );
}

function NewTradeForm({ signals, prices, onCancel, onSave }: {
  signals: ReturnType<typeof useBots>['analyst']['signals'];
  prices: Partial<Record<InstId, number | undefined>>;
  onCancel: () => void;
  onSave: (d: Draft) => void;
}) {
  const [d, setD] = useState<Draft>({
    instId: 'ETH-USDT', side: 'LONG', entryPrice: prices['ETH-USDT'] ?? NaN, amount: 10, leverage: 1,
    stopPrice: NaN, takePrice: NaN, entryFee: estimateFee(10, 1), signalId: null, notes: '',
  });
  const errors = validateOpen({ ...d, stopPrice: Number.isFinite(d.stopPrice) ? d.stopPrice : null, takePrice: Number.isFinite(d.takePrice) ? d.takePrice : null });
  const fromSignal = (id: string) => {
    const s = signals.find((x) => x.id === id);
    if (!s) return setD({ ...d, signalId: null });
    setD({ ...d, signalId: s.id, instId: s.instId, side: s.side, entryPrice: prices[s.instId] ?? s.price, stopPrice: +s.suggestedStop.toFixed(2), takePrice: +s.suggestedTake.toFixed(2) });
  };
  const set = (patch: Partial<Draft>) => {
    const next = { ...d, ...patch };
    if (patch.amount !== undefined || patch.leverage !== undefined) next.entryFee = +estimateFee(next.amount || 0, next.leverage).toFixed(4);
    setD(next);
  };
  return (
    <div className="mt-3 space-y-3 rounded-xl bg-zinc-950/60 p-3 ring-1 ring-zinc-800">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">Nova entrada real</span>
        <button onClick={onCancel} className="text-zinc-500"><X className="h-4 w-4" /></button>
      </div>
      <label className="block">
        <span className="text-xs text-zinc-400">Baseada em um sinal do Analista (opcional)</span>
        <select value={d.signalId ?? ''} onChange={(e) => fromSignal(e.target.value)} className="mt-1 w-full rounded-xl bg-zinc-950 px-3 py-2 text-sm text-zinc-100 ring-1 ring-zinc-800">
          <option value="">Entrada manual (sem sinal)</option>
          {signals.map((s) => (
            <option key={s.id} value={s.id}>{s.side} {instLabel(s.instId)} {s.tf} · {fmtDateTime(s.closeTime)}</option>
          ))}
        </select>
      </label>
      <Segmented options={INSTRUMENTS.map((i) => ({ id: i.id, label: i.label }))} value={d.instId} onChange={(v) => set({ instId: v, entryPrice: prices[v] ?? d.entryPrice })} />
      <Segmented options={[{ id: 'LONG' as Side, label: 'LONG' }, { id: 'SHORT' as Side, label: 'SHORT' }]} value={d.side} onChange={(v) => set({ side: v })} />
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Preço de entrada" step={0.01} value={d.entryPrice} onChange={(v) => set({ entryPrice: v })} hint="o preço executado na OKX" />
        <NumberField label="Valor investido" suffix="USDT" step={1} value={d.amount} onChange={(v) => set({ amount: v })} />
        <NumberField label="Stop Loss" step={0.01} value={d.stopPrice} onChange={(v) => set({ stopPrice: v })} />
        <NumberField label="Take Profit" step={0.01} value={d.takePrice} onChange={(v) => set({ takePrice: v })} />
        <NumberField label="Taxa de entrada" suffix="USDT" step={0.0001} value={d.entryFee} onChange={(v) => set({ entryFee: v })} hint="estimada; corrija com o valor da OKX" />
      </div>
      <div>
        <span className="text-xs text-zinc-400">Alavancagem</span>
        <div className="mt-1"><Segmented options={[{ id: 1, label: '1X' }, { id: 2, label: '2X' }, { id: 3, label: '3X' }]} value={d.leverage} onChange={(v) => set({ leverage: v as 1 | 2 | 3 })} /></div>
      </div>
      <label className="block">
        <span className="text-xs text-zinc-400">Notas (opcional)</span>
        <input value={d.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="ex.: entrei atrasado, spread alto…" className="mt-1 w-full rounded-xl bg-zinc-950 px-3 py-2 text-base text-zinc-100 ring-1 ring-zinc-800" />
      </label>
      {errors.length > 0 && <ul className="text-[11px] text-rose-400">{errors.map((e) => <li key={e}>• {e}</li>)}</ul>}
      {!(d.stopPrice > 0) && <p className="text-[11px] text-amber-400">Sem Stop Loss: recomendado definir um, também na OKX.</p>}
      <button disabled={errors.length > 0} onClick={() => onSave(d)} className="w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Salvar entrada</button>
    </div>
  );
}

function CloseForm({ trade, price, onCancel, onSave }: {
  trade: RealTrade; price?: number; onCancel: () => void; onSave: (exitPrice: number, exitFee: number, reason: RealTrade['exitReason']) => void;
}) {
  const [exit, setExit] = useState<number>(price ?? NaN);
  const [reason, setReason] = useState<NonNullable<RealTrade['exitReason']>>('Manual');
  const [fee, setFee] = useState<number>(+estimateFee(trade.amount, trade.leverage).toFixed(4));
  const pick = (r: NonNullable<RealTrade['exitReason']>) => {
    setReason(r);
    if (r === 'Stop Loss' && trade.stopPrice) setExit(trade.stopPrice);
    if (r === 'Take Profit' && trade.takePrice) setExit(trade.takePrice);
  };
  const preview = Number.isFinite(exit) && exit > 0 ? realGross(trade, exit) - trade.entryFee - (fee || 0) : null;
  return (
    <div className="mt-2 space-y-2">
      <Segmented options={[{ id: 'Stop Loss' as const, label: 'Stop' }, { id: 'Take Profit' as const, label: 'Alvo' }, { id: 'Manual' as const, label: 'Manual' }]} value={reason} onChange={pick} />
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Preço de saída" step={0.01} value={exit} onChange={setExit} />
        <NumberField label="Taxa de saída" suffix="USDT" step={0.0001} value={fee} onChange={setFee} />
      </div>
      {preview != null && <p className={`text-xs ${pnlColor(preview)}`}>Resultado líquido: {usdt(preview)}</p>}
      <div className="flex gap-2">
        <button disabled={!(exit > 0)} onClick={() => onSave(exit, fee || 0, reason)} className="flex-1 rounded-lg bg-emerald-600 py-1.5 text-xs font-semibold text-white disabled:opacity-40">Confirmar saída</button>
        <button onClick={onCancel} className="rounded-lg bg-zinc-800 px-3 text-xs">Cancelar</button>
      </div>
    </div>
  );
}
