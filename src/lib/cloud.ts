import type { CloudState } from './cloudCycle';

/** Robô na nuvem: função bot-cycle do Supabase (chamada a cada minuto pelo agendador do banco). GET = estado, só leitura. */
export const CLOUD_FN_URL = 'https://puwrgxthizmydhzvdpvh.supabase.co/functions/v1/bot-cycle';
export const CLOUD_LOGS_URL = 'https://supabase.com/dashboard/project/puwrgxthizmydhzvdpvh/functions/bot-cycle/logs';

export async function fetchCloudState(): Promise<CloudState | null> {
  const res = await fetch(`${CLOUD_FN_URL}?forceFunctionRegion=sa-east-1`, { cache: 'no-store' });
  const j = await res.json().catch(() => null);
  if (!j?.ok) throw new Error(j?.error || `HTTP ${res.status}`);
  return (j.data ?? null) as CloudState | null;
}

export type CloudHealth = 'ativo' | 'atrasado' | 'parado' | 'sem-dados';

export function cloudHealth(s: CloudState | null, now: number): CloudHealth {
  if (!s?.lastOkAt) return 'sem-dados';
  const age = now - s.lastOkAt;
  if (age < 5 * 60_000) return 'ativo';
  if (age < 20 * 60_000) return 'atrasado';
  return 'parado';
}

/** Com a nuvem ativa e espelhando, o site não espelha (evita ordem dupla na Demo). */
export const cloudMirroring = (s: CloudState | null, now: number) => cloudHealth(s, now) === 'ativo' && !!s?.config?.demo.enabled;
