// Supabase Edge Function — proxy SOMENTE LEITURA para dados públicos de mercado da OKX.
// Não aceita chaves, não envia ordens: só repassa GET para 3 endpoints públicos permitidos.
// Deploy: supabase functions deploy okx-proxy --no-verify-jwt

const ALLOWED = new Set([
  '/api/v5/market/ticker',
  '/api/v5/market/candles',
  '/api/v5/market/history-candles',
]);
const ALLOWED_PARAMS = new Set(['instId', 'bar', 'limit', 'after', 'before']);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'GET') return new Response('Método não permitido', { status: 405, headers: cors });

  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*\/okx-proxy/, '');
  if (!ALLOWED.has(path)) {
    return Response.json({ code: '403', msg: 'Endpoint não permitido' }, { status: 403, headers: cors });
  }
  const params = new URLSearchParams();
  url.searchParams.forEach((v, k) => ALLOWED_PARAMS.has(k) && params.set(k, v));

  try {
    const r = await fetch(`https://www.okx.com${path}?${params}`, { headers: { accept: 'application/json' } });
    return new Response(await r.text(), {
      status: r.status,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch {
    return Response.json({ code: '502', msg: 'OKX indisponível' }, { status: 502, headers: cors });
  }
});
