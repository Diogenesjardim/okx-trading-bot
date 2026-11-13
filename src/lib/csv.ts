import type { Trade } from '../types';

const n = (v: number, d = 2) => v.toFixed(d).replace('.', ',');
const dt = (ts: number) => new Date(ts).toLocaleString('pt-BR');

/** CSV com ";" e vírgula decimal (abre direto no Excel em português). */
export function tradesToCsv(trades: Trade[]): string {
  const header = ['Entrada (data)', 'Saída (data)', 'Ativo', 'Tempo gráfico', 'Tipo', 'Alavancagem', 'Preço entrada', 'Preço saída', 'Quantidade', 'Margem (USD)', 'Motivo da saída', 'Resultado bruto (USD)', 'Taxas (USD)', 'Resultado líquido (USD)', 'Resultado % margem'];
  const rows = trades.map((t) => [
    dt(t.entryTime), dt(t.exitTime), t.instId.replace('-', '/'), t.timeframe, t.side, `${t.leverage}X`,
    n(t.entryPrice, 4), n(t.exitPrice, 4), n(t.qty, 6), n(t.margin), t.exitReason, t.grossPnl == null ? '' : n(t.grossPnl, 4), n(t.fees, 4), n(t.pnl, 4), n(t.pnlPctMargin),
  ]);
  return '﻿' + [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
}

/** Tenta baixar o arquivo. Retorna false se o navegador/ambiente bloquear. */
export function downloadText(filename: string, content: string, mime = 'text/csv;charset=utf-8'): boolean {
  try {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  } catch {
    return false;
  }
}
