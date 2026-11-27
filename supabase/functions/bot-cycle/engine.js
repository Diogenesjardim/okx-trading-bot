// GERADO por npm run build:engine — não editar. Fonte: src/lib/cloudCycle.ts + bot/config.json

// src/types.ts
var TIMEFRAMES = [
  { id: "5m", label: "5 min", ms: 5 * 6e4 },
  { id: "15m", label: "15 min", ms: 15 * 6e4 },
  { id: "1H", label: "1 hora", ms: 60 * 6e4 },
  { id: "4H", label: "4 horas", ms: 4 * 60 * 6e4 }
];
var tfMs = (tf) => TIMEFRAMES.find((t) => t.id === tf).ms;
var streamKey = (instId, tf) => `${instId}|${tf}`;

// src/lib/indicators.ts
function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}
function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgG = gain / period;
  let avgL = loss / period;
  out[period] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgG = (avgG * (period - 1) + Math.max(d, 0)) / period;
    avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return out;
}
function crossAt(fast, slow, i) {
  if (i < 1) return null;
  const f0 = fast[i - 1], s0 = slow[i - 1], f1 = fast[i], s1 = slow[i];
  if (f0 == null || s0 == null || f1 == null || s1 == null) return null;
  if (f0 <= s0 && f1 > s1) return "UP";
  if (f0 >= s0 && f1 < s1) return "DOWN";
  return null;
}

// src/lib/strategy.ts
var DEFAULT_TREND_PERIOD = 200;
function computeIndicators(candles, trendPeriod = DEFAULT_TREND_PERIOD) {
  const closes = candles.map((c) => c.close);
  return { closes, sma9: sma(closes, 9), sma21: sma(closes, 21), rsi14: rsi(closes, 14), smaTrend: sma(closes, trendPeriod), trendPeriod };
}
var NONE = { signal: "AGUARDAR", cross: null, blockedByRsi: false, blockedByTrend: false };
function signalAt(ind, i, f) {
  const filters = typeof f === "boolean" ? { rsiFilter: f } : f;
  const cross = crossAt(ind.sma9, ind.sma21, i);
  if (!cross) return NONE;
  const side = cross === "UP" ? "LONG" : "SHORT";
  const r = ind.rsi14[i];
  const blockedByRsi = filters.rsiFilter && r != null && (side === "LONG" ? r >= 70 : r <= 30);
  let blockedByTrend = false;
  if (filters.trendFilter) {
    const t = ind.smaTrend[i];
    const c = ind.closes[i];
    blockedByTrend = t == null || (side === "LONG" ? c <= t : c >= t);
  }
  const blocked = blockedByRsi || blockedByTrend;
  return { signal: blocked ? "AGUARDAR" : side, cross, blockedByRsi, blockedByTrend };
}

