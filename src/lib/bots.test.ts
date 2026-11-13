import { describe, expect, it } from 'vitest';
import type { Candle, InstId, Timeframe } from '../types';
import { analyzeStream, type SignalRecord } from './analystEngine';
import * as Sim from './simEngine';

const M15 = 15 * 60_000;
const T0 = Date.UTC(2026, 10, 13, 12, 0); // meio-dia UTC

/** 25 candles em queda + 1 forte alta → cruzamento de alta exatamente no último candle. */
function crossUpCandles(confirmLast = true): Candle[] {
  const closes = [...Array.from({ length: 30 }, (_, i) => 100 - i * 0.5), 140];
  return closes.map((c, i) => ({
    ts: T0 + i * M15, open: i ? closes[i - 1] : c, high: Math.max(c, i ? closes[i - 1] : c), low: Math.min(c, i ? closes[i - 1] : c),
    close: c, volume: 1, confirmed: i < closes.length - 1 || confirmLast,
  }));
}

const lastCloseTime = (cs: Candle[]) => cs[cs.length - 1].ts + M15;

function mkSignal(over: Partial<SignalRecord> = {}): SignalRecord {
  const candleTs = T0;
  return {
    id: `ETH-USDT|15m|${candleTs}|LONG`, key: 'ETH-USDT|15m', instId: 'ETH-USDT', tf: '15m', side: 'LONG',
    candleTs, closeTime: candleTs + M15, price: 3000, sma9: 1, sma21: 1, rsi: 50, reason: 'teste',
    suggestedStop: 2950, suggestedTake: 3100, blockedByRsi: false, detectedAt: candleTs + M15 + 1000, decisions: [], ...over,
  };
}

const cfg = { ...Sim.DEFAULT_SIM_CONFIG, feePct: 0, slippagePct: 0, stopLossPct: 2, takeProfitPct: 4, positionSizePct: 100, allowedTf: ['15m', '1H'] as Timeframe[] };

/** Simulador ativo, iniciado antes do sinal, com preço atual conhecido. */
function activeSim(price = 3000, instId: InstId = 'ETH-USDT') {
  let s = Sim.initialSimState(cfg, T0);
  s = Sim.start(s, T0);
  s = Sim.onPrice(s, instId, price, T0 + M15 + 1000);
  return s;
}

describe('Robô Analista', () => {
  const risk = { stopLossPct: 2, takeProfitPct: 4 };

  it('gera sinal LONG em cruzamento confirmado, com SL/TP sugeridos', () => {
    const cs = crossUpCandles();
    const r = analyzeStream({ instId: 'ETH-USDT', tf: '15m', candles: cs, lastProcessedTs: undefined, rsiFilter: false, risk, now: lastCloseTime(cs) });
    expect(r.snapshot.signal).toBe('LONG');
    expect(r.record?.side).toBe('LONG');
    expect(r.record!.suggestedStop).toBeCloseTo(140 * 0.98);
    expect(r.record!.suggestedTake).toBeCloseTo(140 * 1.04);
  });

  it('ignora candle em formação (não confirmado)', () => {
    const cs = crossUpCandles(false);
    const r = analyzeStream({ instId: 'ETH-USDT', tf: '15m', candles: cs, lastProcessedTs: undefined, rsiFilter: false, risk, now: T0 });
    expect(r.record).toBeNull();
    expect(r.snapshot.signal).toBe('AGUARDAR');
  });

  it('não processa o mesmo candle duas vezes', () => {
    const cs = crossUpCandles();
    const r1 = analyzeStream({ instId: 'ETH-USDT', tf: '15m', candles: cs, lastProcessedTs: undefined, rsiFilter: false, risk, now: T0 });
    const r2 = analyzeStream({ instId: 'ETH-USDT', tf: '15m', candles: cs, lastProcessedTs: r1.lastProcessedTs, rsiFilter: false, risk, now: T0 + 1 });
    expect(r1.record).not.toBeNull();
    expect(r2.record).toBeNull();
    expect(r2.snapshot.signal).toBe('LONG'); // painel continua mostrando o estado
  });

  it('filtro RSI marca o sinal como bloqueado', () => {
    const cs = crossUpCandles(); // alta de 140 após queda → RSI alto
    const r = analyzeStream({ instId: 'ETH-USDT', tf: '15m', candles: cs, lastProcessedTs: undefined, rsiFilter: true, risk, now: T0 });
    expect(r.snapshot.rsi!).toBeGreaterThanOrEqual(70);
    expect(r.snapshot.signal).toBe('AGUARDAR');
    expect(r.record?.blockedByRsi).toBe(true);
  });

  it('dados insuficientes → AGUARDAR sem registro', () => {
    const cs = crossUpCandles().slice(-10);
    const r = analyzeStream({ instId: 'ETH-USDT', tf: '15m', candles: cs, lastProcessedTs: undefined, rsiFilter: false, risk, now: T0 });
    expect(r.snapshot.signal).toBe('AGUARDAR');
    expect(r.record).toBeNull();
  });
});

