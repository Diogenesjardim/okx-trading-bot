import { describe, expect, it } from 'vitest';
import { closePayload, demoActions, openPayload, DEFAULT_DEMO } from './okxDemo';
import type { Position } from '../types';
import { buildSpotBuy, clOrdIdFrom, floorToLot, levelsFromPct, roundToTick, sellQty, signOkx, spotInstId, validateSpotOpen } from '../../supabase/functions/okx-demo/logic';

describe('executor Demo OKX (à vista) — lógica', () => {
  it('assinatura HMAC-SHA256 em Base64 (vetor conhecido)', async () => {
    const s = await signOkx('segredo-teste', '2026-11-14T01:00:00.000Z', 'get', '/api/v5/account/balance?ccy=USDT');
    expect(s).toBe('iw2NvzQIKzMeg0dApMtPVKI4PFSAWP8VMPMzbhcZ5oA=');
  });

  it('par negociado: ETH-USDT analisado → ETH-BRL; bloqueia outros', () => {
    expect(spotInstId('ETH-USDT', 'BRL')).toBe('ETH-BRL');
    expect(spotInstId('BTC-USDT', 'USDT')).toBe('BTC-USDT');
    expect(spotInstId('SOL-USDT', 'BRL')).toBeNull();
    expect(spotInstId('ETH-USDT', 'EUR')).toBeNull();
  });

  it('SL/TP pelo preço do par negociado e arredondados ao tick', () => {
    const lv = levelsFromPct(10000, 1.5, 3);
    expect(lv.stop).toBeCloseTo(9850);
    expect(lv.take).toBeCloseTo(10300);
    expect(roundToTick(10299.996, '0.01')).toBe('10300.00');
  });

  it('compra a mercado em valor (BRL) com SL/TP anexados', () => {
    const o = buildSpotBuy({ instId: 'ETH-BRL', orderValue: 500, stopPx: '9850.00', takePx: '10300.00', clOrdId: 'abc' });
    expect(o).toMatchObject({ instId: 'ETH-BRL', tdMode: 'cash', side: 'buy', ordType: 'market', tgtCcy: 'quote_ccy', sz: '500.00' });
    expect(o.attachAlgoOrds[0]).toMatchObject({ slTriggerPx: '9850.00', slOrdPx: '-1', tpTriggerPx: '10300.00', tpOrdPx: '-1' });
  });

  it('venda: desconta a taxa cobrada na moeda, respeita saldo e lote; nada a vender se SL/TP já executou', () => {
    expect(sellQty({ accFillSz: '0.05', fee: '-0.00005', feeCcy: 'ETH', base: 'ETH', availBal: 1, lotSz: '0.0001', minSz: '0.0001' })).toBe('0.0499');
    expect(sellQty({ accFillSz: '0.05', fee: '-1', feeCcy: 'BRL', base: 'ETH', availBal: 0.03, lotSz: '0.0001', minSz: '0.0001' })).toBe('0.0300');
    expect(sellQty({ accFillSz: '0.05', fee: '-0.00005', feeCcy: 'ETH', base: 'ETH', availBal: 0, lotSz: '0.0001', minSz: '0.0001' })).toBeNull();
    expect(floorToLot(0.123456, '0.001')).toBeCloseTo(0.123);
  });

  it('validação: par, limite por moeda, SL/TP obrigatórios', () => {
    const ok = { instId: 'ETH-USDT', quote: 'BRL' as const, orderValue: 500, stopLossPct: 1.5, takeProfitPct: 3, ref: 'x' };
    const max = { BRL: 2000, USDT: 400 };
    expect(validateSpotOpen(ok, max)).toEqual([]);
    expect(validateSpotOpen({ ...ok, orderValue: 5000 }, max).join()).toContain('limite');
    expect(validateSpotOpen({ ...ok, instId: 'SOL-USDT' }, max).join()).toContain('não permitido');
    expect(validateSpotOpen({ ...ok, stopLossPct: 0 }, max).join()).toContain('Stop Loss');
  });

  it('clOrdId: alfanumérico, ≤ 32, determinístico (evita compra duplicada)', () => {
    const a = clOrdIdFrom('ETH-USDT|4H|1794600000000|LONG');
    expect(a).toMatch(/^[a-zA-Z0-9]{1,32}$/);
    expect(clOrdIdFrom('ETH-USDT|4H|1794600000000|LONG')).toBe(a);
    expect(clOrdIdFrom('ETH-USDT|4H|1794600000000|LONG|sell')).not.toBe(a);
  });
});

describe('espelhamento simulador → Demo', () => {
  const pos = (id: string): Position => ({ id, instId: 'ETH-USDT', timeframe: '4H', side: 'LONG', entryTime: 0, entryPrice: 2000, qty: 0.05, margin: 100, leverage: 1, entryFee: 0, stopPrice: 1970, takePrice: 2060, signalCandleTs: 0, signalId: 's' + id });
  it('abre, fecha e troca (fecha antes de abrir); sem mudança = nada', () => {
    expect(demoActions(null, pos('a')).map((x) => x.type)).toEqual(['open']);
    expect(demoActions(pos('a'), null).map((x) => x.type)).toEqual(['close']);
    expect(demoActions(pos('a'), pos('b')).map((x) => x.type)).toEqual(['close', 'open']);
    expect(demoActions(pos('a'), pos('a'))).toEqual([]);
  });
  it('payload: % de SL/TP derivados da posição; usa valor fixo em BRL', () => {
    const p = openPayload(pos('a'), DEFAULT_DEMO.config);
    expect(p).toMatchObject({ instId: 'ETH-USDT', quote: 'BRL', orderValue: 500, ref: 'sa' });
    expect(p.stopLossPct).toBeCloseTo(1.5);
    expect(p.takeProfitPct).toBeCloseTo(3);
    expect(closePayload(pos('a'), DEFAULT_DEMO.config)).toEqual({ instId: 'ETH-USDT', quote: 'BRL', ref: 'sa' });
  });
});

describe('functionUrl', () => {
  it('força a região de São Paulo só em URLs do Supabase', async () => {
    const { functionUrl } = await import('./okxDemo');
    expect(functionUrl(' https://abc.supabase.co/functions/v1/okx-demo ')).toBe('https://abc.supabase.co/functions/v1/okx-demo?forceFunctionRegion=sa-east-1');
    expect(functionUrl('https://abc.supabase.co/functions/v1/okx-demo?forceFunctionRegion=us-east-1')).toContain('us-east-1');
    expect(functionUrl('https://exemplo.com/x')).toBe('https://exemplo.com/x');
  });
});
