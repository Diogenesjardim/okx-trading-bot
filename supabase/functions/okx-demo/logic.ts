/**
 * Lógica pura do executor DEMO (sem APIs do Deno) — testada com Vitest no projeto do site.
 * O executor só opera na conta DEMO da OKX (cabeçalho x-simulated-trading: 1).
 */

/** Pares do app → contratos perpétuos (SWAP) da OKX. Só estes são aceitos. */
export const SWAP_OF: Record<string, string> = {
  'ETH-USDT': 'ETH-USDT-SWAP',
  'BTC-USDT': 'BTC-USDT-SWAP',
};

export const MAX_LEVERAGE = 3;

/** Assinatura OKX: Base64(HMAC-SHA256(secret, timestamp + MÉTODO + caminho[+query] + corpo)). */
export async function signOkx(secret: string, timestamp: string, method: string, requestPath: string, body = ''): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(timestamp + method.toUpperCase() + requestPath + body));
  let bin = '';
  new Uint8Array(sig).forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

const decimalsOf = (step: string | number) => {
  const s = String(step);
  return s.includes('.') ? s.split('.')[1].replace(/0+$/, '').length : 0;
};

/** Arredonda um preço para o passo mínimo (tickSz) do instrumento. */
export function roundToTick(px: number, tickSz: string): string {
  const t = Number(tickSz);
  const v = Math.round(px / t) * t;
  return v.toFixed(decimalsOf(tickSz));
}

/**
 * Quantidade de contratos para uma margem em USDT.
 * contratos = margem × alavancagem / (preço × ctVal), arredondado PARA BAIXO ao lotSz.
 */
export function contractsFor(a: { marginUsdt: number; leverage: number; price: number; ctVal: string; lotSz: string; minSz: string }):
  { sz: string; notional: number } | { error: string } {
  const ctVal = Number(a.ctVal);
  const lot = Number(a.lotSz);
  const min = Number(a.minSz);
  if (!(a.price > 0) || !(ctVal > 0) || !(lot > 0)) return { error: 'Dados do instrumento inválidos.' };
  const raw = (a.marginUsdt * a.leverage) / (a.price * ctVal);
  const steps = Math.floor(raw / lot + 1e-9);
  const sz = steps * lot;
  if (sz < min - 1e-12) {
    const minUsdt = (min * a.price * ctVal) / a.leverage;
    return { error: `Valor abaixo do mínimo da OKX para este contrato (≈ ${minUsdt.toFixed(2)} USDT de margem com ${a.leverage}X).` };
  }
  return { sz: sz.toFixed(decimalsOf(a.lotSz)), notional: sz * a.price * ctVal };
}

/** clOrdId da OKX: até 32 caracteres alfanuméricos. Derivado do id do sinal (idempotência). */
export function clOrdIdFrom(id: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < id.length; i++) {
    h1 = Math.imul(h1 ^ id.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 + id.charCodeAt(i), 2246822519) >>> 0;
  }
  return ('okxbot' + h1.toString(36) + h2.toString(36)).replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
}

export interface OpenRequest {
  instId: string;
  side: 'LONG' | 'SHORT';
  marginUsdt: number;
  leverage: number;
  stopPrice: number;
  takePrice: number;
  ref: string; // id do sinal/posição no app
}

export function validateOpenRequest(b: Partial<OpenRequest>, maxMargin: number): string[] {
  const e: string[] = [];
  if (!b.instId || !SWAP_OF[b.instId]) e.push('Ativo não permitido (somente BTC-USDT e ETH-USDT).');
  if (b.side !== 'LONG' && b.side !== 'SHORT') e.push('Lado inválido.');
  if (!(Number(b.marginUsdt) > 0)) e.push('Margem inválida.');
  if (Number(b.marginUsdt) > maxMargin) e.push(`Margem acima do limite de segurança (${maxMargin} USDT).`);
  if (!Number.isInteger(b.leverage) || b.leverage! < 1 || b.leverage! > MAX_LEVERAGE) e.push('Alavancagem deve ser 1, 2 ou 3.');
  if (!(Number(b.stopPrice) > 0) || !(Number(b.takePrice) > 0)) e.push('Stop Loss e Take Profit são obrigatórios.');
  if (!b.ref) e.push('Referência ausente.');
  return e;
}

/** Corpo da ordem a mercado com SL/TP anexados (executados pela própria OKX). */
export function buildOrder(a: {
  swapId: string; side: 'LONG' | 'SHORT'; sz: string; stopPx: string; takePx: string; clOrdId: string; posMode: string;
}) {
  const order: Record<string, unknown> = {
    instId: a.swapId,
    tdMode: 'isolated',
    side: a.side === 'LONG' ? 'buy' : 'sell',
    ordType: 'market',
    sz: a.sz,
    clOrdId: a.clOrdId,
    attachAlgoOrds: [
      { tpTriggerPx: a.takePx, tpOrdPx: '-1', tpTriggerPxType: 'last', slTriggerPx: a.stopPx, slOrdPx: '-1', slTriggerPxType: 'last' },
    ],
  };
  if (a.posMode === 'long_short_mode') order.posSide = a.side === 'LONG' ? 'long' : 'short';
  return order;
}
