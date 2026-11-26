import { streamKey, type Candle, type InstId, type SimConfig, type Timeframe } from '../types';
import { analyzeStream, initialAnalystState, addAnalystLog, type AnalystConfig, type AnalystState, type SignalRecord } from './analystEngine';
import * as Sim from './simEngine';
import { closePayload, demoActions, openPayload, type DemoLog } from './okxDemo';

/**
 * ROBÔ NA NUVEM (Fase 4) — um ciclo completo, sem navegador.
 * Roda a cada ~5 min no GitHub Actions (bot/run.ts) com os MESMOS motores do site
 * (analystEngine + simEngine) e espelha entradas/saídas na conta Demo da OKX.
 * Função pura em relação ao estado: recebe o estado anterior e devolve o novo.
 */

export interface CloudConfig {
  enabled: boolean; // false = não abre novas posições (SL/TP da posição aberta continuam monitorados)
  analyst: Pick<AnalystConfig, 'instruments' | 'timeframes' | 'rsiFilter' | 'trendFilter' | 'trendPeriod'>;
  sim: Partial<SimConfig>;
  demo: { enabled: boolean; quote: 'BRL' | 'USDT'; orderValue: number };
}

export interface CloudLog { ts: number; type: 'info' | 'erro' | 'alerta'; msg: string }

export interface CloudState {
  version: 1;
  createdAt: number;
  lastRunAt: number | null;
  lastOkAt: number | null;
  runs: number;
  analyst: AnalystState;
  sim: Sim.SimState;
  demo: { log: DemoLog[]; handled: string[] };
  log: CloudLog[];
  config?: CloudConfig; // cópia da configuração usada na última execução (para o painel do site)
}

export interface CloudDeps {
  now: () => number;
  ticker: (instId: InstId) => Promise<number>;
  candles: (instId: InstId, tf: Timeframe, limit: number) => Promise<Candle[]>;
  /** Chama a função okx-demo (open/close). Ausente = sem espelhamento. */
  demo?: (action: 'open' | 'close', payload: Record<string, unknown>) => Promise<any>;
}

const MIN5 = 5 * 60_000;

function analystConfig(c: CloudConfig): AnalystConfig {
  return { ...c.analyst, intervalSec: 300 as AnalystConfig['intervalSec'], sound: false, notifications: false }; // nuvem: ~5 min
}
const simConfig = (c: CloudConfig): SimConfig => ({ ...Sim.DEFAULT_SIM_CONFIG, ...c.sim });

export function initialCloudState(cfg: CloudConfig, now: number): CloudState {
  const analyst = { ...initialAnalystState(analystConfig(cfg)), enabled: true };
  let sim = Sim.initialSimState(simConfig(cfg), now);
  if (cfg.enabled) sim = Sim.start(sim, now);
  return {
    version: 1, createdAt: now, lastRunAt: null, lastOkAt: null, runs: 0, analyst, sim,
    demo: { log: [], handled: [] },
    log: [{ ts: now, type: 'info', msg: 'Robô na nuvem criado.' }],
  };
}

const addLog = (s: CloudState, type: CloudLog['type'], msg: string, ts: number): CloudState => ({ ...s, log: [{ ts, type, msg }, ...s.log].slice(0, 200) });
const addDemoLog = (s: CloudState, e: Omit<DemoLog, 'ts'>, ts: number): CloudState => ({ ...s, demo: { ...s.demo, log: [{ ...e, ts }, ...s.demo.log].slice(0, 100) } });

/** Reproduz SL/TP com os candles de 5 min desde a última execução (a OKX dispara no preço exato; aqui também). */
export function replayStops(sim: Sim.SimState, instId: InstId, candles: Candle[], from: number, now: number): Sim.SimState {
  for (const c of candles) {
    const p = sim.position;
    if (!p || p.instId !== instId) break;
    if (c.ts + MIN5 <= Math.max(from, p.entryTime)) continue;
    const long = p.side === 'LONG';
    const hitStop = long ? c.low <= p.stopPrice : c.high >= p.stopPrice;
    const hitTake = long ? c.high >= p.takePrice : c.low <= p.takePrice;
    const at = Math.min(c.ts + MIN5, now);
    if (hitStop) sim = Sim.onPrice(sim, instId, p.stopPrice, at); // conservador: stop antes do alvo no mesmo candle
    else if (hitTake) sim = Sim.onPrice(sim, instId, p.takePrice, at);
  }
  return sim;
}

