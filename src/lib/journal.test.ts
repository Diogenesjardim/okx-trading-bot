import { describe, expect, it } from 'vitest';
import { estimateFee, journalStats, realNet, validateOpen, type RealTrade } from './journal';

const base: RealTrade = {
  id: '1', instId: 'ETH-USDT', side: 'LONG', openedAt: 0, entryPrice: 2000, amount: 20, leverage: 1,
  stopPrice: 1970, takePrice: 2060, entryFee: 0.01, signalId: null, notes: '', closedAt: null, exitPrice: null, exitFee: 0, exitReason: null,
};

describe('diário de operações reais', () => {
  it('resultado líquido LONG e SHORT com taxas e alavancagem', () => {
    const long = { ...base, exitPrice: 2060, exitFee: 0.01, closedAt: 1 };
    expect(realNet(long)).toBeCloseTo(20 * 0.03 - 0.02); // +3% de 20 USDT − taxas
    const short = { ...base, side: 'SHORT' as const, leverage: 2, stopPrice: 2030, takePrice: 1940, exitPrice: 1940, exitFee: 0.01, closedAt: 1 };
    expect(realNet(short)).toBeCloseTo(40 * 0.03 - 0.02);
    expect(realNet(base)).toBeNull(); // aberta
  });

  it('valida stop e alvo do lado certo', () => {
    expect(validateOpen(base)).toEqual([]);
    expect(validateOpen({ ...base, stopPrice: 2010 }).join()).toContain('Stop Loss');
    expect(validateOpen({ ...base, side: 'SHORT', stopPrice: 1970, takePrice: 1900 }).join()).toContain('acima da entrada');
    expect(validateOpen({ ...base, leverage: 5 }).join()).toContain('Alavancagem');
  });

  it('estatísticas e alerta de operação sem stop', () => {
    const t1 = { ...base, id: 'a', exitPrice: 2060, closedAt: 1 };
    const t2 = { ...base, id: 'b', exitPrice: 1970, closedAt: 2 };
    const t3 = { ...base, id: 'c', stopPrice: null };
    const s = journalStats([t1, t2, t3]);
    expect(s.closed).toBe(2);
    expect(s.open).toBe(1);
    expect(s.winRate).toBe(50);
    expect(s.withoutStop).toBe(1);
    expect(s.maxLoss!).toBeLessThan(0);
    expect(estimateFee(100, 3)).toBeCloseTo(0.15);
  });
});
