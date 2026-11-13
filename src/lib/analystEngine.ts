import { instLabel, tfMs, type Candle, type InstId, type Side, type Signal, type Timeframe } from '../types';
import { computeIndicators, signalAt } from './strategy';
import type { Cross } from './indicators';

/**
 * ROBÔ ANALISTA — somente análise. Nunca abre posições.
 * Cada "stream" é um par ativo × tempo gráfico (ex.: ETH-USDT|15m).
 */

export interface AnalystConfig {
  instruments: InstId[];
  timeframes: Timeframe[];
  rsiFilter: boolean;
  trendFilter: boolean;
  trendPeriod: number;
  intervalSec: 15 | 30 | 60;
  sound: boolean;
  notifications: boolean;
}

export interface StreamSnapshot {
  key: string;
  instId: InstId;
  tf: Timeframe;
  signal: Signal;
  cross: Cross;
  blockedByRsi: boolean;
  blockedByTrend?: boolean;
  smaTrend?: number | null;
  candleTs: number | null; // abertura do último candle FECHADO
  closeTime: number | null; // fechamento desse candle
  close: number | null;
  sma9: number | null;
  sma21: number | null;
  rsi: number | null;
  reason: string;
  suggestedStop: number | null;
  suggestedTake: number | null;
  analyzedAt: number;
}

export interface SignalDecision {
  status: 'aberta' | 'rejeitada' | 'saida';
  reason: string;
  at: number;
}

export interface SignalRecord {
  id: string; // instId|tf|candleTs|side — único por sinal
  key: string;
  instId: InstId;
  tf: Timeframe;
  side: Side;
  candleTs: number;
  closeTime: number;
  price: number;
  sma9: number;
  sma21: number;
  rsi: number | null;
  reason: string;
  suggestedStop: number;
  suggestedTake: number;
  blockedByRsi: boolean;
  blockedByTrend?: boolean;
  detectedAt: number;
  decisions: SignalDecision[];
}

export interface AnalystLog {
  ts: number;
  type: 'info' | 'erro' | 'ok' | 'alerta';
  msg: string;
}

export interface AnalystState {
  version: 2;
  enabled: boolean;
  config: AnalystConfig;
  lastProcessed: Record<string, number>; // último candle fechado processado por stream
  snapshots: Record<string, StreamSnapshot>;
  signals: SignalRecord[]; // mais recente primeiro
  notifiedIds: string[];
  lastPollAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  streamErrors: Record<string, string>;
  log: AnalystLog[];
}

export const DEFAULT_ANALYST_CONFIG: AnalystConfig = {
  instruments: ['BTC-USDT', 'ETH-USDT'],
  timeframes: ['5m', '15m', '1H', '4H'],
  rsiFilter: true,
  trendFilter: false,
  trendPeriod: 200,
  intervalSec: 30,
  sound: false,
  notifications: false,
};

export function initialAnalystState(config = DEFAULT_ANALYST_CONFIG): AnalystState {
  return {
    version: 2, enabled: false, config, lastProcessed: {}, snapshots: {}, signals: [], notifiedIds: [],
    lastPollAt: null, lastSuccessAt: null, lastError: null, streamErrors: {}, log: [],
  };
}

export const signalId = (instId: InstId, tf: Timeframe, candleTs: number, side: Side) => `${instId}|${tf}|${candleTs}|${side}`;

const hhmm = (ts: number) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const p2 = (v: number | null) => (v == null ? '—' : v.toLocaleString('pt-BR', { maximumFractionDigits: 2 }));

export interface RiskParams {
  stopLossPct: number;
  takeProfitPct: number;
}

export function suggestLevels(side: Side, price: number, risk: RiskParams) {
  const sl = risk.stopLossPct / 100;
  const tp = risk.takeProfitPct / 100;
  return side === 'LONG'
    ? { stop: price * (1 - sl), take: price * (1 + tp) }
    : { stop: price * (1 + sl), take: price * (1 - tp) };
}

/**
 * Analisa um stream. Gera um SignalRecord SOMENTE quando há um candle fechado
 * ainda não processado e houve cruzamento nele (cada candle é processado uma única vez).
 */
