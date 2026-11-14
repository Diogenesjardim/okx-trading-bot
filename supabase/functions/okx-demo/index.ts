// Supabase Edge Function — EXECUTOR DEMO da OKX (mercado À VISTA / spot).
// • Opera SOMENTE na conta Demo (cabeçalho x-simulated-trading: 1 em toda chamada).
//   Chaves da conta real não funcionam no ambiente Demo, então não há como movimentar dinheiro real.
// • As chaves ficam nos Secrets do Supabase — nunca no site.
// • Exige o cabeçalho x-bot-token = BOT_TOKEN (senha definida por você).
// • Só compra/venda à vista de BTC e ETH (em BRL ou USDT). Sem saques, transferências ou alavancagem.
//
// Secrets: OKX_DEMO_API_KEY, OKX_DEMO_SECRET, OKX_DEMO_PASSPHRASE, BOT_TOKEN
// Opcionais: MAX_ORDER_BRL (padrão 2000), MAX_ORDER_USDT (padrão 400)

import {
  BASES, buildSpotBuy, clOrdIdFrom, levelsFromPct, roundToTick, sellQty, signOkx, spotInstId, validateSpotOpen,
  type SpotOpenRequest,
} from './logic.ts';

const BASE_URL = Deno.env.get('OKX_BASE_URL') || 'https://www.okx.com'; // override só para testes locais
const env = (k: string) => Deno.env.get(k) ?? '';
const MAX = { BRL: Number(env('MAX_ORDER_BRL') || 2000), USDT: Number(env('MAX_ORDER_USDT') || 400) };

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, x-bot-token, authorization, apikey, x-client-info',
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

class OkxErr extends Error {}

async function okx<T = any>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T[]> {
  const ts = new Date().toISOString();
  const payload = body ? JSON.stringify(body) : '';
  const res = await fetch(BASE_URL + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'OK-ACCESS-KEY': env('OKX_DEMO_API_KEY'),
      'OK-ACCESS-SIGN': await signOkx(env('OKX_DEMO_SECRET'), ts, method, path, payload),
      'OK-ACCESS-TIMESTAMP': ts,
      'OK-ACCESS-PASSPHRASE': env('OKX_DEMO_PASSPHRASE'),
      'x-simulated-trading': '1', // SEMPRE DEMO
    },
    body: payload || undefined,
  });
  const j = await res.json().catch(() => ({}));
  if (j.code !== '0') {
    const detail = Array.isArray(j.data) && j.data[0]?.sMsg ? ` — ${j.data[0].sMsg}` : '';
    throw new OkxErr(`OKX ${j.code ?? res.status}: ${j.msg || 'erro'}${detail}`);
  }
  return j.data as T[];
}

async function instrument(instId: string) {
  const [inst] = await okx('GET', `/api/v5/public/instruments?instType=SPOT&instId=${instId}`);
  if (!inst) throw new OkxErr(`O par ${instId} não está disponível na sua conta Demo.`);
  return inst as { lotSz: string; minSz: string; tickSz: string; baseCcy: string; quoteCcy: string };
}

async function balances(ccys: string[]) {
  const [b] = await okx('GET', `/api/v5/account/balance?ccy=${ccys.join(',')}`);
  const out: Record<string, { eq: number; avail: number }> = {};
  for (const d of b?.details ?? []) out[d.ccy] = { eq: Number(d.eq), avail: Number(d.availBal ?? d.availEq) };
  return out;
}

async function status(quote: string) {
  const [bal, hist, algos] = await Promise.all([
    balances([quote, ...BASES]),
    okx('GET', '/api/v5/trade/orders-history?instType=SPOT&limit=20'),
    okx('GET', '/api/v5/trade/orders-algo-pending?instType=SPOT&ordType=conditional,oco'),
  ]);
  return {
    quote,
    balances: bal,
    orders: hist.map((o: any) => ({
      ordId: o.ordId, clOrdId: o.clOrdId, instId: o.instId, side: o.side, avgPx: Number(o.avgPx), sz: o.accFillSz,
      state: o.state, fee: Number(o.fee), feeCcy: o.feeCcy, cTime: Number(o.cTime), source: o.source,
    })),
    protections: algos.map((a: any) => ({ algoId: a.algoId, instId: a.instId, sz: a.sz, slTriggerPx: Number(a.slTriggerPx) || null, tpTriggerPx: Number(a.tpTriggerPx) || null })),
  };
}