// src/lib/analystEngine.ts
var DEFAULT_ANALYST_CONFIG = {
  instruments: ["BTC-USDT", "ETH-USDT"],
  timeframes: ["5m", "15m", "1H", "4H"],
  rsiFilter: true,
  trendFilter: false,
  trendPeriod: 200,
  intervalSec: 30,
  sound: false,
  notifications: false
};
function initialAnalystState(config = DEFAULT_ANALYST_CONFIG) {
  return {
    version: 2,
    enabled: false,
    config,
    lastProcessed: {},
    snapshots: {},
    signals: [],
    notifiedIds: [],
    lastPollAt: null,
    lastSuccessAt: null,
    lastError: null,
    streamErrors: {},
    log: []
  };
}
var signalId = (instId, tf, candleTs, side) => `${instId}|${tf}|${candleTs}|${side}`;
var hhmm = (ts) => new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
var p2 = (v) => v == null ? "\u2014" : v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
function suggestLevels(side, price, risk) {
  const sl = risk.stopLossPct / 100;
  const tp = risk.takeProfitPct / 100;
  return side === "LONG" ? { stop: price * (1 - sl), take: price * (1 + tp) } : { stop: price * (1 + sl), take: price * (1 - tp) };
}
function analyzeStream(args) {
  const { instId, tf, now } = args;
  const key = `${instId}|${tf}`;
  const closed = args.candles.filter((c) => c.confirmed);
  const base = {
    key,
    instId,
    tf,
    signal: "AGUARDAR",
    cross: null,
    blockedByRsi: false,
    candleTs: null,
    closeTime: null,
    close: null,
    sma9: null,
    sma21: null,
    rsi: null,
    reason: "Dados insuficientes (m\xEDnimo 22 candles fechados).",
    suggestedStop: null,
    suggestedTake: null,
    analyzedAt: now
  };
  if (closed.length < 22) return { snapshot: base, lastProcessedTs: args.lastProcessedTs, record: null };
  const ind = computeIndicators(closed, args.trendPeriod);
  const i = closed.length - 1;
  const last = closed[i];
  const s = signalAt(ind, i, { rsiFilter: args.rsiFilter, trendFilter: args.trendFilter });
  const smaT = ind.smaTrend[i];
  const sma9 = ind.sma9[i];
  const sma21 = ind.sma21[i];
  const rsi2 = ind.rsi14[i];
  const closeTime = last.ts + tfMs(tf);
  let reason;
  if (s.cross && s.blockedByTrend) {
    const dir = s.cross === "UP" ? "acima" : "abaixo";
    reason = smaT == null ? `SMA9 cruzou ${dir} da SMA21 \xE0s ${hhmm(closeTime)}, mas n\xE3o h\xE1 candles suficientes para a SMA${ind.trendPeriod}: bloqueado pelo filtro de tend\xEAncia.` : `SMA9 cruzou ${dir} da SMA21 \xE0s ${hhmm(closeTime)}, mas o pre\xE7o (${p2(last.close)}) est\xE1 ${last.close > smaT ? "acima" : "abaixo"} da SMA${ind.trendPeriod} (${p2(smaT)}): contra a tend\xEAncia, bloqueado.`;
  } else if (s.cross && s.blockedByRsi) {
    reason = s.cross === "UP" ? `SMA9 cruzou acima da SMA21 \xE0s ${hhmm(closeTime)}, mas RSI ${p2(rsi2)} \u2265 70 (sobrecomprado): bloqueado pelo filtro RSI.` : `SMA9 cruzou abaixo da SMA21 \xE0s ${hhmm(closeTime)}, mas RSI ${p2(rsi2)} \u2264 30 (sobrevendido): bloqueado pelo filtro RSI.`;
  } else if (s.cross === "UP") {
    reason = `SMA9 (${p2(sma9)}) cruzou ACIMA da SMA21 (${p2(sma21)}) no candle fechado \xE0s ${hhmm(closeTime)}. RSI ${p2(rsi2)}.`;
  } else if (s.cross === "DOWN") {
    reason = `SMA9 (${p2(sma9)}) cruzou ABAIXO da SMA21 (${p2(sma21)}) no candle fechado \xE0s ${hhmm(closeTime)}. RSI ${p2(rsi2)}.`;
  } else {
    reason = `Sem novo cruzamento. SMA9 ${sma9 > sma21 ? "acima" : "abaixo"} da SMA21 (tend\xEAncia de ${sma9 > sma21 ? "alta" : "baixa"}), sem confirma\xE7\xE3o de entrada.`;
  }
  const side = s.cross === "UP" ? "LONG" : s.cross === "DOWN" ? "SHORT" : null;
  const levels = side ? suggestLevels(side, last.close, args.risk) : null;
  const snapshot = {
    ...base,
    signal: s.signal,
    cross: s.cross,
    blockedByRsi: s.blockedByRsi,
    blockedByTrend: s.blockedByTrend,
    smaTrend: smaT,
    candleTs: last.ts,
    closeTime,
    close: last.close,
    sma9,
    sma21,
    rsi: rsi2,
    reason,
    suggestedStop: s.signal !== "AGUARDAR" ? levels.stop : null,
    suggestedTake: s.signal !== "AGUARDAR" ? levels.take : null
  };
  const isNewCandle = args.lastProcessedTs == null || last.ts > args.lastProcessedTs;
  if (!isNewCandle) return { snapshot, lastProcessedTs: args.lastProcessedTs, record: null };
  const record = side ? {
    id: signalId(instId, tf, last.ts, side),
    key,
    instId,
    tf,
    side,
    candleTs: last.ts,
    closeTime,
    price: last.close,
    sma9,
    sma21,
    rsi: rsi2,
    reason,
    suggestedStop: levels.stop,
    suggestedTake: levels.take,
    blockedByRsi: s.blockedByRsi,
    blockedByTrend: s.blockedByTrend,
    detectedAt: now,
    decisions: []
  } : null;
  return { snapshot, lastProcessedTs: last.ts, record };
}
function addAnalystLog(a, entry, now) {
  return { ...a, log: [{ ...entry, ts: now }, ...a.log].slice(0, 100) };
}

