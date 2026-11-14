// Supabase Edge Function — EXECUTOR DEMO da OKX.
// • Opera SOMENTE na conta Demo (cabeçalho x-simulated-trading: 1 em toda chamada).
//   Chaves da conta real não funcionam no ambiente Demo, então não há como movimentar dinheiro real.
// • As chaves ficam nos Secrets do Supabase — nunca no site.
// • Exige o cabeçalho x-bot-token = BOT_TOKEN (senha definida por você).
// • Sem saques, sem transferências: só abrir/fechar posição em BTC-USDT-SWAP e ETH-USDT-SWAP.
//
// Secrets necessários: OKX_DEMO_API_KEY, OKX_DEMO_SECRET, OKX_DEMO_PASSPHRASE, BOT_TOKEN
// Opcional: MAX_MARGIN_USDT (padrão 200)

import { SWAP_OF, buildOrder, clOrdIdFrom, contractsFor, roundToTick, signOkx, validateOpenRequest, type OpenRequest } from './logic.ts';

const BASE = Deno.env.get('OKX_BASE_URL') || 'https://www.okx.com'; // só para testes locais
const env = (k: string) => Deno.env.get(k) ?? '';

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
  const sign = await signOkx(env('OKX_DEMO_SECRET'), ts, method, path, payload);
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'OK-ACCESS-KEY': env('OKX_DEMO_API_KEY'),
      'OK-ACCESS-SIGN': sign,
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

async function accountConfig() {
  const [c] = await okx('GET', '/api/v5/account/config');
  return { acctLv: String(c.acctLv), posMode: String(c.posMode) };
}

async function positions(swapId?: string) {
  const q = swapId ? `?instType=SWAP&instId=${swapId}` : '?instType=SWAP';
  const ps = await okx('GET', '/api/v5/account/positions' + q);
  return ps.filter((p: any) => Number(p.pos) !== 0);
}

async function status() {
  const [cfg, bal, pos, hist] = await Promise.all([
    accountConfig(),
    okx('GET', '/api/v5/account/balance?ccy=USDT'),
    positions(),
    okx('GET', '/api/v5/trade/orders-history?instType=SWAP&limit=20'),
  ]);
  const usdt = bal[0]?.details?.find((d: any) => d.ccy === 'USDT');
  return {
    acctLv: cfg.acctLv,
    posMode: cfg.posMode,
    usdt: usdt ? { eq: Number(usdt.eq), avail: Number(usdt.availBal ?? usdt.availEq) } : null,
    positions: pos.map((p: any) => ({
      instId: p.instId, pos: p.pos, posSide: p.posSide, avgPx: Number(p.avgPx), markPx: Number(p.markPx),
      upl: Number(p.upl), uplRatio: Number(p.uplRatio), lever: p.lever, liqPx: Number(p.liqPx) || null, margin: Number(p.margin || p.imr), cTime: Number(p.cTime),
    })),
    orders: hist.map((o: any) => ({
      ordId: o.ordId, clOrdId: o.clOrdId, instId: o.instId, side: o.side, posSide: o.posSide, avgPx: Number(o.avgPx), sz: o.accFillSz,
      state: o.state, fee: Number(o.fee), pnl: Number(o.pnl), cTime: Number(o.cTime), category: o.category,
    })),
  };
}

/** Prepara a conta Demo: modo "spot e futuros" e posições em modo único (net). */
async function prepare() {
  const cfg = await accountConfig();
  const done: string[] = [];
  if (cfg.acctLv === '1') {
    await okx('POST', '/api/v5/account/set-account-level', { acctLv: '2' });
    done.push('Conta Demo alterada para o modo “Spot e futuros”.');
  }
  if (cfg.posMode !== 'net_mode') {
    await okx('POST', '/api/v5/account/set-position-mode', { posMode: 'net_mode' });
    done.push('Modo de posição alterado para “compra/venda” (net).');
  }
  return { done: done.length ? done : ['Conta Demo já estava pronta.'] };
}