describe('Robô Simulador — máquina de estados', () => {
  it('abre posição em sinal válido', () => {
    const s = activeSim();
    const out = Sim.onSignal(s, mkSignal(), T0 + M15 + 2000);
    expect(out.state.position?.side).toBe('LONG');
    expect(out.decisions[0].status).toBe('aberta');
    expect(Sim.simPhase(out.state, T0 + M15 + 2000)).toBe('POSICAO_ABERTA');
  });

  it('nunca reprocessa o mesmo sinal (sem duplicar posição)', () => {
    let s = activeSim();
    s = Sim.onSignal(s, mkSignal(), T0 + M15 + 2000).state;
    s = Sim.manualClose(s, T0 + M15 + 3000).state;
    const again = Sim.onSignal(s, mkSignal(), T0 + M15 + 4000);
    expect(again.state.position).toBeNull();
    expect(again.decisions).toHaveLength(0);
    expect(again.state.trades).toHaveLength(1);
  });

  it('apenas uma posição por vez', () => {
    let s = activeSim();
    s = Sim.onSignal(s, mkSignal(), T0 + M15 + 2000).state;
    s = Sim.onPrice(s, 'BTC-USDT', 98000, T0 + M15 + 2500);
    const other = mkSignal({ id: 'BTC|x', instId: 'BTC-USDT', key: 'BTC-USDT|15m' });
    const out = Sim.onSignal(s, other, T0 + M15 + 3000);
    expect(out.state.position?.instId).toBe('ETH-USDT');
    expect(out.decisions[0].reason).toContain('Já existe posição aberta');
  });

  it('rejeita quando pausado, atrasado, anterior ao início ou não habilitado', () => {
    const paused = Sim.pause(activeSim(), T0 + 1);
    expect(Sim.onSignal(paused, mkSignal(), T0 + M15 + 2000).decisions[0].reason).toBe('Simulador pausado');

    expect(Sim.onSignal(activeSim(), mkSignal(), T0 + 3 * M15).decisions[0].reason).toContain('atrasado');

    let late = Sim.initialSimState(cfg, T0);
    late = Sim.start(late, T0 + M15 + 500);
    late = Sim.onPrice(late, 'ETH-USDT', 3000, T0 + M15 + 1000);
    expect(Sim.onSignal(late, mkSignal(), T0 + M15 + 2000).decisions[0].reason).toContain('anterior ao início');

    const tf5 = mkSignal({ id: 'x5', tf: '5m', closeTime: T0 + 5 * 60_000 });
    expect(Sim.onSignal(activeSim(), tf5, T0 + 5 * 60_000 + 1000).decisions[0].reason).toContain('não está habilitado');

    expect(Sim.onSignal(activeSim(), mkSignal({ blockedByRsi: true }), T0 + M15 + 2000).decisions[0].reason).toContain('RSI');
  });

  it('fecha no Stop Loss ao preço atual e no Take Profit ao preço-alvo', () => {
    let s = Sim.onSignal(activeSim(), mkSignal(), T0 + M15 + 2000).state;
    const stop = s.position!.stopPrice;
    const sl = Sim.onPrice(s, 'ETH-USDT', stop - 10, T0 + M15 + 5000);
    expect(sl.position).toBeNull();
    expect(sl.trades[0].exitReason).toBe('Stop Loss');
    expect(sl.trades[0].exitPrice).toBe(stop - 10);
    expect(sl.balance).toBeLessThan(100);

    s = Sim.onSignal(activeSim(), mkSignal(), T0 + M15 + 2000).state;
    const take = s.position!.takePrice;
    const tp = Sim.onPrice(s, 'ETH-USDT', take + 50, T0 + M15 + 5000);
    expect(tp.trades[0].exitReason).toBe('Take Profit');
    expect(tp.trades[0].exitPrice).toBe(take);
    expect(tp.balance).toBeGreaterThan(100);
  });

  it('SL/TP continuam monitorados com o simulador pausado', () => {
    let s = Sim.onSignal(activeSim(), mkSignal(), T0 + M15 + 2000).state;
    s = Sim.pause(s, T0 + M15 + 3000);
    s = Sim.onPrice(s, 'ETH-USDT', 1, T0 + M15 + 4000);
    expect(s.position).toBeNull();
  });

  it('cruzamento oposto no mesmo gráfico encerra a posição', () => {
    let s = Sim.onSignal(activeSim(), mkSignal(), T0 + M15 + 2000).state;
    const short = mkSignal({ id: 'short', side: 'SHORT', candleTs: T0 + M15, closeTime: T0 + 2 * M15 });
    s = Sim.onPrice(s, 'ETH-USDT', 3010, T0 + 2 * M15 + 500);
    const out = Sim.onSignal(s, short, T0 + 2 * M15 + 1000);
    expect(out.decisions[0].status).toBe('saida');
    expect(out.state.trades[0].exitReason).toBe('Cruzamento oposto');
    expect(out.state.position?.side).toBe('SHORT'); // e entra no novo sinal
  });

  it('taxas e slippage: bruto > líquido', () => {
    let s = Sim.initialSimState({ ...cfg, feePct: 0.1, slippagePct: 0.05 }, T0);
    s = Sim.start(s, T0);
    s = Sim.onPrice(s, 'ETH-USDT', 3000, T0 + M15 + 1000);
    s = Sim.onSignal(s, mkSignal(), T0 + M15 + 2000).state;
    expect(s.position!.entryPrice).toBeCloseTo(3000 * 1.0005);
    s = Sim.onPrice(s, 'ETH-USDT', 3030, T0 + M15 + 3000);
    s = Sim.manualClose(s, T0 + M15 + 4000).state;
    const t = s.trades[0];
    expect(t.grossPnl!).toBeGreaterThan(t.pnl);
    expect(t.grossPnl! - t.pnl).toBeCloseTo(t.fees);
  });

  it('limite de operações por dia e de perda diária', () => {
    let s = Sim.initialSimState({ ...cfg, maxTradesPerDay: 1 }, T0);
    s = Sim.start(s, T0);
    s = Sim.onPrice(s, 'ETH-USDT', 3000, T0 + M15 + 1000);
    s = Sim.onSignal(s, mkSignal(), T0 + M15 + 2000).state;
    s = Sim.manualClose(s, T0 + M15 + 3000).state;
    const sig2 = mkSignal({ id: 'n2', candleTs: T0 + M15, closeTime: T0 + 2 * M15 });
    s = Sim.onPrice(s, 'ETH-USDT', 3000, T0 + 2 * M15 + 500);
    expect(Sim.onSignal(s, sig2, T0 + 2 * M15 + 1000).decisions[0].reason).toContain('operações por dia');

    let l = Sim.initialSimState({ ...cfg, maxDailyLossPct: 1 }, T0);
    l = Sim.start(l, T0);
    l = Sim.onPrice(l, 'ETH-USDT', 3000, T0 + M15 + 1000);
    l = Sim.onSignal(l, mkSignal(), T0 + M15 + 2000).state;
    l = Sim.onPrice(l, 'ETH-USDT', 2900, T0 + M15 + 3000); // stop
    expect(Sim.simPhase(l, T0 + M15 + 3000)).toBe('BLOQUEADO_LIMITE');
    l = Sim.onPrice(l, 'ETH-USDT', 2900, T0 + 2 * M15 + 500);
    expect(Sim.onSignal(l, sig2, T0 + 2 * M15 + 1000).decisions[0].reason).toContain('perda diária');
  });

  it('alavancagem 3X: perda limitada à margem (liquidação simulada)', () => {
    let s = Sim.initialSimState({ ...cfg, leverage: 3, stopLossPct: 50 }, T0);
    s = Sim.start(s, T0);
    s = Sim.onPrice(s, 'ETH-USDT', 3000, T0 + M15 + 1000);
    s = Sim.onSignal(s, mkSignal(), T0 + M15 + 2000).state;
    s = Sim.onPrice(s, 'ETH-USDT', 1400, T0 + M15 + 3000);
    expect(s.trades[0].exitReason).toBe('Liquidação simulada');
    expect(s.trades[0].pnl).toBeCloseTo(-100);
    expect(s.balance).toBeCloseTo(0);
  });

  it('Encerrar simulação fecha a posição e muda o estado', () => {
    let s = Sim.onSignal(activeSim(), mkSignal(), T0 + M15 + 2000).state;
    const r = Sim.end(s, T0 + M15 + 3000);
    expect(r.state.position).toBeNull();
    expect(r.state.mode).toBe('ENCERRADO');
    expect(Sim.onSignal(r.state, mkSignal({ id: 'z' }), T0 + M15 + 4000).decisions[0].reason).toBe('Simulação encerrada');
    s = Sim.start(r.state, T0 + M15 + 5000);
    expect(s.mode).toBe('ATIVO');
  });
});