export async function runCycle(prev: CloudState | null, cfg: CloudConfig, deps: CloudDeps): Promise<{ state: CloudState; fresh: SignalRecord[] }> {
  const now = deps.now();
  let st = prev ?? initialCloudState(cfg, now);
  const from = st.lastRunAt ?? now;
  st = { ...st, lastRunAt: now, runs: st.runs + 1, config: cfg };

  // Configuração (bot/config.json) → motores
  const aCfg = analystConfig(cfg);
  if (JSON.stringify(aCfg) !== JSON.stringify(st.analyst.config)) {
    st = { ...st, analyst: addAnalystLog({ ...st.analyst, config: aCfg }, { type: 'info', msg: 'Configurações do analista atualizadas (nuvem).' }, now) };
  }
  const sCfg = simConfig(cfg);
  if (JSON.stringify(sCfg) !== JSON.stringify(st.sim.config)) st = { ...st, sim: Sim.updateConfig(st.sim, sCfg, now) };
  if (cfg.enabled && st.sim.mode !== 'ATIVO') st = { ...st, sim: Sim.start(st.sim, now) };
  if (!cfg.enabled && st.sim.mode === 'ATIVO') st = { ...st, sim: Sim.pause(st.sim, now) };

  const posBefore = st.sim.position;
  let sim = st.sim;
  const insts = new Set<InstId>(aCfg.instruments);
  if (sim.position) insts.add(sim.position.instId);

  // 1) Preços: SL/TP no intervalo desde a última execução + preço atual
  let failures = 0;
  for (const instId of insts) {
    try {
      if (sim.position?.instId === instId) sim = replayStops(sim, instId, await deps.candles(instId, '5m', 100), from, now);
      sim = Sim.onPrice(sim, instId, await deps.ticker(instId), now);
    } catch (e) {
      failures++;
      st = addLog(st, 'erro', `Preço de ${instId}: ${e instanceof Error ? e.message : 'falha'}`, now);
    }
  }

  // 2) Analista: um registro por candle fechado
  let a: AnalystState = { ...st.analyst, lastPollAt: now };
  const risk = { stopLossPct: sim.config.stopLossPct, takeProfitPct: sim.config.takeProfitPct };
  const snapshots = { ...a.snapshots };
  const lastProcessed = { ...a.lastProcessed };
  const streamErrors: Record<string, string> = {};
  const known = new Set(a.signals.map((x) => x.id));
  const fresh: SignalRecord[] = [];
  for (const instId of aCfg.instruments) {
    for (const tf of aCfg.timeframes) {
      const key = streamKey(instId, tf);
      try {
        const cs = await deps.candles(instId, tf, aCfg.trendFilter ? 300 : 100);
        const r = analyzeStream({ instId, tf, candles: cs, lastProcessedTs: lastProcessed[key], rsiFilter: aCfg.rsiFilter, trendFilter: aCfg.trendFilter, trendPeriod: aCfg.trendPeriod, risk, now });
        snapshots[key] = r.snapshot;
        if (r.lastProcessedTs != null) lastProcessed[key] = r.lastProcessedTs;
        if (r.record && !known.has(r.record.id)) fresh.push(r.record);
      } catch (e) {
        failures++;
        streamErrors[key] = e instanceof Error ? e.message : 'falha';
      }
    }
  }
  const total = insts.size + aCfg.instruments.length * aCfg.timeframes.length;
  const ok = failures < total;
  if (ok) {
    if (st.lastOkAt && now - st.lastOkAt > 45 * 60_000) {
      a = addAnalystLog(a, { type: 'alerta', msg: `Robô na nuvem ficou sem rodar entre ${new Date(st.lastOkAt).toISOString()} e ${new Date(now).toISOString()} (atraso do GitHub). Candles desse intervalo não geram sinais retroativos.` }, now);
    }
    a = { ...a, lastSuccessAt: now, lastError: null };
    st = { ...st, lastOkAt: now };
  } else {
    a = { ...a, lastError: 'Sem conexão com a OKX nesta execução.' };
  }

  // 3) Sinais → simulador
  fresh.sort((x, y) => x.closeTime - y.closeTime);
  for (const rec of fresh) {
    const out = Sim.onSignal(sim, rec, now);
    sim = out.state;
    rec.decisions = out.decisions;
  }
  a = { ...a, snapshots, lastProcessed, streamErrors, signals: [...[...fresh].reverse(), ...a.signals].slice(0, 300) };
  st = { ...st, analyst: a, sim };

  // 4) Espelho na conta Demo da OKX (uma única vez por posição; ref = id do sinal → idempotente no executor)
  if (cfg.demo.enabled && deps.demo) {
    const dcfg = { enabled: true, url: '', token: '', quote: cfg.demo.quote, orderValue: cfg.demo.orderValue };
    for (const act of demoActions(posBefore, sim.position)) {
      const key = `${act.type}:${act.pos.id}`;
      if (st.demo.handled.includes(key)) continue;
      st = { ...st, demo: { ...st.demo, handled: [key, ...st.demo.handled].slice(0, 400) } };
      const label = `${act.pos.side} ${act.pos.instId.replace('-', '/')}`;
      if (act.pos.side === 'SHORT') {
        st = addDemoLog(st, { action: act.type === 'open' ? 'abrir' : 'fechar', ok: false, msg: `${label}: conta à vista não permite SHORT — nada enviado.` }, now);
        continue;
      }
      try {
        if (act.type === 'close') {
          const r = await deps.demo('close', closePayload(act.pos, dcfg));
          st = addDemoLog(st, { action: 'fechar', ok: true, msg: `${label}: ${r.message}` }, now);
        } else {
          const r = await deps.demo('open', openPayload(act.pos, dcfg));
          st = addDemoLog(st, { action: 'abrir', ok: true, msg: r.duplicate ? `${label}: ${r.message}` : `${label}: compra de ${dcfg.orderValue} ${dcfg.quote} em ${r.instId} (~${r.refPrice}) · SL ${r.stop} · TP ${r.take} na OKX (ordem ${r.ordId}).` }, now);
        }
      } catch (e) {
        st = addDemoLog(st, { action: act.type === 'open' ? 'abrir' : 'fechar', ok: false, msg: `${label}: ${e instanceof Error ? e.message : 'falha'}` }, now);
      }
    }
  }
  return { state: st, fresh };
}