// src/lib/tradeMath.ts
var uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
function withSlippage(price, side, action, slippagePct) {
  const s = slippagePct / 100;
  const buying = side === "LONG" && action === "entry" || side === "SHORT" && action === "exit";
  return buying ? price * (1 + s) : price * (1 - s);
}
function openPosition(args) {
  const { cfg, side } = args;
  const margin = args.equity * (cfg.positionSizePct / 100);
  if (!(margin > 0)) return null;
  const entry = withSlippage(args.rawPrice, side, "entry", cfg.slippagePct);
  const notional = margin * cfg.leverage;
  const qty = notional / entry;
  const sl = cfg.stopLossPct / 100;
  const tp = cfg.takeProfitPct / 100;
  return {
    id: uid(),
    instId: args.instId,
    timeframe: args.timeframe,
    side,
    entryTime: args.time,
    entryPrice: entry,
    qty,
    margin,
    leverage: cfg.leverage,
    entryFee: notional * (cfg.feePct / 100),
    stopPrice: side === "LONG" ? entry * (1 - sl) : entry * (1 + sl),
    takePrice: side === "LONG" ? entry * (1 + tp) : entry * (1 - tp),
    signalCandleTs: args.signalCandleTs,
    signalId: args.signalId
  };
}
function grossPnl(pos, price) {
  const dir = pos.side === "LONG" ? 1 : -1;
  return (price - pos.entryPrice) * pos.qty * dir;
}
function closePosition(pos, rawPrice, time, reason, cfg) {
  const exit = withSlippage(rawPrice, pos.side, "exit", cfg.slippagePct);
  const exitFee = exit * pos.qty * (cfg.feePct / 100);
  const fees = pos.entryFee + exitFee;
  const gross = grossPnl(pos, exit);
  let pnl = gross - fees;
  let exitReason = reason;
  if (pnl < -pos.margin) {
    pnl = -pos.margin;
    exitReason = "Liquida\xE7\xE3o simulada";
  }
  return {
    id: pos.id,
    instId: pos.instId,
    timeframe: pos.timeframe,
    side: pos.side,
    entryTime: pos.entryTime,
    exitTime: time,
    entryPrice: pos.entryPrice,
    exitPrice: exit,
    qty: pos.qty,
    margin: pos.margin,
    leverage: pos.leverage,
    fees,
    grossPnl: gross,
    pnl,
    signalId: pos.signalId,
    pnlPctMargin: pnl / pos.margin * 100,
    exitReason
  };
}