async function open(b: OpenRequest) {
  const maxMargin = Number(env('MAX_MARGIN_USDT') || 200);
  const errors = validateOpenRequest(b, maxMargin);
  if (errors.length) throw new OkxErr(errors.join(' '));
  const swapId = SWAP_OF[b.instId];

  const cfg = await accountConfig();
  if (cfg.acctLv === '1') throw new OkxErr('A conta Demo está no modo Spot. Use “Preparar conta Demo” nas Configurações do app.');
  if ((await positions(swapId)).length) throw new OkxErr(`Já existe posição aberta em ${swapId} na conta Demo (máximo 1).`);

  const [[inst], [tk]] = await Promise.all([
    okx('GET', `/api/v5/public/instruments?instType=SWAP&instId=${swapId}`),
    okx('GET', `/api/v5/market/ticker?instId=${swapId}`),
  ]);
  const price = Number(tk.last);
  const size = contractsFor({ marginUsdt: b.marginUsdt, leverage: b.leverage, price, ctVal: inst.ctVal, lotSz: inst.lotSz, minSz: inst.minSz });
  if ('error' in size) throw new OkxErr(size.error);

  // SL/TP coerentes com o preço atual (senão a OKX rejeita)
  if (b.side === 'LONG' && !(b.stopPrice < price && b.takePrice > price)) throw new OkxErr('SL/TP inválidos para LONG no preço atual (o preço já passou de um deles).');
  if (b.side === 'SHORT' && !(b.stopPrice > price && b.takePrice < price)) throw new OkxErr('SL/TP inválidos para SHORT no preço atual (o preço já passou de um deles).');

  const lev: Record<string, unknown> = { instId: swapId, lever: String(b.leverage), mgnMode: 'isolated' };
  if (cfg.posMode === 'long_short_mode') lev.posSide = b.side === 'LONG' ? 'long' : 'short';
  await okx('POST', '/api/v5/account/set-leverage', lev);

  const order = buildOrder({
    swapId, side: b.side, sz: size.sz, stopPx: roundToTick(b.stopPrice, inst.tickSz), takePx: roundToTick(b.takePrice, inst.tickSz),
    clOrdId: clOrdIdFrom(b.ref), posMode: cfg.posMode,
  });
  const [r] = await okx('POST', '/api/v5/trade/order', order);
  return { ordId: r.ordId, clOrdId: r.clOrdId, swapId, sz: size.sz, notional: size.notional, refPrice: price };
}

async function close(instId: string) {
  const swapId = SWAP_OF[instId];
  if (!swapId) throw new OkxErr('Ativo não permitido.');
  const cfg = await accountConfig();
  const ps = await positions(swapId);
  if (!ps.length) return { closed: false, message: 'Nenhuma posição aberta na Demo (pode já ter sido fechada pelo SL/TP da OKX).' };
  for (const p of ps) {
    const body: Record<string, unknown> = { instId: swapId, mgnMode: p.mgnMode || 'isolated', autoCxl: true };
    if (cfg.posMode === 'long_short_mode') body.posSide = p.posSide;
    await okx('POST', '/api/v5/trade/close-position', body);
  }
  return { closed: true, message: `Posição ${swapId} fechada a mercado na Demo.` };
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
      case 'status': return reply({ ok: true, data: await status() });
      case 'prepare': return reply({ ok: true, data: await prepare() });
      case 'open': return reply({ ok: true, data: await open(body as OpenRequest) });
      case 'close': return reply({ ok: true, data: await close(String(body.instId)) });
      default: return reply({ ok: false, error: 'Ação desconhecida.' }, 400);
    }
  } catch (e) {
    return reply({ ok: false, error: e instanceof Error ? e.message : 'Erro inesperado.' }, e instanceof OkxErr ? 422 : 500);
  }
});
