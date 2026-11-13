const usd = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD' });

export const fmtUSD = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : usd.format(v));

export const fmtSignedUSD = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + usd.format(Math.abs(v));

export function fmtPrice(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return '—';
  const digits = v >= 1000 ? 2 : v >= 1 ? 3 : 6;
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: digits });
}

export const fmtNum = (v: number | null | undefined, d = 2) =>
  v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

export const fmtPct = (v: number | null | undefined, d = 2, signed = false) =>
  v == null || !Number.isFinite(v) ? '—' : `${signed && v > 0 ? '+' : ''}${fmtNum(v, d)}%`;

export const fmtDateTime = (ts: number | null | undefined) =>
  ts == null ? '—' : new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

export const fmtTime = (ts: number | null | undefined) =>
  ts == null ? '—' : new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export const fmtShort = (ts: number) =>
  new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export const pnlColor = (v: number | null | undefined) =>
  v == null || v === 0 ? 'text-zinc-300' : v > 0 ? 'text-emerald-400' : 'text-rose-400';