// src/lib/simEngine.ts
var DEFAULT_SIM_CONFIG = {
  initialCapital: 100,
  allowedInst: ["BTC-USDT", "ETH-USDT"],
  allowedTf: ["15m", "1H"],
  leverage: 1,
  stopLossPct: 1.5,
  takeProfitPct: 3,
  positionSizePct: 50,
  feePct: 0.05,
  slippagePct: 0.02,
  exitOnOppositeCross: true,
  longOnly: true,
  // conta brasileira da OKX: só mercado à vista
  maxDailyLossPct: 5,
  maxTradesPerDay: 5
};
function initialSimState(config = DEFAULT_SIM_CONFIG, now = Date.now()) {
  return {
    version: 2,
    mode: "PAUSADO",
    config,
    balance: config.initialCapital,
    position: null,
    trades: [],
    processedSignalIds: [],
    startedAt: null,
    endedAt: null,
    lastPrices: {},
    log: [{ ts: now, type: "info", msg: `Simula\xE7\xE3o criada com saldo fict\xEDcio de US$ ${config.initialCapital}.` }]
  };
}
var sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
function dailyUsage(s, now) {
  const opened = s.trades.filter((t) => sameDay(t.entryTime, now)).length + (s.position && sameDay(s.position.entryTime, now) ? 1 : 0);
  const pnlToday = s.trades.filter((t) => sameDay(t.exitTime, now)).reduce((acc, t) => acc + t.pnl, 0);
  return { tradesOpenedToday: opened, pnlToday };
}
function limitReason(s, now) {
  const u = dailyUsage(s, now);
  if (u.tradesOpenedToday >= s.config.maxTradesPerDay) return `Limite de ${s.config.maxTradesPerDay} opera\xE7\xF5es por dia atingido`;
  const lossLimit = s.config.maxDailyLossPct / 100 * s.config.initialCapital;
  if (u.pnlToday <= -lossLimit) return `Limite de perda di\xE1ria (${s.config.maxDailyLossPct}% = US$ ${lossLimit.toFixed(2)}) atingido`;
  if (s.balance <= 0) return "Saldo fict\xEDcio esgotado";
  return null;
}
function log(s, type, msg, now) {
  return { ...s, log: [{ ts: now, type, msg }, ...s.log].slice(0, 150) };
}
function applyClose(s, t, now) {
  const next = { ...s, position: null, trades: [...s.trades, t], balance: s.balance + t.pnl };
  return log(next, "saida", `${t.side} ${t.instId.replace("-", "/")} encerrado (${t.exitReason}) a ${t.exitPrice.toFixed(2)} \xB7 bruto ${t.grossPnl >= 0 ? "+" : ""}${t.grossPnl.toFixed(2)} \xB7 l\xEDquido ${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(2)} USD (fict\xEDcio)`, now);
}
function start(s, now) {
  if (s.mode === "ATIVO") return s;
  const next = { ...s, mode: "ATIVO", startedAt: now, endedAt: null };
  return log(next, "info", "Simulador iniciado. Aguardando sinais NOVOS do Rob\xF4 Analista.", now);
}
function pause(s, now) {
  if (s.mode !== "ATIVO") return s;
  return log({ ...s, mode: "PAUSADO" }, "info", "Simulador pausado. Novas entradas bloqueadas; SL/TP de posi\xE7\xE3o aberta seguem monitorados.", now);
}
function onPrice(s, instId, price, now) {
  let next = { ...s, lastPrices: { ...s.lastPrices, [instId]: { price, at: now } } };
  const p = next.position;
  if (!p || p.instId !== instId) return next;
  const long = p.side === "LONG";
  const hitStop = long ? price <= p.stopPrice : price >= p.stopPrice;
  const hitTake = long ? price >= p.takePrice : price <= p.takePrice;
  if (hitStop) {
    next = applyClose(next, closePosition(p, price, now, "Stop Loss", next.config), now);
  } else if (hitTake) {
    next = applyClose(next, closePosition(p, p.takePrice, now, "Take Profit", next.config), now);
  }
  return next;
}
function entryRejection(s, r, now) {
  if (r.blockedByTrend) return "Bloqueado pelo filtro de tend\xEAncia do Rob\xF4 Analista (sinal contra a SMA longa)";
  if (r.blockedByRsi) return "Bloqueado pelo filtro RSI do Rob\xF4 Analista";
  if (s.mode === "PAUSADO") return "Simulador pausado";
  if (s.mode === "ENCERRADO") return "Simula\xE7\xE3o encerrada";
  if (!s.config.allowedInst.includes(r.instId)) return `${r.instId.replace("-", "/")} n\xE3o est\xE1 habilitado no simulador`;
  if (!s.config.allowedTf.includes(r.tf)) return `Tempo gr\xE1fico ${r.tf} n\xE3o est\xE1 habilitado no simulador`;
  if (s.config.longOnly && r.side === "SHORT") return "Modo \xE0 vista (s\xF3 LONG): sinal de venda serve apenas para sair de uma compra aberta";
  if (s.startedAt != null && r.closeTime < s.startedAt) return "Sinal anterior ao in\xEDcio da simula\xE7\xE3o";
  if (now - r.closeTime > tfMs(r.tf)) return "Sinal atrasado (candle fechou h\xE1 mais de 1 per\xEDodo)";
  if (s.position) return `J\xE1 existe posi\xE7\xE3o aberta (${s.position.side} ${s.position.instId.replace("-", "/")} ${s.position.timeframe}) \u2014 m\xE1ximo 1`;
  const lim = limitReason(s, now);
  if (lim) return lim;
  const price = s.lastPrices[r.instId];
  if (!price || now - price.at > 5 * 6e4) return "Sem pre\xE7o atual confi\xE1vel do ativo";
  return null;
}
function onSignal(s, r, now) {
  const decisions = [];
  if (s.processedSignalIds.includes(r.id)) {
    return { state: s, decisions };
  }
  let next = { ...s, processedSignalIds: [r.id, ...s.processedSignalIds].slice(0, 1e3) };
  const pos = next.position;
  if (pos && next.config.exitOnOppositeCross && pos.instId === r.instId && pos.timeframe === r.tf && pos.side !== r.side) {
    const price = next.lastPrices[r.instId]?.price;
    if (price != null) {
      next = applyClose(next, closePosition(pos, price, now, "Cruzamento oposto", next.config), now);
      decisions.push({ status: "saida", reason: `Encerrou ${pos.side} simulado por cruzamento oposto`, at: now });
    }
  }
  const why = entryRejection(next, r, now);
  if (why) {
    decisions.push({ status: "rejeitada", reason: why, at: now });
    next = log(next, "rejeicao", `Sinal ${r.side} ${r.instId.replace("-", "/")} ${r.tf} rejeitado: ${why}.`, now);
    return { state: next, decisions };
  }
  const position = openPosition({
    instId: r.instId,
    timeframe: r.tf,
    side: r.side,
    rawPrice: next.lastPrices[r.instId].price,
    time: now,
    equity: next.balance,
    cfg: next.config.longOnly ? { ...next.config, leverage: 1 } : next.config,
    signalCandleTs: r.candleTs,
    signalId: r.id
  });
  if (!position) {
    decisions.push({ status: "rejeitada", reason: "Tamanho de posi\xE7\xE3o inv\xE1lido", at: now });
    return { state: next, decisions };
  }
  next = log({ ...next, position }, "entrada", `${r.side} simulado aberto em ${r.instId.replace("-", "/")} ${r.tf} a ${position.entryPrice.toFixed(2)} \xB7 ${position.leverage}X \xB7 margem US$ ${position.margin.toFixed(2)} \xB7 SL ${position.stopPrice.toFixed(2)} \xB7 TP ${position.takePrice.toFixed(2)}`, now);
  decisions.push({ status: "aberta", reason: `Posi\xE7\xE3o ${r.side} fict\xEDcia aberta a ${position.entryPrice.toFixed(2)}`, at: now });
  return { state: next, decisions };
}
function updateConfig(s, config, now) {
  return log({ ...s, config }, "info", "Configura\xE7\xF5es do simulador atualizadas.", now);
}

