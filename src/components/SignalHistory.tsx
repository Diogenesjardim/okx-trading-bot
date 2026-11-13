import { useState } from 'react';
import { instLabel } from '../types';
import type { SignalRecord } from '../lib/analystEngine';
import { fmtDateTime, fmtNum, fmtPrice } from '../lib/format';
import { DecisionTag, NoDecision, SignalPill } from './status';
import { Empty } from './ui';

export function SignalHistory({ signals, limit = 20, compact = false }: { signals: SignalRecord[]; limit?: number; compact?: boolean }) {
  const [n, setN] = useState(limit);
  if (!signals.length) return <Empty>Nenhum sinal registrado ainda. Os sinais aparecem quando um candle fecha com cruzamento SMA9/SMA21.</Empty>;
  return (
    <div>
      <ul className="divide-y divide-zinc-800/70">
        {signals.slice(0, n).map((r) => (
          <li key={r.id} className="py-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {r.blockedByRsi ? (
                  <span className="rounded-lg bg-zinc-800 px-2 py-0.5 text-[10px] font-bold text-zinc-400">{r.side} bloqueado (RSI)</span>
                ) : (
                  <SignalPill signal={r.side} size="sm" />
                )}
                <span className="text-xs font-semibold text-zinc-200">{instLabel(r.instId)} · {r.tf}</span>
              </div>
              <span className="text-[11px] tabular-nums text-zinc-500">{fmtDateTime(r.closeTime)}</span>
            </div>
            <div className="mt-1 text-[11px] tabular-nums text-zinc-400">
              Preço {fmtPrice(r.price)} · RSI {fmtNum(r.rsi, 1)}
              {!r.blockedByRsi && <> · SL sug. {fmtPrice(r.suggestedStop)} · TP sug. {fmtPrice(r.suggestedTake)}</>}
            </div>
            {!compact && <p className="mt-1 text-[11px] leading-snug text-zinc-500">{r.reason}</p>}
            <div className="mt-1 space-y-0.5">
              {r.decisions.length ? r.decisions.map((d, i) => <DecisionTag key={i} d={d} />) : <NoDecision />}
            </div>
          </li>
        ))}
      </ul>
      {signals.length > n && (
        <button onClick={() => setN(n + limit)} className="mt-2 w-full rounded-lg bg-zinc-800 py-1.5 text-xs text-zinc-200">
          Ver mais ({signals.length - n})
        </button>
      )}
    </div>
  );
}
