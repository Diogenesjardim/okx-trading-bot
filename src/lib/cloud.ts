import type { CloudState } from './cloudCycle';

/** Estado do robô na nuvem, gravado pelo GitHub Actions no branch "bot-state" (repositório público, só leitura). */
export const CLOUD_STATE_URL = 'https://raw.githubusercontent.com/Diogenesjardim/okx-trading-bot/bot-state/state.json';
export const CLOUD_RUNS_URL = 'https://github.com/Diogenesjardim/okx-trading-bot/actions/workflows/bot.yml';

export async function fetchCloudState(): Promise<CloudState | null> {
  const res = await fetch(`${CLOUD_STATE_URL}?t=${Math.floor(Date.now() / 60_000)}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as CloudState;
}

export type CloudHealth = 'ativo' | 'atrasado' | 'parado' | 'sem-dados';

/** O GitHub agenda a cada 5 min, mas costuma atrasar 5–20 min. */
export function cloudHealth(s: CloudState | null, now: number): CloudHealth {
  if (!s?.lastOkAt) return 'sem-dados';
  const age = now - s.lastOkAt;
  if (age < 25 * 60_000) return 'ativo';
  if (age < 90 * 60_000) return 'atrasado';
  return 'parado';
}

/** Com a nuvem ativa e espelhando, o site não deve espelhar (evita ordem dupla na Demo). */
export const cloudMirroring = (s: CloudState | null, now: number) => {
  const h = cloudHealth(s, now);
  return (h === 'ativo' || h === 'atrasado') && !!s?.config?.demo.enabled;
};
