import { tfMs, type InstId, type Position, type SimConfig, type Trade } from '../types';
import { closePosition, grossPnl, openPosition } from './tradeMath';
import type { SignalDecision, SignalRecord } from './analystEngine';

/**
 * ROBÔ SIMULADOR — máquina de estados.
 *
 *   modo:  PAUSADO ──START──▶ ATIVO ──PAUSE──▶ PAUSADO
 *            ▲                  │
 *            └──── START ── ENCERRADO ◀──END── (qualquer)
 *
 *   posição: SEM_POSICAO ──sinal válido──▶ POSICAO_ABERTA ──SL/TP/cruz. oposto/manual/END──▶ SEM_POSICAO
 *
 * Garantias:
 *  - no máximo 1 posição aberta;
 *  - cada sinal (id único) é avaliado uma única vez (processedSignalIds);
 *  - o Analista só emite 1 registro por candle fechado/stream (lastProcessed);
 *  - SL/TP continuam monitorados mesmo com o simulador pausado.
 */

export type SimMode = 'PAUSADO' | 'ATIVO' | 'ENCERRADO';
export type SimPhase = 'PAUSADO' | 'AGUARDANDO_SINAL' | 'POSICAO_ABERTA' | 'BLOQUEADO_LIMITE' | 'ENCERRADO';

export interface SimLog {
  ts: number;
  type: 'info' | 'entrada' | 'saida' | 'rejeicao' | 'alerta';
  msg: string;
}

export interface SimState {
  version: 2;
  mode: SimMode;
  config: SimConfig;
  balance: number;
  position: Position | null;
  trades: Trade[];
  processedSignalIds: string[];
  startedAt: number | null;
  endedAt: number | null;
  lastPrices: Partial<Record<InstId, { price: number; at: number }>>;
  log: SimLog[];
}

export const DEFAULT_SIM_CONFIG: SimConfig = {
  initialCapital: 100,
  allowedInst: ['BTC-USDT', 'ETH-USDT'],
  allowedTf: ['15m', '1H'],
  leverage: 1,
  stopLossPct: 1.5,
  takeProfitPct: 3,
  positionSizePct: 50,
  feePct: 0.05,
  slippagePct: 0.02,
  exitOnOppositeCross: true,
  maxDailyLossPct: 5,
  maxTradesPerDay: 5,
};

export function initialSimState(config: SimConfig = DEFAULT_SIM_CONFIG, now = Date.now()): SimState {
  return {
    version: 2, mode: 'PAUSADO', config, balance: config.initialCapital, position: null, trades: [],
    processedSignalIds: [], startedAt: null, endedAt: null, lastPrices: {},
    log: [{ ts: now, type: 'info', msg: `Simulação criada com saldo fictício de US$ ${config.initialCapital}.` }],
  };
}

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

export function dailyUsage(s: SimState, now: number) {
  const opened = s.trades.filter((t) => sameDay(t.entryTime, now)).length + (s.position && sameDay(s.position.entryTime, now) ? 1 : 0);
  const pnlToday = s.trades.filter((t) => sameDay(t.exitTime, now)).reduce((acc, t) => acc + t.pnl, 0);
  return { tradesOpenedToday: opened, pnlToday };
}

export function simPhase(s: SimState, now: number): SimPhase {
  if (s.position) return 'POSICAO_ABERTA';
  if (s.mode === 'ENCERRADO') return 'ENCERRADO';
  if (s.mode === 'PAUSADO') return 'PAUSADO';
  return limitReason(s, now) ? 'BLOQUEADO_LIMITE' : 'AGUARDANDO_SINAL';
}

export function limitReason(s: SimState, now: number): string | null {
  const u = dailyUsage(s, now);
  if (u.tradesOpenedToday >= s.config.maxTradesPerDay) return `Limite de ${s.config.maxTradesPerDay} operações por dia atingido`;
  const lossLimit = (s.config.maxDailyLossPct / 100) * s.config.initialCapital;
  if (u.pnlToday <= -lossLimit) return `Limite de perda diária (${s.config.maxDailyLossPct}% = US$ ${lossLimit.toFixed(2)}) atingido`;
  if (s.balance <= 0) return 'Saldo fictício esgotado';
  return null;
}