// src/lib/okxDemo.ts
function demoActions(prev, next) {
  const out = [];
  if (prev && (!next || next.id !== prev.id)) out.push({ type: "close", pos: prev });
  if (next && (!prev || prev.id !== next.id)) out.push({ type: "open", pos: next });
  return out;
}
var openPayload = (p, c) => ({
  instId: p.instId,
  quote: c.quote,
  orderValue: c.orderValue,
  stopLossPct: +((p.entryPrice - p.stopPrice) / p.entryPrice * 100).toFixed(3),
  takeProfitPct: +((p.takePrice - p.entryPrice) / p.entryPrice * 100).toFixed(3),
  ref: p.signalId ?? p.id
});
var closePayload = (p, c) => ({ instId: p.instId, quote: c.quote, ref: p.signalId ?? p.id });

// src/lib/cloudCycle.ts
var MIN5 = 5 * 6e4;
var stable = (v) => Array.isArray(v) ? `[${v.map(stable).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}` : JSON.stringify(v);
var sameConfig = (a, b) => stable(a) === stable(b);
function analystConfig(c) {
  return { ...c.analyst, intervalSec: 60, sound: false, notifications: false };
}
var simConfig = (c) => ({ ...DEFAULT_SIM_CONFIG, ...c.sim });
function initialCloudState(cfg, now) {
  const analyst = { ...initialAnalystState(analystConfig(cfg)), enabled: true };
  let sim = initialSimState(simConfig(cfg), now);
  if (cfg.enabled) sim = start(sim, now);
  return {
    version: 1,
    createdAt: now,
    lastRunAt: null,
    lastOkAt: null,
    runs: 0,
    analyst,
    sim,
    demo: { log: [], handled: [] },
    log: [{ ts: now, type: "info", msg: "Rob\xF4 na nuvem criado." }]
  };
}
var addLog = (s, type, msg, ts) => ({ ...s, log: [{ ts, type, msg }, ...s.log].slice(0, 200) });
var addDemoLog = (s, e, ts) => ({ ...s, demo: { ...s.demo, log: [{ ...e, ts }, ...s.demo.log].slice(0, 100) } });
function replayStops(sim, instId, candles, from, now) {
  for (const c of candles) {
    const p = sim.position;
    if (!p || p.instId !== instId) break;
    if (c.ts + MIN5 <= Math.max(from, p.entryTime)) continue;
    const long = p.side === "LONG";
    const hitStop = long ? c.low <= p.stopPrice : c.high >= p.stopPrice;
    const hitTake = long ? c.high >= p.takePrice : c.low <= p.takePrice;
    const at = Math.min(c.ts + MIN5, now);
    if (hitStop) sim = onPrice(sim, instId, p.stopPrice, at);
    else if (hitTake) sim = onPrice(sim, instId, p.takePrice, at);
  }
  return sim;
}
async function runCycle(prev, cfg, deps) {
  const now = deps.now();
  let st = prev ?? initialCloudState(cfg, now);
  const from = st.lastRunAt ?? now;
  st = { ...st, lastRunAt: now, runs: st.runs + 1, config: cfg };
  const aCfg = analystConfig(cfg);
  if (!sameConfig(aCfg, st.analyst.config)) {
    st = { ...st, analyst: addAnalystLog({ ...st.analyst, config: aCfg }, { type: "info", msg: "Configura\xE7\xF5es do analista atualizadas (nuvem)." }, now) };
  }
  const sCfg = simConfig(cfg);
  if (!sameConfig(sCfg, st.sim.config)) st = { ...st, sim: updateConfig(st.sim, sCfg, now) };
  if (cfg.enabled && st.sim.mode !== "ATIVO") st = { ...st, sim: start(st.sim, now) };
  if (!cfg.enabled && st.sim.mode === "ATIVO") st = { ...st, sim: pause(st.sim, now) };
  const posBefore = st.sim.position;
  let sim = st.sim;
  const insts = new Set(aCfg.instruments);
  if (sim.position) insts.add(sim.position.instId);
  let failures = 0;
  for (const instId of insts) {
    try {
      if (sim.position?.instId === instId) sim = replayStops(sim, instId, await deps.candles(instId, "5m", 100), from, now);
      sim = onPrice(sim, instId, await deps.ticker(instId), now);
    } catch (e) {
      failures++;
      st = addLog(st, "erro", `Pre\xE7o de ${instId}: ${e instanceof Error ? e.message : "falha"}`, now);
    }
  }
  let a = { ...st.analyst, lastPollAt: now };
  const risk = { stopLossPct: sim.config.stopLossPct, takeProfitPct: sim.config.takeProfitPct };
  const snapshots = { ...a.snapshots };
  const lastProcessed = { ...a.lastProcessed };
  const streamErrors = {};
  const known = new Set(a.signals.map((x) => x.id));
  const fresh = [];
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
        streamErrors[key] = e instanceof Error ? e.message : "falha";
      }
    }
  }
  const total = insts.size + aCfg.instruments.length * aCfg.timeframes.length;
  const ok = failures < total;
  if (ok) {
    if (st.lastOkAt && now - st.lastOkAt > 10 * 6e4) {
      a = addAnalystLog(a, { type: "alerta", msg: `Rob\xF4 na nuvem ficou sem rodar entre ${new Date(st.lastOkAt).toISOString()} e ${new Date(now).toISOString()}. Candles desse intervalo n\xE3o geram sinais retroativos.` }, now);
    }
    a = { ...a, lastSuccessAt: now, lastError: null };
    st = { ...st, lastOkAt: now };
  } else {
    a = { ...a, lastError: "Sem conex\xE3o com a OKX nesta execu\xE7\xE3o." };
  }
  fresh.sort((x, y) => x.closeTime - y.closeTime);
  for (const rec of fresh) {
    const out = onSignal(sim, rec, now);
    sim = out.state;
    rec.decisions = out.decisions;
  }
  a = { ...a, snapshots, lastProcessed, streamErrors, signals: [...[...fresh].reverse(), ...a.signals].slice(0, 300) };
  st = { ...st, analyst: a, sim };
  if (cfg.demo.enabled && deps.demo) {
    const dcfg = { enabled: true, url: "", token: "", quote: cfg.demo.quote, orderValue: cfg.demo.orderValue };
    for (const act of demoActions(posBefore, sim.position)) {
      const key = `${act.type}:${act.pos.id}`;
      if (st.demo.handled.includes(key)) continue;
      st = { ...st, demo: { ...st.demo, handled: [key, ...st.demo.handled].slice(0, 400) } };
      const label = `${act.pos.side} ${act.pos.instId.replace("-", "/")}`;
      if (act.pos.side === "SHORT") {
        st = addDemoLog(st, { action: act.type === "open" ? "abrir" : "fechar", ok: false, msg: `${label}: conta \xE0 vista n\xE3o permite SHORT \u2014 nada enviado.` }, now);
        continue;
      }
      try {
        if (act.type === "close") {
          const r = await deps.demo("close", closePayload(act.pos, dcfg));
          st = addDemoLog(st, { action: "fechar", ok: true, msg: `${label}: ${r.message}` }, now);
        } else {
          const r = await deps.demo("open", openPayload(act.pos, dcfg));
          st = addDemoLog(st, { action: "abrir", ok: true, msg: r.duplicate ? `${label}: ${r.message}` : `${label}: compra de ${dcfg.orderValue} ${dcfg.quote} em ${r.instId} (~${r.refPrice}) \xB7 SL ${r.stop} \xB7 TP ${r.take} na OKX (ordem ${r.ordId}).` }, now);
        }
      } catch (e) {
        st = addDemoLog(st, { action: act.type === "open" ? "abrir" : "fechar", ok: false, msg: `${label}: ${e instanceof Error ? e.message : "falha"}` }, now);
      }
    }
  }
  return { state: st, fresh };
}

// bot/config.json
var config_default = {
  enabled: true,
  analyst: {
    instruments: ["BTC-USDT", "ETH-USDT"],
    timeframes: ["1H", "4H"],
    rsiFilter: true,
    trendFilter: true,
    trendPeriod: 200
  },
  sim: {
    initialCapital: 100,
    allowedInst: ["BTC-USDT", "ETH-USDT"],
    allowedTf: ["1H", "4H"],
    leverage: 1,
    stopLossPct: 1.5,
    takeProfitPct: 3,
    positionSizePct: 50,
    feePct: 0.05,
    slippagePct: 0.02,
    exitOnOppositeCross: true,
    longOnly: true,
    maxDailyLossPct: 5,
    maxTradesPerDay: 5
  },
  demo: { enabled: true, quote: "USDT", orderValue: 100 }
};

// bot/engine-entry.ts
var CONFIG = config_default;
export {
  CONFIG,
  initialCloudState,
  runCycle
};