async function open(b: SpotOpenRequest) {
  const errors = validateSpotOpen(b, MAX);
  if (errors.length) throw new OkxErr(errors.join(' '));
  const instId = spotInstId(b.instId, b.quote)!;
  const clOrdId = clOrdIdFrom(b.ref);

  // Idempotência: se esta ordem já existe, não compra de novo.
  const existing = await okx('GET', `/api/v5/trade/order?instId=${instId}&clOrdId=${clOrdId}`).catch(() => []);
  if (existing.length) return { duplicate: true, ordId: existing[0].ordId, instId, message: 'Ordem deste sinal já existia na Demo; nada foi repetido.' };

  const [inst, [tk], bal] = await Promise.all([
    instrument(instId),
    okx('GET', `/api/v5/market/ticker?instId=${instId}`),
    balances([b.quote]),
  ]);
  const avail = bal[b.quote]?.avail ?? 0;
  if (avail < b.orderValue) throw new OkxErr(`Saldo insuficiente na Demo: ${avail.toFixed(2)} ${b.quote} disponível.`);

  const price = Number(tk.last);
  const lv = levelsFromPct(price, b.stopLossPct, b.takeProfitPct);
  const order = buildSpotBuy({
    instId, orderValue: b.orderValue, stopPx: roundToTick(lv.stop, inst.tickSz), takePx: roundToTick(lv.take, inst.tickSz), clOrdId,
  });
  const [r] = await okx('POST', '/api/v5/trade/order', order);
  return { ordId: r.ordId, clOrdId, instId, orderValue: b.orderValue, refPrice: price, stop: order.attachAlgoOrds[0].slTriggerPx, take: order.attachAlgoOrds[0].tpTriggerPx };
}

async function close(b: { instId: string; quote: string; ref: string }) {
  const instId = spotInstId(String(b.instId), String(b.quote));
  if (!instId || !b.ref) throw new OkxErr('Pedido de fechamento inválido.');
  const clOrdId = clOrdIdFrom(b.ref);
  const [buy] = await okx('GET', `/api/v5/trade/order?instId=${instId}&clOrdId=${clOrdId}`).catch(() => []);
  if (!buy) return { closed: false, message: 'Não há compra deste sinal na Demo (talvez a entrada tenha falhado).' };
  const [sold] = await okx('GET', `/api/v5/trade/order?instId=${instId}&clOrdId=${clOrdIdFrom(b.ref + '|sell')}`).catch(() => []);
  if (sold) return { closed: false, message: 'Esta operação já foi vendida na Demo; nada foi repetido.' };

  // 1) Cancela as proteções (SL/TP) ainda pendentes deste par, para liberar o saldo.
  const algos = await okx('GET', `/api/v5/trade/orders-algo-pending?instType=SPOT&instId=${instId}&ordType=conditional,oco`);
  if (algos.length) await okx('POST', '/api/v5/trade/cancel-algos', algos.map((a: any) => ({ algoId: a.algoId, instId })));

  // 2) Vende o que esta compra rendeu (limitado ao saldo disponível).
  const inst = await instrument(instId);
  const bal = await balances([inst.baseCcy]);
  const qty = sellQty({
    accFillSz: buy.accFillSz, fee: buy.fee, feeCcy: buy.feeCcy, base: inst.baseCcy,
    availBal: bal[inst.baseCcy]?.avail ?? 0, lotSz: inst.lotSz, minSz: inst.minSz,
  });
  if (!qty) return { closed: false, message: `Nada a vender em ${instId}: a OKX provavelmente já executou o Stop Loss ou o Take Profit.` };
  const [r] = await okx('POST', '/api/v5/trade/order', {
    instId, tdMode: 'cash', side: 'sell', ordType: 'market', sz: qty, clOrdId: clOrdIdFrom(b.ref + '|sell'),
  });
  return { closed: true, ordId: r.ordId, message: `Vendidos ${qty} ${inst.baseCcy} a mercado na Demo.` };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return reply({ ok: false, error: 'Use POST.' }, 405);

  const token = env('BOT_TOKEN');
  if (!token || req.headers.get('x-bot-token') !== token) return reply({ ok: false, error: 'Token inválido.' }, 401);
  if (!env('OKX_DEMO_API_KEY') || !env('OKX_DEMO_SECRET') || !env('OKX_DEMO_PASSPHRASE')) {
    return reply({ ok: false, error: 'Chaves da conta Demo não configuradas nos Secrets do Supabase.' }, 500);
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return reply({ ok: false, error: 'JSON inválido.' }, 400);
  }

  try {
    switch (body.action) {
      case 'status': return reply({ ok: true, data: await status(String(body.quote || 'BRL')) });
      case 'open': return reply({ ok: true, data: await open(body as SpotOpenRequest) });
      case 'close': return reply({ ok: true, data: await close(body) });
      default: return reply({ ok: false, error: 'Ação desconhecida.' }, 400);
    }
  } catch (e) {
    return reply({ ok: false, error: e instanceof Error ? e.message : 'Erro inesperado.' }, e instanceof OkxErr ? 422 : 500);
  }
});