describe('filtro de tendência no Analista e Simulador', () => {
  it('cruzamento de alta abaixo da SMA longa é bloqueado e explicado', () => {
    const closes = [...Array.from({ length: 400 }, (_, i) => 1000 - 2 * i), 392]; // queda longa + salto que cruza as médias curtas, mas abaixo da SMA200
    const cs: Candle[] = closes.map((c, i) => ({ ts: T0 + i * M15, open: c, high: c + 1, low: c - 1, close: c, volume: 1, confirmed: true }));
    const r = analyzeStream({ instId: 'ETH-USDT', tf: '15m', candles: cs, lastProcessedTs: undefined, rsiFilter: false, trendFilter: true, trendPeriod: 200, risk: { stopLossPct: 2, takeProfitPct: 4 }, now: T0 });
    expect(r.snapshot.cross).toBe('UP');
    expect(r.snapshot.signal).toBe('AGUARDAR');
    expect(r.record?.blockedByTrend).toBe(true);
    expect(r.snapshot.reason).toContain('SMA200');
    const out = Sim.onSignal(activeSim(), { ...mkSignal(), blockedByTrend: true }, T0 + M15 + 2000);
    expect(out.decisions[0].reason).toContain('tendência');
    expect(out.state.position).toBeNull();
  });
});
