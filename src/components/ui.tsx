import { useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, Info, RefreshCw } from 'lucide-react';
import { fmtTime } from '../lib/format';

export function Card({ title, icon, right, children, className = '' }: {
  title?: ReactNode; icon?: ReactNode; right?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 ${className}`}>
      {(title || right) && (
        <header className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
            {icon}
            {title}
          </h2>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, valueClass = 'text-zinc-100' }: {
  label: string; value: ReactNode; sub?: ReactNode; valueClass?: string;
}) {
  return (
    <div className="rounded-xl bg-zinc-950/60 p-3 ring-1 ring-zinc-800">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${valueClass}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const sandbox = import.meta.env.VITE_SANDBOX_PREVIEW === '1';
  return (
    <div className="rounded-xl border border-rose-900/60 bg-rose-950/40 p-3 text-sm text-rose-200">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="flex-1">
          <p>{message}</p>
          {sandbox && (
            <p className="mt-1 text-xs text-rose-300/80">
              Esta prévia roda em um ambiente que bloqueia conexões com sites externos. Publique o projeto (ex.: Vercel) para ver os dados reais da OKX.
            </p>
          )}
        </div>
      </div>
      {onRetry && (
        <button onClick={onRetry} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-rose-900/60 px-3 py-1.5 text-xs font-medium hover:bg-rose-800/70">
          <RefreshCw className="h-3.5 w-3.5" /> Tentar novamente
        </button>
      )}
    </div>
  );
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  const cls = tone === 'warn' ? 'border-amber-900/60 bg-amber-950/30 text-amber-200' : 'border-zinc-800 bg-zinc-900/60 text-zinc-400';
  return (
    <div className={`flex gap-2 rounded-xl border p-3 text-xs leading-relaxed ${cls}`}>
      {tone === 'warn' ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <Info className="h-4 w-4 shrink-0" />}
      <div>{children}</div>
    </div>
  );
}

export function UpdatedAt({ ts, loading, onRefresh }: { ts: number | null; loading?: boolean; onRefresh?: () => void }) {
  return (
    <button onClick={onRefresh} disabled={!onRefresh} className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300">
      <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
      {ts ? `Atualizado ${fmtTime(ts)}` : loading ? 'Carregando…' : 'Sem dados'}
    </button>
  );
}

export function Segmented<T extends string | number>({ options, value, onChange, disabled }: {
  options: { id: T; label: string }[]; value: T; onChange: (v: T) => void; disabled?: boolean;
}) {
  return (
    <div className="flex rounded-xl bg-zinc-950 p-1 ring-1 ring-zinc-800">
      {options.map((o) => (
        <button
          key={String(o.id)}
          disabled={disabled}
          onClick={() => onChange(o.id)}
          className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
            value === o.id ? 'bg-zinc-800 text-white shadow' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function NumberField({ label, value, onChange, step = 0.1, min = 0, max, suffix, disabled, hint }: {
  label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number;
  suffix?: string; disabled?: boolean; hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-zinc-400">{label}</span>
      <div className="mt-1 flex items-center rounded-xl bg-zinc-950 ring-1 ring-zinc-800 focus-within:ring-emerald-600">
        <input
          type="number"
          inputMode="decimal"
          className="w-full bg-transparent px-3 py-2 text-base text-zinc-100 outline-none disabled:opacity-50"
          value={Number.isFinite(value) ? value : ''}
          step={step}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
        />
        {suffix && <span className="pr-3 text-xs text-zinc-500">{suffix}</span>}
      </div>
      {hint && <span className="mt-1 block text-[11px] text-zinc-500">{hint}</span>}
    </label>
  );
}

export function Toggle({ label, checked, onChange, disabled, hint }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string;
}) {
  return (
    <label className={`flex items-start justify-between gap-3 ${disabled ? 'opacity-50' : ''}`}>
      <span>
        <span className="text-sm text-zinc-200">{label}</span>
        {hint && <span className="block text-[11px] text-zinc-500">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-emerald-600' : 'bg-zinc-700'}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </label>
  );
}

export function SideBadge({ side }: { side: 'LONG' | 'SHORT' }) {
  return (
    <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${side === 'LONG' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}`}>
      {side}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-zinc-500">{children}</p>;
}

export function ChipMulti<T extends string>({ options, value, onChange, disabled, min = 1 }: {
  options: { id: T; label: string }[]; value: T[]; onChange: (v: T[]) => void; disabled?: boolean; min?: number;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            disabled={disabled || (on && value.length <= min)}
            onClick={() => onChange(on ? value.filter((x) => x !== o.id) : [...value, o.id])}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ring-1 transition disabled:opacity-60 ${
              on ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40' : 'bg-zinc-950 text-zinc-400 ring-zinc-800'
            }`}
          >
            {on ? '✓ ' : ''}{o.label}
          </button>
        );
      })}
    </div>
  );
}

export function ConfirmButton({ label, confirmText, onConfirm, className = '', icon, disabled }: {
  label: string; confirmText: string; onConfirm: () => void; className?: string; icon?: ReactNode; disabled?: boolean;
}) {
  const [ask, setAsk] = useState(false);
  if (ask)
    return (
      <div className="w-full space-y-2 rounded-xl bg-zinc-950/70 p-3 ring-1 ring-zinc-800">
        <p className="text-sm text-zinc-300">{confirmText}</p>
        <div className="flex gap-2">
          <button onClick={() => { setAsk(false); onConfirm(); }} className="flex-1 rounded-lg bg-rose-600 py-2 text-sm font-semibold text-white">Confirmar</button>
          <button onClick={() => setAsk(false)} className="flex-1 rounded-lg bg-zinc-800 py-2 text-sm text-zinc-200">Cancelar</button>
        </div>
      </div>
    );
  return (
    <button disabled={disabled} onClick={() => setAsk(true)} className={`inline-flex items-center justify-center gap-1.5 disabled:opacity-40 ${className}`}>
      {icon}{label}
    </button>
  );
}
