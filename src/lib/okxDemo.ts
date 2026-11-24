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
  quote: 'BRL' | 'USDT'; // moeda da conta Demo (OKX Brasil: BRL)
  orderValue: number; // valor de cada compra na Demo, na moeda `quote`
}

export interface DemoLog {
  ts: number;
  action: 'abrir' | 'fechar' | 'status';
  ok: boolean;
  msg: string;
}

export interface DemoState {
  config: DemoConfig;
  log: DemoLog[];
  handled: string[]; // "open:<posId>" / "close:<posId>" já enviados (evita ordem duplicada)
}

export const DEFAULT_DEMO: DemoState = { config: { enabled: false, url: '', token: '', quote: 'BRL', orderValue: 500 }, log: [], handled: [] };

export interface DemoStatus {
  quote: string;
  balances: Record<string, { eq: number; avail: number }>;
  orders: { ordId: string; clOrdId: string; instId: string; side: string; avgPx: number; sz: string; state: string; fee: number; feeCcy: string; cTime: number; source: string }[];
  protections: { algoId: string; instId: string; sz: string; slTriggerPx: number | null; tpTriggerPx: number | null }[];
}

export const demoReady = (c: DemoConfig) => /^https:\/\/.+/.test(c.url.trim()) && c.token.trim().length >= 8;

/** Roda a função no Supabase de São Paulo (sa-east-1): a OKX recusa chamadas vindas de IPs dos EUA. */
export function functionUrl(raw: string): string {
  const url = raw.trim();
  try {
    const u = new URL(url);
    if (u.hostname.endsWith('.supabase.co') && !u.searchParams.has('forceFunctionRegion')) u.searchParams.set('forceFunctionRegion', 'sa-east-1');
    return u.toString();
  } catch {
    return url;
  }
}

export async function demoCall<T>(cfg: DemoConfig, action: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!demoReady(cfg)) throw new Error('Configure a URL da função e o token (mín. 8 caracteres) em Config.');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(functionUrl(cfg.url), {
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

/** Compra à vista na Demo: SL/TP vão em % e são recalculados pelo preço do par negociado (ex.: ETH-BRL). */
export const openPayload = (p: Position, c: DemoConfig) => ({
  instId: p.instId, quote: c.quote, orderValue: c.orderValue,
  stopLossPct: +(((p.entryPrice - p.stopPrice) / p.entryPrice) * 100).toFixed(3),
  takeProfitPct: +(((p.takePrice - p.entryPrice) / p.entryPrice) * 100).toFixed(3),
  ref: p.signalId ?? p.id,
});

export const closePayload = (p: Position, c: DemoConfig) => ({ instId: p.instId, quote: c.quote, ref: p.signalId ?? p.id });
