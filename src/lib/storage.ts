export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function save<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* armazenamento indisponível (modo privado / sandbox) */
  }
}

export const KEYS = {
  sim: 'okxbot.sim.v1', // versão anterior (migrada automaticamente)
  sim2: 'okxbot.sim.v2',
  analyst: 'okxbot.analyst.v2',
  backtestCfg: 'okxbot.backtestCfg.v1',
  backtestRuns: 'okxbot.backtestRuns.v1',
  analysis: 'okxbot.analysis.v1',
  validationCfg: 'okxbot.validationCfg.v1',
  validationRuns: 'okxbot.validationRuns.v1',
  matrix: 'okxbot.matrix.v1',
};
