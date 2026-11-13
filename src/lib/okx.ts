import type { Candle, InstId, Ticker, Timeframe } from '../types';

/**
 * Cliente da API PÚBLICA da OKX (v5). Não usa API Key e não envia ordens.
 * Docs: https://www.okx.com/docs-v5/en/#public-data-rest-api
 */
const DIRECT_BASE = 'https://www.okx.com';
/** Proxy opcional (ex.: Supabase Edge Function), definido no build: VITE_OKX_PROXY_URL */
const ENV_PROXY = (import.meta.env.VITE_OKX_PROXY_URL as string | undefined)?.replace(/\/$/, '');
const LOCAL_PROXY = './okx-api'; // Vite dev / Vercel / Netlify

/** Ordem de tentativa: direto → proxy configurado → proxy local. Lembra o último que funcionou. */
const BASES = [DIRECT_BASE, ENV_PROXY, LOCAL_PROXY].filter(Boolean) as string[];
let preferred = 0;

export class OkxError extends Error {
  constructor(message: string, public readonly apiError = false) {
    super(message);
    this.name = 'OkxError';
  }
}

const FRIENDLY =
  'Não foi possível conectar à API pública da OKX. Verifique sua internet e tente novamente.';

async function fetchJson<T>(base: string, path: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(`${base}${path}?${qs}`, { signal: ctrl.signal, cache: 'no-store' });
    if (res.status === 429) throw new OkxError('Limite de requisições da OKX atingido. Aguarde alguns segundos.', true);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (body?.code !== '0') throw new OkxError(`OKX retornou erro: ${body?.msg || body?.code}`, true);
    return body.data as T;
  } finally {
    clearTimeout(timer);
  }
}

async function request<T>(path: string, params: Record<string, string>): Promise<T> {
  const order = [preferred, ...BASES.map((_, i) => i).filter((i) => i !== preferred)];
  for (const i of order) {
    try {
      const data = await fetchJson<T>(BASES[i], path, params);
      preferred = i;
      return data;
    } catch (e) {
      if (e instanceof OkxError && e.apiError) throw e; // erro real da OKX: não adianta trocar de rota
    }
  }
  throw new OkxError(FRIENDLY);
}

type RawTicker = {
  instId: string; last: string; open24h: string; high24h: string; low24h: string; vol24h: string; ts: string;
};

export async function getTicker(instId: InstId): Promise<Ticker> {
  const data = await request<RawTicker[]>('/api/v5/market/ticker', { instId });
  const t = data[0];
  if (!t) throw new OkxError('A OKX não retornou cotação para ' + instId, true);
  const n = (v: string) => {
    const x = Number(v);
    if (!Number.isFinite(x)) throw new OkxError('Resposta inválida da OKX', true);
    return x;
  };
  return {
    instId: t.instId,
    last: n(t.last),
    open24h: n(t.open24h),
    high24h: n(t.high24h),
    low24h: n(t.low24h),
    vol24h: n(t.vol24h),
    ts: Number(t.ts),
  };
}

// [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]
type RawCandle = string[];

function parseCandles(raw: RawCandle[]): Candle[] {
  return raw
    .map((r) => ({
      ts: Number(r[0]),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
      confirmed: r[8] === '1',
    }))
    .filter((c) => [c.ts, c.open, c.high, c.low, c.close].every(Number.isFinite))
    .sort((a, b) => a.ts - b.ts);
}

/** Candles mais recentes (inclui o candle em formação, com confirmed=false). Máx. 300. */
export async function getCandles(instId: InstId, bar: Timeframe, limit = 300): Promise<Candle[]> {
  const raw = await request<RawCandle[]>('/api/v5/market/candles', {
    instId, bar, limit: String(Math.min(limit, 300)),
  });
  return parseCandles(raw);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Histórico para backtest: candles recentes + paginação em /history-candles.
 * Retorna somente candles FECHADOS, em ordem cronológica.
 */
export async function getHistoricalCandles(
  instId: InstId,
  bar: Timeframe,
  total: number,
  onProgress?: (loaded: number) => void,
): Promise<Candle[]> {
  const map = new Map<number, Candle>();
  const recent = await getCandles(instId, bar, 300);
  recent.forEach((c) => map.set(c.ts, c));
  onProgress?.(map.size);

  let guard = 0;
  while (map.size < total + 1 && guard < 60) {
    guard++;
    const oldest = Math.min(...map.keys());
    await sleep(150); // respeita o rate limit público
    const raw = await request<RawCandle[]>('/api/v5/market/history-candles', {
      instId, bar, after: String(oldest), limit: '100',
    });
    const page = parseCandles(raw);
    if (page.length === 0) break;
    page.forEach((c) => map.set(c.ts, c));
    onProgress?.(Math.min(map.size, total));
  }

  const closed = [...map.values()].filter((c) => c.confirmed).sort((a, b) => a.ts - b.ts);
  return closed.slice(-total);
}