export function analyzeStream(args: {
  instId: InstId;
  tf: Timeframe;
  candles: Candle[];
  lastProcessedTs: number | undefined;
  rsiFilter: boolean;
  trendFilter?: boolean;
  trendPeriod?: number;
  risk: RiskParams;
  now: number;
}): { snapshot: StreamSnapshot; lastProcessedTs: number | undefined; record: SignalRecord | null } {
  const { instId, tf, now } = args;
  const key = `${instId}|${tf}`;
  const closed = args.candles.filter((c) => c.confirmed);
  const base: StreamSnapshot = {
    key, instId, tf, signal: 'AGUARDAR', cross: null, blockedByRsi: false, candleTs: null, closeTime: null,
    close: null, sma9: null, sma21: null, rsi: null, reason: 'Dados insuficientes (mínimo 22 candles fechados).',
    suggestedStop: null, suggestedTake: null, analyzedAt: now,
  };
  if (closed.length < 22) return { snapshot: base, lastProcessedTs: args.lastProcessedTs, record: null };

  const ind = computeIndicators(closed, args.trendPeriod);
  const i = closed.length - 1;
  const last = closed[i];
  const s = signalAt(ind, i, { rsiFilter: args.rsiFilter, trendFilter: args.trendFilter });
  const smaT = ind.smaTrend[i];
  const sma9 = ind.sma9[i]!;
  const sma21 = ind.sma21[i]!;
  const rsi = ind.rsi14[i];
  const closeTime = last.ts + tfMs(tf);

  let reason: string;
  if (s.cross && s.blockedByTrend) {
    const dir = s.cross === 'UP' ? 'acima' : 'abaixo';
    reason = smaT == null
      ? `SMA9 cruzou ${dir} da SMA21 às ${hhmm(closeTime)}, mas não há candles suficientes para a SMA${ind.trendPeriod}: bloqueado pelo filtro de tendência.`
      : `SMA9 cruzou ${dir} da SMA21 às ${hhmm(closeTime)}, mas o preço (${p2(last.close)}) está ${last.close > smaT ? 'acima' : 'abaixo'} da SMA${ind.trendPeriod} (${p2(smaT)}): contra a tendência, bloqueado.`;
  } else if (s.cross && s.blockedByRsi) {
    reason = s.cross === 'UP'
      ? `SMA9 cruzou acima da SMA21 às ${hhmm(closeTime)}, mas RSI ${p2(rsi)} ≥ 70 (sobrecomprado): bloqueado pelo filtro RSI.`
      : `SMA9 cruzou abaixo da SMA21 às ${hhmm(closeTime)}, mas RSI ${p2(rsi)} ≤ 30 (sobrevendido): bloqueado pelo filtro RSI.`;
  } else if (s.cross === 'UP') {
    reason = `SMA9 (${p2(sma9)}) cruzou ACIMA da SMA21 (${p2(sma21)}) no candle fechado às ${hhmm(closeTime)}. RSI ${p2(rsi)}.`;
  } else if (s.cross === 'DOWN') {
    reason = `SMA9 (${p2(sma9)}) cruzou ABAIXO da SMA21 (${p2(sma21)}) no candle fechado às ${hhmm(closeTime)}. RSI ${p2(rsi)}.`;
  } else {
    reason = `Sem novo cruzamento. SMA9 ${sma9 > sma21 ? 'acima' : 'abaixo'} da SMA21 (tendência de ${sma9 > sma21 ? 'alta' : 'baixa'}), sem confirmação de entrada.`;
  }

  const side: Side | null = s.cross === 'UP' ? 'LONG' : s.cross === 'DOWN' ? 'SHORT' : null;
  const levels = side ? suggestLevels(side, last.close, args.risk) : null;

  const snapshot: StreamSnapshot = {
    ...base, signal: s.signal, cross: s.cross, blockedByRsi: s.blockedByRsi, blockedByTrend: s.blockedByTrend, smaTrend: smaT, candleTs: last.ts, closeTime,
    close: last.close, sma9, sma21, rsi, reason,
    suggestedStop: s.signal !== 'AGUARDAR' ? levels!.stop : null,
    suggestedTake: s.signal !== 'AGUARDAR' ? levels!.take : null,
  };

  const isNewCandle = args.lastProcessedTs == null || last.ts > args.lastProcessedTs;
  if (!isNewCandle) return { snapshot, lastProcessedTs: args.lastProcessedTs, record: null };

  const record: SignalRecord | null = side
    ? {
        id: signalId(instId, tf, last.ts, side), key, instId, tf, side, candleTs: last.ts, closeTime,
        price: last.close, sma9, sma21, rsi, reason, suggestedStop: levels!.stop, suggestedTake: levels!.take,
        blockedByRsi: s.blockedByRsi, blockedByTrend: s.blockedByTrend, detectedAt: now, decisions: [],
      }
    : null;
  return { snapshot, lastProcessedTs: last.ts, record };
}

export type AnalystStatus = 'ativo' | 'pausado' | 'erro' | 'interrompido' | 'iniciando';

export function analystStatus(a: AnalystState, now: number, visible: boolean): AnalystStatus {
  if (!a.enabled) return 'pausado';
  if (!visible) return 'interrompido';
  if (a.lastError) return 'erro';
  if (!a.lastSuccessAt) return 'iniciando';
  if (now - a.lastSuccessAt > a.config.intervalSec * 3 * 1000) return 'interrompido';
  return 'ativo';
}

export const describeSignal = (r: SignalRecord) => `${r.side} ${instLabel(r.instId)} ${r.tf}`;

export function addAnalystLog(a: AnalystState, entry: Omit<AnalystLog, 'ts'>, now: number): AnalystState {
  return { ...a, log: [{ ...entry, ts: now }, ...a.log].slice(0, 100) };
}

/** Sinal bloqueado por algum filtro (RSI ou tendência). */
export const isBlocked = (r: Pick<SignalRecord, 'blockedByRsi' | 'blockedByTrend'>) => r.blockedByRsi || !!r.blockedByTrend;
export const blockLabel = (r: Pick<SignalRecord, 'blockedByRsi' | 'blockedByTrend'>) =>
  r.blockedByTrend ? 'tendência' : r.blockedByRsi ? 'RSI' : '';
