/**
 * Lógica pura do executor DEMO (sem APIs do Deno) — testada com Vitest no projeto do site.
 * Modo À VISTA (spot): compra a mercado com TP/SL anexados; venda a mercado para sair.
 * O executor só opera na conta DEMO da OKX (cabeçalho x-simulated-trading: 1).
 */

export const BASES = ['BTC', 'ETH'] as const;
export const QUOTES = ['BRL', 'USDT'] as const;

/** "ETH-USDT" (par analisado) + "BRL" (moeda da conta) → "ETH-BRL" (par negociado). */
export function spotInstId(analyzedInstId: string, quote: string): string | null {
  const base = analyzedInstId.split('-')[0];
  if (!(BASES as readonly string[]).includes(base) || !(QUOTES as readonly string[]).includes(quote)) return null;
  return `${base}-${quote}`;
}

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

/** Arredonda uma quantidade PARA BAIXO ao lote (lotSz). */
export function floorToLot(qty: number, lotSz: string): number {
  const lot = Number(lotSz);
  return Math.floor(qty / lot + 1e-9) * lot;
}

/** SL/TP a partir do preço atual do par negociado e dos % configurados no simulador. */
export function levelsFromPct(price: number, stopLossPct: number, takeProfitPct: number) {
  return { stop: price * (1 - stopLossPct / 100), take: price * (1 + takeProfitPct / 100) };
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

export interface SpotOpenRequest {
  instId: string; // par analisado, ex.: ETH-USDT
  quote: 'BRL' | 'USDT'; // moeda da conta Demo
  orderValue: number; // valor da compra, na moeda `quote`
  stopLossPct: number;
  takeProfitPct: number;
  ref: string; // id do sinal/posição no app (vira o clOrdId)
}

export function validateSpotOpen(b: Partial<SpotOpenRequest>, maxValue: Record<string, number>): string[] {
  const e: string[] = [];
  if (!b.instId || !b.quote || !spotInstId(b.instId, b.quote)) e.push('Par não permitido (somente BTC ou ETH, em BRL ou USDT).');
  const max = b.quote ? maxValue[b.quote] : undefined;
  if (!(Number(b.orderValue) > 0)) e.push('Valor da ordem inválido.');
  else if (max != null && Number(b.orderValue) > max) e.push(`Valor acima do limite de segurança (${max} ${b.quote}).`);
  if (!(Number(b.stopLossPct) > 0 && Number(b.stopLossPct) < 50)) e.push('Stop Loss % inválido.');
  if (!(Number(b.takeProfitPct) > 0 && Number(b.takeProfitPct) < 200)) e.push('Take Profit % inválido.');
  if (!b.ref) e.push('Referência ausente.');
  return e;
}

/** Compra a mercado gastando `orderValue` na moeda de cotação, com SL/TP executados pela OKX. */
export function buildSpotBuy(a: { instId: string; orderValue: number; stopPx: string; takePx: string; clOrdId: string }) {
  return {
    instId: a.instId,
    tdMode: 'cash',
    side: 'buy',
    ordType: 'market',
    tgtCcy: 'quote_ccy', // sz = valor em BRL/USDT, não em moeda
    sz: a.orderValue.toFixed(2),
    clOrdId: a.clOrdId,
    attachAlgoOrds: [
      { tpTriggerPx: a.takePx, tpOrdPx: '-1', tpTriggerPxType: 'last', slTriggerPx: a.stopPx, slOrdPx: '-1', slTriggerPxType: 'last' },
    ],
  };
}

/**
 * Quanto vender para encerrar a operação: o que a compra rendeu (já descontada a taxa cobrada na moeda),
 * limitado ao saldo disponível e arredondado ao lote. null = nada a vender (ex.: SL/TP já executado na OKX).
 */
export function sellQty(a: { accFillSz: string; fee: string; feeCcy: string; base: string; availBal: number; lotSz: string; minSz: string }): string | null {
  const filled = Number(a.accFillSz) || 0;
  const feeInBase = a.feeCcy === a.base ? Math.abs(Number(a.fee) || 0) : 0;
  const qty = floorToLot(Math.min(filled - feeInBase, a.availBal), a.lotSz);
  if (!(qty > 0) || qty < Number(a.minSz) - 1e-12) return null;
  return qty.toFixed(decimalsOf(a.lotSz));
}
