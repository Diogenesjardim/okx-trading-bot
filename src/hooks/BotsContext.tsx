import { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { instLabel, streamKey, type Candle, type InstId, type SimConfig, type Ticker, type Timeframe } from '../types';
import { getCandles, getTicker } from '../lib/okx';
import { KEYS, load, save } from '../lib/storage';
import {
  addAnalystLog, analyzeStream, analystStatus, initialAnalystState, isBlocked,
  type AnalystConfig, type AnalystState, type AnalystStatus, type SignalRecord,
  gapLimitMs,
} from '../lib/analystEngine';
import * as Sim from '../lib/simEngine';
import { beep, showNotification } from '../lib/alerts';
import { DEFAULT_DEMO, closePayload, demoActions, demoCall, openPayload, type DemoConfig, type DemoLog, type DemoState, type DemoStatus } from '../lib/okxDemo';

/**
 * ORQUESTRADOR — integra os dois robôs a cada ciclo:
 * 1) consulta a OKX (tickers + candles);  2) Simulador verifica SL/TP com o preço atual;
 * 3) Analista processa candles fechados novos;  4) cada sinal novo é registrado e enviado ao Simulador;
 * 5) Simulador aplica regras de risco e abre/rejeita;  6) alertas (som/notificação) sem duplicar.
 */

interface Store {
  analyst: AnalystState;
  sim: Sim.SimState;
}

function loadStore(): Store {
  let analyst = load<AnalystState | null>(KEYS.analyst, null);
  if (!analyst || analyst.version !== 2) analyst = initialAnalystState();
  analyst = { ...analyst, config: { ...initialAnalystState().config, ...analyst.config } };
  let sim = load<Sim.SimState | null>(KEYS.sim2, null);
  if (!sim || sim.version !== 2) {
    sim = Sim.initialSimState();
    // migração do histórico da versão anterior (v1)
    const old = load<{ trades?: Sim.SimState['trades']; balance?: number; config?: { initialCapital?: number } } | null>(KEYS.sim, null);
    if (old?.trades?.length && old.config?.initialCapital) {
      sim = {
        ...Sim.initialSimState({ ...Sim.DEFAULT_SIM_CONFIG, initialCapital: old.config.initialCapital }),
        trades: old.trades,
        balance: old.balance ?? old.config.initialCapital,
      };
    }
  }
  sim = { ...sim, config: { ...Sim.DEFAULT_SIM_CONFIG, ...sim.config } };
  return { analyst, sim };
}

interface Ctx {
  analyst: AnalystState;
  sim: Sim.SimState;
  tickers: Partial<Record<InstId, Ticker>>;
  candles: Record<string, Candle[]>;
  status: AnalystStatus;
  visible: boolean;
  polling: boolean;
  actionError: string | null;
  pollNow: () => Promise<void>;
  demo: DemoState;
  demoStatus: DemoStatus | null;
  demoBusy: boolean;
  setDemoConfig: (c: DemoConfig) => void;
  refreshDemo: () => Promise<void>;
  setAnalystEnabled: (v: boolean) => void;
  setAnalystConfig: (c: AnalystConfig) => void;
  clearSignals: () => void;
  simStart: () => void;
  simPause: () => void;
  simEnd: () => void;
  simClosePosition: () => void;
  simUpdateConfig: (c: SimConfig) => void;
  simReset: (c?: SimConfig) => void;
  wipeAll: () => void;
}

const BotsContext = createContext<Ctx | null>(null);

export function BotsProvider({ children }: { children: ReactNode }) {
  const store = useRef<Store>(loadStore());
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const [tickers, setTickers] = useState<Partial<Record<InstId, Ticker>>>({});
  const [candles, setCandles] = useState<Record<string, Candle[]>>({});
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  const [polling, setPolling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [, setClock] = useState(0);
  const busy = useRef(false);

  // ---------- Executor DEMO (conta de teste da OKX) ----------
  const demoRef = useRef<DemoState>((() => {
    const saved = load<Partial<DemoState>>(KEYS.demo, {});
    return { ...DEFAULT_DEMO, ...saved, config: { ...DEFAULT_DEMO.config, ...(saved.config ?? {}) } };
  })());
  const [demo, setDemoState] = useState<DemoState>(demoRef.current);
  const [demoStatus, setDemoStatus] = useState<DemoStatus | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);
  const updateDemo = useCallback((fn: (d: DemoState) => DemoState) => {
    demoRef.current = fn(demoRef.current);
    save(KEYS.demo, demoRef.current);
    setDemoState(demoRef.current);
  }, []);
  const demoLog = useCallback((e: Omit<DemoLog, 'ts'>) => updateDemo((d) => ({ ...d, log: [{ ...e, ts: Date.now() }, ...d.log].slice(0, 60) })), [updateDemo]);

  /** Espelha na conta Demo cada abertura/fechamento do Robô Simulador (uma única vez por posição). */
  const mirrorToDemo = useCallback(async (prev: Sim.SimState['position'], next: Sim.SimState['position']) => {
    const cfg = demoRef.current.config;
    if (!cfg.enabled) return;
    for (const a of demoActions(prev, next)) {
      const key = `${a.type}:${a.pos.id}`;
      if (demoRef.current.handled.includes(key)) continue;
      updateDemo((d) => ({ ...d, handled: [key, ...d.handled].slice(0, 400) }));
      const label = `${a.pos.side} ${instLabel(a.pos.instId)}`;
      try {
        if (a.pos.side === 'SHORT') {
          demoLog({ action: a.type === 'open' ? 'abrir' : 'fechar', ok: false, msg: `${label}: conta à vista não permite SHORT — nada enviado. Ative "Somente LONG" no Simulador.` });
          continue;
        }
        if (a.type === 'close') {
          const r = await demoCall<{ message: string }>(cfg, 'close', closePayload(a.pos, cfg));
          demoLog({ action: 'fechar', ok: true, msg: `${label}: ${r.message}` });
        } else {
          const r = await demoCall<{ ordId: string; instId: string; refPrice: number; stop: string; take: string; duplicate?: boolean; message?: string }>(cfg, 'open', openPayload(a.pos, cfg));
          demoLog({ action: 'abrir', ok: true, msg: r.duplicate ? `${label}: ${r.message}` : `${label}: compra de ${cfg.orderValue} ${cfg.quote} em ${r.instId} (~${r.refPrice}) enviada · SL ${r.stop} · TP ${r.take} na OKX (ordem ${r.ordId}).` });
        }
      } catch (e) {
        demoLog({ action: a.type === 'open' ? 'abrir' : 'fechar', ok: false, msg: `${label}: ${e instanceof Error ? e.message : 'falha'}` });
      }
    }
  }, [demoLog, updateDemo]);

  /** Toda mudança de estado passa por aqui: síncrona, persistida e sem corrida. */
  const commit = useCallback((fn: (s: Store) => Store) => {
    const prevPos = store.current.sim.position;
    store.current = fn(store.current);
    const nextPos = store.current.sim.position;
    if (prevPos?.id !== nextPos?.id) void mirrorToDemo(prevPos, nextPos);
    save(KEYS.analyst, store.current.analyst);
    save(KEYS.sim2, store.current.sim);
    rerender();
  }, [mirrorToDemo]);

  const poll = useCallback(async () => {
    if (busy.current) return;
    const { analyst: a0, sim: s0 } = store.current;
    const needPrices = a0.enabled || !!s0.position || s0.mode === 'ATIVO';
    if (!needPrices) return;
    busy.current = true;
    setPolling(true);
    const started = Date.now();
    try {
      const insts = new Set<InstId>(a0.enabled ? a0.config.instruments : []);
      if (s0.position) insts.add(s0.position.instId);
      if (s0.mode === 'ATIVO') s0.config.allowedInst.forEach((i) => insts.add(i));
      const streams: [InstId, Timeframe][] = a0.enabled
        ? a0.config.instruments.flatMap((i) => a0.config.timeframes.map((tf) => [i, tf] as [InstId, Timeframe]))
        : [];

      const [tickRes, candleRes] = await Promise.all([
        Promise.allSettled([...insts].map((i) => getTicker(i))),
        Promise.allSettled(streams.map(([i, tf]) => getCandles(i, tf, a0.config.trendFilter ? 300 : 100))),
      ]);
      const now = Date.now();

      const newTickers: Partial<Record<InstId, Ticker>> = {};
      tickRes.forEach((r) => r.status === 'fulfilled' && (newTickers[r.value.instId as InstId] = r.value));
      const newCandles: Record<string, Candle[]> = {};
      const streamErrors: Record<string, string> = {};
      candleRes.forEach((r, idx) => {
        const key = streamKey(...streams[idx]);
        if (r.status === 'fulfilled') newCandles[key] = r.value;
        else streamErrors[key] = r.reason instanceof Error ? r.reason.message : 'Falha';
      });
      const total = tickRes.length + candleRes.length;
      const failed = tickRes.filter((r) => r.status === 'rejected').length + Object.keys(streamErrors).length;
      const firstErr = [...tickRes, ...candleRes].find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
      const allFailed = total > 0 && failed === total;

      const fresh: SignalRecord[] = [];
      commit(({ analyst, sim }) => {
        // 2) preços → SL/TP
        for (const t of Object.values(newTickers)) sim = Sim.onPrice(sim, t!.instId as InstId, t!.last, now);

        // 3) analista
        let a: AnalystState = { ...analyst, lastPollAt: now, streamErrors };
        const prevOk = a.lastSuccessAt;
        if (allFailed) {
          const msg = firstErr?.reason instanceof Error ? firstErr.reason.message : 'Conexão com a OKX indisponível.';
          if (!a.lastError) a = addAnalystLog(a, { type: 'erro', msg: `Conexão com a OKX indisponível: ${msg}` }, now);
          a = { ...a, lastError: msg };
        } else {
          if (a.lastError) a = addAnalystLog(a, { type: 'ok', msg: 'Conexão com a OKX restabelecida.' }, now);
          if (prevOk && a.enabled && now - prevOk > gapLimitMs(a.config.intervalSec)) {
            a = addAnalystLog(a, {
              type: 'alerta',
              msg: `Monitoramento interrompido entre ${new Date(prevOk).toLocaleTimeString('pt-BR')} e ${new Date(now).toLocaleTimeString('pt-BR')} (site fechado, em segundo plano ou sem conexão). Candles desse intervalo não geram sinais retroativos.`,
            }, now);
          }
          a = { ...a, lastError: null, lastSuccessAt: now };
        }

        const risk = { stopLossPct: sim.config.stopLossPct, takeProfitPct: sim.config.takeProfitPct };
        const snapshots = { ...a.snapshots };
        const lastProcessed = { ...a.lastProcessed };
        const known = new Set(a.signals.map((x) => x.id));
        for (const [instId, tf] of streams) {
          const key = streamKey(instId, tf);
          const cs = newCandles[key];
          if (!cs) continue;
          const r = analyzeStream({ instId, tf, candles: cs, lastProcessedTs: lastProcessed[key], rsiFilter: a.config.rsiFilter, trendFilter: a.config.trendFilter, trendPeriod: a.config.trendPeriod, risk, now });
          snapshots[key] = r.snapshot;
          if (r.lastProcessedTs != null) lastProcessed[key] = r.lastProcessedTs;
          if (r.record && !known.has(r.record.id)) fresh.push(r.record);
        }

        // 4–5) sinais → simulador
        fresh.sort((x, y) => x.closeTime - y.closeTime);
        for (const rec of fresh) {
          const out = Sim.onSignal(sim, rec, now);
          sim = out.state;
          rec.decisions = out.decisions;
        }
        a = { ...a, snapshots, lastProcessed, signals: [...[...fresh].reverse(), ...a.signals].slice(0, 300) };
        return { analyst: a, sim };
      });

      // 6) alertas sem duplicar
      const { analyst } = store.current;
      const toNotify = fresh.filter((r) => !isBlocked(r) && !analyst.notifiedIds.includes(r.id));
      if (toNotify.length) {
        for (const r of toNotify) {
          if (analyst.config.sound) beep(r.side);
          if (analyst.config.notifications) {
            const d = r.decisions.find((x) => x.status !== 'saida');
            void showNotification(
              `${r.side === 'LONG' ? '🟢 POSSÍVEL LONG' : '🔴 POSSÍVEL SHORT'} · ${instLabel(r.instId)} ${r.tf}`,
              `Preço ${r.price.toFixed(2)} · ${d ? `Simulador: ${d.reason}` : ''} (simulação)`,
              r.id,
            );
          }
        }
        commit((s) => ({ ...s, analyst: { ...s.analyst, notifiedIds: [...toNotify.map((r) => r.id), ...s.analyst.notifiedIds].slice(0, 500) } }));
      }

      setTickers((prev) => ({ ...prev, ...newTickers }));
      setCandles((prev) => ({ ...prev, ...newCandles }));
    } finally {
      busy.current = false;
      setPolling(false);
      void started;
    }
  }, [commit]);

  const { analyst, sim } = store.current;
  const active = analyst.enabled || !!sim.position || sim.mode === 'ATIVO';
  const interval = analyst.config.intervalSec;

  useEffect(() => {
    if (!active) return;
    void poll();
    // Continua consultando com a aba em segundo plano (PC/Chrome minimizado). No iPhone o iOS congela a página de qualquer jeito.
    const t = setInterval(() => void poll(), interval * 1000);
    return () => clearInterval(t);
  }, [active, interval, poll]);

  useEffect(() => {
    const onVis = () => {
      const v = document.visibilityState === 'visible';
      setVisible(v);
      if (v) void poll();
    };
    document.addEventListener('visibilitychange', onVis);
    const clock = setInterval(() => setClock((c) => c + 1), 5000); // reavalia status "interrompido"
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      clearInterval(clock);
    };
  }, [poll]);

  const now = Date.now();
  const withErr = (fn: (s: Store) => { store: Store; error?: string }) => {
    let err: string | undefined;
    commit((s) => {
      const r = fn(s);
      err = r.error;
      return r.store;
    });
    setActionError(err ?? null);
  };

  const value: Ctx = {
    analyst,
    sim,
    tickers,
    candles,
    status: analystStatus(analyst, now, visible),
    visible,
    polling,
    actionError,
    demo,
    demoStatus,
    demoBusy,
    setDemoConfig: (c) => updateDemo((d) => ({ ...d, config: c })),
    refreshDemo: async () => {
      setDemoBusy(true);
      try {
        setDemoStatus(await demoCall<DemoStatus>(demoRef.current.config, 'status', { quote: demoRef.current.config.quote }));
      } catch (e) {
        setDemoStatus(null);
        demoLog({ action: 'status', ok: false, msg: e instanceof Error ? e.message : 'falha' });
      } finally {
        setDemoBusy(false);
      }
    },
    pollNow: poll,
    setAnalystEnabled: (v) =>
      commit((s) => ({
        ...s,
        analyst: addAnalystLog({ ...s.analyst, enabled: v, lastError: null, lastSuccessAt: v ? null : s.analyst.lastSuccessAt }, { type: 'info', msg: v ? 'Monitoramento ativado.' : 'Monitoramento pausado pelo usuário.' }, Date.now()),
      })),
    setAnalystConfig: (c) => commit((s) => ({ ...s, analyst: addAnalystLog({ ...s.analyst, config: c }, { type: 'info', msg: 'Configurações do analista atualizadas.' }, Date.now()) })),
    clearSignals: () => commit((s) => ({ ...s, analyst: { ...s.analyst, signals: [] } })),
    simStart: () => commit((s) => ({ ...s, sim: Sim.start(s.sim, Date.now()) })),
    simPause: () => commit((s) => ({ ...s, sim: Sim.pause(s.sim, Date.now()) })),
    simEnd: () => withErr((s) => { const r = Sim.end(s.sim, Date.now()); return { store: { ...s, sim: r.state }, error: r.error }; }),
    simClosePosition: () => withErr((s) => { const r = Sim.manualClose(s.sim, Date.now()); return { store: { ...s, sim: r.state }, error: r.error }; }),
    simUpdateConfig: (c) => commit((s) => ({ ...s, sim: Sim.updateConfig(s.sim, c, Date.now()) })),
    simReset: (c) => commit((s) => ({ ...s, sim: Sim.initialSimState(c ?? s.sim.config) })),
    wipeAll: () => {
      Object.values(KEYS).forEach((k) => { try { localStorage.removeItem(k); } catch { /* */ } });
      store.current = { analyst: initialAnalystState(), sim: Sim.initialSimState() };
      rerender();
    },
  };

  return <BotsContext.Provider value={value}>{children}</BotsContext.Provider>;
}

export function useBots() {
  const c = useContext(BotsContext);
  if (!c) throw new Error('useBots fora do BotsProvider');
  return c;
}