export function unrealized(s: SimState): number | null {
  if (!s.position) return null;
  const p = s.lastPrices[s.position.instId]?.price;
  return p == null ? null : grossPnl(s.position, p) - s.position.entryFee;
}

function log(s: SimState, type: SimLog['type'], msg: string, now: number): SimState {
  return { ...s, log: [{ ts: now, type, msg }, ...s.log].slice(0, 150) };
}

function applyClose(s: SimState, t: Trade, now: number): SimState {
  const next: SimState = { ...s, position: null, trades: [...s.trades, t], balance: s.balance + t.pnl };
  return log(next, 'saida', `${t.side} ${t.instId.replace('-', '/')} encerrado (${t.exitReason}) a ${t.exitPrice.toFixed(2)} · bruto ${t.grossPnl! >= 0 ? '+' : ''}${t.grossPnl!.toFixed(2)} · líquido ${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)} USD (fictício)`, now);
}

// ---------- Eventos ----------

export function start(s: SimState, now: number): SimState {
  if (s.mode === 'ATIVO') return s;
  const next: SimState = { ...s, mode: 'ATIVO', startedAt: now, endedAt: null };
  return log(next, 'info', 'Simulador iniciado. Aguardando sinais NOVOS do Robô Analista.', now);
}

export function pause(s: SimState, now: number): SimState {
  if (s.mode !== 'ATIVO') return s;
  return log({ ...s, mode: 'PAUSADO' }, 'info', 'Simulador pausado. Novas entradas bloqueadas; SL/TP de posição aberta seguem monitorados.', now);
}

/** Encerra a simulação: fecha posição aberta (se houver) ao último preço e para o robô. */
export function end(s: SimState, now: number): { state: SimState; error?: string } {
  let next = s;
  if (s.position) {
    const p = s.lastPrices[s.position.instId]?.price;
    if (p == null) return { state: s, error: 'Sem preço atual para encerrar a posição. Tente novamente quando a conexão voltar.' };
    next = applyClose(next, closePosition(s.position, p, now, 'Encerramento manual', s.config), now);
  }
  return { state: log({ ...next, mode: 'ENCERRADO', endedAt: now }, 'info', 'Simulação encerrada.', now) };
}

export function manualClose(s: SimState, now: number): { state: SimState; error?: string } {
  if (!s.position) return { state: s };
  const p = s.lastPrices[s.position.instId]?.price;
  if (p == null) return { state: s, error: 'Sem preço atual. A posição continua aberta.' };
  return { state: applyClose(s, closePosition(s.position, p, now, 'Encerramento manual', s.config), now) };
}

/** Novo preço de mercado: atualiza o cache e verifica SL/TP. */
export function onPrice(s: SimState, instId: InstId, price: number, now: number): SimState {
  let next: SimState = { ...s, lastPrices: { ...s.lastPrices, [instId]: { price, at: now } } };
  const p = next.position;
  if (!p || p.instId !== instId) return next;
  const long = p.side === 'LONG';
  const hitStop = long ? price <= p.stopPrice : price >= p.stopPrice;
  const hitTake = long ? price >= p.takePrice : price <= p.takePrice;
  if (hitStop) {
    // executa ao preço atual (pode ser pior que o stop, como num gap real)
    next = applyClose(next, closePosition(p, price, now, 'Stop Loss', next.config), now);
  } else if (hitTake) {
    // conservador: executa no preço do alvo, não acima
    next = applyClose(next, closePosition(p, p.takePrice, now, 'Take Profit', next.config), now);
  }
  return next;
}

