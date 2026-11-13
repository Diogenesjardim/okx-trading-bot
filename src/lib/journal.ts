import type { InstId, Side } from '../types';

/**
 * DIÁRIO DE OPERAÇÕES REAIS — registro MANUAL.
 * O app não envia ordens: o usuário opera na OKX e registra aqui para comparar com o simulador.
 * Dados reais ficam separados dos fictícios (chave própria no LocalStorage).
 */

export interface RealTrade {
  id: string;
  instId: InstId;
  side: Side;
  openedAt: number;
  entryPrice: number;
  amount: number; // valor investido (margem) em USDT
  leverage: number;
  stopPrice: number | null;
  takePrice: number | null;
  entryFee: number; // USDT
  signalId: string | null; // sinal do Robô Analista que motivou a entrada (opcional)
  notes: string;
  closedAt: number | null;
  exitPrice: number | null;
  exitFee: number;
  exitReason: 'Stop Loss' | 'Take Profit' | 'Manual' | null;
}

export const qtyOf = (t: Pick<RealTrade, 'amount' | 'leverage' | 'entryPrice'>) => (t.amount * t.leverage) / t.entryPrice;

/** Resultado bruto (sem taxas) a um preço. */
export function realGross(t: RealTrade, price: number) {
  const dir = t.side === 'LONG' ? 1 : -1;
  return (price - t.entryPrice) * qtyOf(t) * dir;
}

/** Resultado líquido de uma operação fechada (null se aberta). */
export function realNet(t: RealTrade): number | null {
  if (t.exitPrice == null) return null;
  return realGross(t, t.exitPrice) - t.entryFee - t.exitFee;
}

/** Taxa estimada (taker OKX ≈ 0,05% do valor nocional) — o usuário pode corrigir com o valor real. */
export const estimateFee = (amount: number, leverage: number, feePct = 0.05) => (amount * leverage * feePct) / 100;

export function validateOpen(t: Partial<RealTrade>): string[] {
  const e: string[] = [];
  if (!t.entryPrice || t.entryPrice <= 0) e.push('Informe o preço de entrada.');
  if (!t.amount || t.amount <= 0) e.push('Informe o valor investido.');
  if (!t.leverage || t.leverage < 1 || t.leverage > 3) e.push('Alavancagem entre 1X e 3X.');
  if (t.entryPrice && t.stopPrice != null && t.stopPrice > 0) {
    if (t.side === 'LONG' && t.stopPrice >= t.entryPrice) e.push('Em LONG o Stop Loss deve ficar abaixo da entrada.');
    if (t.side === 'SHORT' && t.stopPrice <= t.entryPrice) e.push('Em SHORT o Stop Loss deve ficar acima da entrada.');
  }
  if (t.entryPrice && t.takePrice != null && t.takePrice > 0) {
    if (t.side === 'LONG' && t.takePrice <= t.entryPrice) e.push('Em LONG o Take Profit deve ficar acima da entrada.');
    if (t.side === 'SHORT' && t.takePrice >= t.entryPrice) e.push('Em SHORT o Take Profit deve ficar abaixo da entrada.');
  }
  return e;
}

export interface JournalStats {
  closed: number;
  open: number;
  wins: number;
  winRate: number | null;
  net: number;
  invested: number; // soma das margens das fechadas
  netPctOnInvested: number | null;
  avg: number | null;
  maxLoss: number | null;
  fees: number;
  withoutStop: number; // operações abertas sem Stop Loss registrado (alerta de risco)
}

export function journalStats(trades: RealTrade[]): JournalStats {
  const closed = trades.filter((t) => t.exitPrice != null);
  const nets = closed.map((t) => realNet(t)!);
  const net = nets.reduce((a, b) => a + b, 0);
  const invested = closed.reduce((a, t) => a + t.amount, 0);
  const losses = nets.filter((n) => n <= 0);
  return {
    closed: closed.length,
    open: trades.length - closed.length,
    wins: nets.filter((n) => n > 0).length,
    winRate: closed.length ? (nets.filter((n) => n > 0).length / closed.length) * 100 : null,
    net,
    invested,
    netPctOnInvested: invested > 0 ? (net / invested) * 100 : null,
    avg: closed.length ? net / closed.length : null,
    maxLoss: losses.length ? Math.min(...losses) : null,
    fees: trades.reduce((a, t) => a + t.entryFee + t.exitFee, 0),
    withoutStop: trades.filter((t) => t.exitPrice == null && !t.stopPrice).length,
  };
}

export function journalToCsv(trades: RealTrade[]): string {
  const n = (v: number | null, d = 4) => (v == null ? '' : v.toFixed(d).replace('.', ','));
  const dt = (ts: number | null) => (ts ? new Date(ts).toLocaleString('pt-BR') : '');
  const head = ['Abertura', 'Fechamento', 'Ativo', 'Tipo', 'Alavancagem', 'Valor (USDT)', 'Entrada', 'Saída', 'Stop', 'Alvo', 'Taxas (USDT)', 'Resultado líquido (USDT)', 'Motivo', 'Sinal', 'Notas'];
  const rows = trades.map((t) => [
    dt(t.openedAt), dt(t.closedAt), t.instId.replace('-', '/'), t.side, `${t.leverage}X`, n(t.amount, 2), n(t.entryPrice), n(t.exitPrice),
    n(t.stopPrice), n(t.takePrice), n(t.entryFee + t.exitFee), n(realNet(t)), t.exitReason ?? '', t.signalId ?? '', t.notes,
  ]);
  return '﻿' + [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
}
