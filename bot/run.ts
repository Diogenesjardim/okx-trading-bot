/**
 * Robô na nuvem — uma execução (chamada pelo GitHub Actions a cada ~5 min).
 * Lê bot/config.json + state/state.json, roda um ciclo e grava o novo estado.
 * Env: SUPABASE_FN (https://<ref>.supabase.co/functions/v1), BOT_TOKEN, STATE_DIR (padrão: state).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Candle, InstId, Timeframe } from '../src/types';
import { runCycle, type CloudConfig, type CloudState } from '../src/lib/cloudCycle';

const FN = (process.env.SUPABASE_FN || 'https://puwrgxthizmydhzvdpvh.supabase.co/functions/v1').replace(/\/$/, '');
const TOKEN = (process.env.BOT_TOKEN || '').trim();
const STATE_DIR = process.env.STATE_DIR || 'state';
const REGION = 'forceFunctionRegion=sa-east-1'; // OKX recusa IPs dos EUA (onde rodam o GitHub e o Supabase padrão)

async function getJson(url: string, init?: RequestInit) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

/** Dados públicos: via okx-proxy (São Paulo); se falhar, direto na OKX. */
async function market(path: string, params: Record<string, string>): Promise<any[]> {
  const qs = new URLSearchParams(params).toString();
  let lastErr = 'falha';
  for (const url of [`${FN}/okx-proxy${path}?${qs}&${REGION}`, `https://www.okx.com${path}?${qs}`]) {
    try {
      const j = await getJson(url);
      if (j?.code === '0') return j.data;
      lastErr = `OKX ${j?.code}: ${j?.msg}`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : 'falha';
    }
  }
  throw new Error(lastErr);
}

const parseCandles = (raw: string[][]): Candle[] =>
  raw
    .map((r) => ({ ts: +r[0], open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5], confirmed: r[8] === '1' }))
    .filter((c) => [c.ts, c.open, c.high, c.low, c.close].every(Number.isFinite))
    .sort((a, b) => a.ts - b.ts);

async function demo(action: 'open' | 'close', payload: Record<string, unknown>) {
  const j = await getJson(`${FN}/okx-demo?${REGION}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-bot-token': TOKEN },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!j?.ok) throw new Error(j?.error || 'Resposta inválida do executor');
  return j.data;
}

async function main() {
  const cfg = JSON.parse(readFileSync('bot/config.json', 'utf8')) as CloudConfig;
  const file = join(STATE_DIR, 'state.json');
  const prev = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as CloudState) : null;
  if (cfg.demo.enabled && !TOKEN) console.warn('BOT_TOKEN ausente: espelhamento na Demo desligado nesta execução.');

  const { state, fresh } = await runCycle(prev, cfg, {
    now: () => Date.now(),
    ticker: async (instId: InstId) => Number((await market('/api/v5/market/ticker', { instId }))[0]?.last),
    candles: async (instId: InstId, tf: Timeframe, limit: number) => parseCandles(await market('/api/v5/market/candles', { instId, bar: tf, limit: String(limit) })),
    demo: TOKEN ? demo : undefined,
  });

  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(state));
  const p = state.sim.position;
  console.log(`Execução ${state.runs} · ${fresh.length} sinal(is) novo(s) · posição: ${p ? `${p.side} ${p.instId} @ ${p.entryPrice}` : 'nenhuma'} · saldo fictício US$ ${state.sim.balance.toFixed(2)}`);
  for (const r of fresh) console.log(`  ${r.side} ${r.instId} ${r.tf}: ${r.decisions.map((d) => d.reason).join(' | ')}`);
  for (const l of state.demo.log.filter((l) => l.ts === state.lastRunAt)) console.log(`  Demo: ${l.msg}`);
  if (state.analyst.lastError) console.log(`  Aviso: ${state.analyst.lastError}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