/** Validação pura de um sinal para ENTRADA. Retorna o motivo da rejeição ou null se válido. */
export function entryRejection(s: SimState, r: SignalRecord, now: number): string | null {
  if (r.blockedByTrend) return 'Bloqueado pelo filtro de tendência do Robô Analista (sinal contra a SMA longa)';
  if (r.blockedByRsi) return 'Bloqueado pelo filtro RSI do Robô Analista';
  if (s.mode === 'PAUSADO') return 'Simulador pausado';
  if (s.mode === 'ENCERRADO') return 'Simulação encerrada';
  if (!s.config.allowedInst.includes(r.instId)) return `${r.instId.replace('-', '/')} não está habilitado no simulador`;
  if (!s.config.allowedTf.includes(r.tf)) return `Tempo gráfico ${r.tf} não está habilitado no simulador`;
  if (s.startedAt != null && r.closeTime < s.startedAt) return 'Sinal anterior ao início da simulação';
  if (now - r.closeTime > tfMs(r.tf)) return 'Sinal atrasado (candle fechou há mais de 1 período)';
  if (s.position) return `Já existe posição aberta (${s.position.side} ${s.position.instId.replace('-', '/')} ${s.position.timeframe}) — máximo 1`;
  const lim = limitReason(s, now);
  if (lim) return lim;
  const price = s.lastPrices[r.instId];
  if (!price || now - price.at > 5 * 60_000) return 'Sem preço atual confiável do ativo';
  return null;
}

/** Sinal do Analista → decisões do Simulador (saída por cruzamento oposto e/ou entrada). */
export function onSignal(s: SimState, r: SignalRecord, now: number): { state: SimState; decisions: SignalDecision[] } {
  const decisions: SignalDecision[] = [];
  if (s.processedSignalIds.includes(r.id)) {
    return { state: s, decisions }; // nunca processa o mesmo sinal duas vezes
  }
  let next: SimState = { ...s, processedSignalIds: [r.id, ...s.processedSignalIds].slice(0, 1000) };

  // 1) Saída por cruzamento oposto no MESMO ativo e tempo gráfico da posição
  const pos = next.position;
  if (pos && next.config.exitOnOppositeCross && pos.instId === r.instId && pos.timeframe === r.tf && pos.side !== r.side) {
    const price = next.lastPrices[r.instId]?.price;
    if (price != null) {
      next = applyClose(next, closePosition(pos, price, now, 'Cruzamento oposto', next.config), now);
      decisions.push({ status: 'saida', reason: `Encerrou ${pos.side} simulado por cruzamento oposto`, at: now });
    }
  }

  // 2) Entrada
  const why = entryRejection(next, r, now);
  if (why) {
    decisions.push({ status: 'rejeitada', reason: why, at: now });
    next = log(next, 'rejeicao', `Sinal ${r.side} ${r.instId.replace('-', '/')} ${r.tf} rejeitado: ${why}.`, now);
    return { state: next, decisions };
  }
  const position = openPosition({
    instId: r.instId, timeframe: r.tf, side: r.side, rawPrice: next.lastPrices[r.instId]!.price, time: now,
    equity: next.balance, cfg: next.config, signalCandleTs: r.candleTs, signalId: r.id,
  });
  if (!position) {
    decisions.push({ status: 'rejeitada', reason: 'Tamanho de posição inválido', at: now });
    return { state: next, decisions };
  }
  next = log({ ...next, position }, 'entrada', `${r.side} simulado aberto em ${r.instId.replace('-', '/')} ${r.tf} a ${position.entryPrice.toFixed(2)} · ${position.leverage}X · margem US$ ${position.margin.toFixed(2)} · SL ${position.stopPrice.toFixed(2)} · TP ${position.takePrice.toFixed(2)}`, now);
  decisions.push({ status: 'aberta', reason: `Posição ${r.side} fictícia aberta a ${position.entryPrice.toFixed(2)}`, at: now });
  return { state: next, decisions };
}

export function updateConfig(s: SimState, config: SimConfig, now: number): SimState {
  return log({ ...s, config }, 'info', 'Configurações do simulador atualizadas.', now);
}
