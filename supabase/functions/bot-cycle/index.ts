// Robô na nuvem (Fase 4) dentro do Supabase.
// O agendador do banco (pg_cron) chama esta função a cada minuto (POST com x-bot-token).
// Ela roda o mesmo Analista + Simulador do site (engine.js, gerado de src/lib/cloudCycle.ts),
// espelha entradas/saídas na conta Demo da OKX (função okx-demo) e guarda o estado na tabela bot_state.
// GET devolve o estado (só leitura, sem segredos) para o painel do site.
// @ts-ignore engine.js é JavaScript gerado pelo esbuild
import { CONFIG, runCycle } from './engine.js';

const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const BOT_TOKEN = (Deno.env.get('BOT_TOKEN') ?? '').trim();
const OKX = 'https://www.okx.com';
const ROW = 'main';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-bot-token, authorization, apikey',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function timed(url: string, init?: RequestInit, ms = 15_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// ---- estado (tabela bot_state; RLS ligado sem políticas = só a chave de serviço acessa) ----
const db = (path: string, init?: RequestInit) =>
  timed(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });

async function loadState(): Promise<any | null> {
  const r = await db(`bot_state?id=eq.${ROW}&select=state`);
  if (!r.ok) {
    const t = await r.text();
    if (/bot_state/.test(t) && /(does not exist|not find|42P01|PGRST205)/i.test(t)) throw new Error('Tabela bot_state não existe: rode o SQL de instalação no Supabase.');
    throw new Error(`Banco: HTTP ${r.status} ${t.slice(0, 200)}`);
  }
  const rows = await r.json();
  return rows[0]?.state ?? null;
}

async function saveState(state: unknown) {
  const r = await db('bot_state', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id: ROW, state, updated_at: new Date().toISOString() }) });
  if (!r.ok) throw new Error(`Banco (gravar): HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
}

// ---- dados públicos da OKX (a função roda em São Paulo) ----
async function market(path: string, params: Record<string, string>) {
  const r = await timed(`${OKX}${path}?${new URLSearchParams(params)}`);
  const j = await r.json();
  if (j?.code !== '0') throw new Error(`OKX ${j?.code}: ${j?.msg || r.status}`);
  return j.data as any[];
}
const parseCandles = (raw: string[][]) =>
  raw
    .map((r) => ({ ts: +r[0], open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5], confirmed: r[8] === '1' }))
    .filter((c) => [c.ts, c.open, c.high, c.low, c.close].every(Number.isFinite))
    .sort((a, b) => a.ts - b.ts);

// ---- executor Demo (função okx-demo, sempre em São Paulo) ----
async function demo(action: 'open' | 'close', payload: Record<string, unknown>) {
  const r = await timed(`${SUPABASE_URL}/functions/v1/okx-demo?forceFunctionRegion=sa-east-1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-bot-token': BOT_TOKEN },
    body: JSON.stringify({ action, ...payload }),
  }, 30_000);
  const j = await r.json().catch(() => null);
  if (!j?.ok) throw new Error(j?.error || `Executor: HTTP ${r.status}`);
  return j.data;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    if (req.method === 'GET') return json({ ok: true, data: await loadState() });
    if (req.method !== 'POST') return json({ ok: false, error: 'Método não suportado' }, 405);
    if (!BOT_TOKEN || (req.headers.get('x-bot-token') ?? '').trim() !== BOT_TOKEN) return json({ ok: false, error: 'Token inválido' }, 401);

    const prev = await loadState();
    // Evita duas execuções sobrepostas (o agendador chama 1x por minuto)
    if (prev?.lastRunAt && Date.now() - prev.lastRunAt < 30_000) return json({ ok: true, skipped: 'execução recente' });

    const { state, fresh } = await runCycle(prev, CONFIG, {
      now: () => Date.now(),
      ticker: async (instId: string) => Number((await market('/api/v5/market/ticker', { instId }))[0]?.last),
      candles: async (instId: string, tf: string, limit: number) => parseCandles(await market('/api/v5/market/candles', { instId, bar: tf, limit: String(limit) })),
      demo,
    });
    await saveState(state);
    const p = state.sim.position;
    return json({ ok: true, runs: state.runs, fresh: fresh.length, position: p ? `${p.side} ${p.instId} @ ${p.entryPrice}` : null, error: state.analyst.lastError });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : 'erro' }, 500);
  }
});
