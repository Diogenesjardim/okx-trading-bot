import type { Position } from '../types';

/**
 * Cliente do EXECUTOR DEMO (Supabase Edge Function `okx-demo`).
 * O site nunca vê as chaves da OKX: elas ficam nos Secrets do Supabase.
 * Aqui só ficam a URL da função e o token (senha) que você definiu — salvos neste aparelho.
 */

export interface DemoConfig {
  enabled: boolean; // espelhar as posições do Robô Simulador na conta Demo da OKX
  url: string;
  token: string;
}

export interface DemoLog {
  ts: number;
  action: 'abrir' | 'fechar' | 'status' | 'preparar';
  ok: boolean;
  msg: string;
}

export interface DemoState {
  config: DemoConfig;
  log: DemoLog[];
  handled: string[]; // "open:<posId>" / "close:<posId>" já enviados (evita ordem duplicada)
}

export const DEFAULT_DEMO: DemoState = { config: { enabled: false, url: '', token: '' }, log: [], handled: [] };

export interface DemoStatus {
  acctLv: string;
  posMode: string;
  usdt: { eq: number; avail: number } | null;
  positions: { instId: string; pos: string; posSide: string; avgPx: number; markPx: number; upl: number; uplRatio: number; lever: string; liqPx: number | null; margin: number; cTime: number }[];
  orders: { ordId: string; clOrdId: string; instId: string; side: string; posSide: string; avgPx: number; sz: string; state: string; fee: number; pnl: number; cTime: number; category: string }[];
}

export const demoReady = (c: DemoConfig) => /^https:\/\/.+/.test(c.url.trim()) && c.token.trim().length >= 8;

export async function demoCall<T>(cfg: DemoConfig, action: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!demoReady(cfg)) throw new Error('Configure a URL da função e o token (mín. 8 caracteres) em Config.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(cfg.url.trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bot-token': cfg.token.trim() },
      body: JSON.stringify({ action, ...payload }),
      signal: ctrl.signal,
    });
    const j = await res.json().catch(() => null);
    if (!j) throw new Error(`Resposta inválida da função (HTTP ${res.status}). Ela foi publicada no Supabase?`);
    if (!j.ok) throw new Error(j.error || `Erro HTTP ${res.status}`);
    return j.data as T;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new Error('A função não respondeu em 20 s.');
    if (e instanceof TypeError) throw new Error('Não foi possível conectar à função do Supabase. Confira a URL.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export type DemoAction = { type: 'open'; pos: Position } | { type: 'close'; pos: Position };

/** Diferença entre a posição anterior e a nova do simulador → ações na Demo (fechar antes de abrir). */
export function demoActions(prev: Position | null, next: Position | null): DemoAction[] {
  const out: DemoAction[] = [];
  if (prev && (!next || next.id !== prev.id)) out.push({ type: 'close', pos: prev });
  if (next && (!prev || prev.id !== next.id)) out.push({ type: 'open', pos: next });
  return out;
}

export const openPayload = (p: Position) => ({
  instId: p.instId, side: p.side, marginUsdt: +p.margin.toFixed(2), leverage: p.leverage,
  stopPrice: p.stopPrice, takePrice: p.takePrice, ref: p.signalId ?? p.id,
});
