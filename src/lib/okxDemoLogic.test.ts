import { describe, expect, it } from 'vitest';
import { demoActions } from './okxDemo';
import type { Position } from '../types';
import { buildOrder, clOrdIdFrom, contractsFor, roundToTick, signOkx, validateOpenRequest } from '../../supabase/functions/okx-demo/logic';

describe('executor Demo OKX — lógica', () => {
  it('assinatura HMAC-SHA256 em Base64 (vetor conhecido)', async () => {
    const s = await signOkx('segredo-teste', '2026-11-14T01:00:00.000Z', 'get', '/api/v5/account/balance?ccy=USDT');
    expect(s).toBe('iw2NvzQIKzMeg0dApMtPVKI4PFSAWP8VMPMzbhcZ5oA=');
  });

  it('contratos: arredonda para baixo ao lote e respeita o mínimo', () => {
    // ETH-USDT-SWAP: ctVal 0.1 ETH, lote 0.01
    const r = contractsFor({ marginUsdt: 50, leverage: 2, price: 2000, ctVal: '0.1', lotSz: '0.01', minSz: '0.01' });
    expect(r).toEqual({ sz: '0.50', notional: 100 });
    const tiny = contractsFor({ marginUsdt: 0.5, leverage: 1, price: 98000, ctVal: '0.01', lotSz: '0.01', minSz: '0.01' });
    expect('error' in tiny && tiny.error).toContain('abaixo do mínimo');
  });

  it('preço arredondado ao tick', () => {
    expect(roundToTick(1928.6123, '0.01')).toBe('1928.61');
    expect(roundToTick(98123.46, '0.1')).toBe('98123.5');
  });

  it('clOrdId: alfanumérico, ≤ 32, determinístico', () => {
    const a = clOrdIdFrom('ETH-USDT|4H|1794600000000|LONG');
    expect(a).toMatch(/^[a-zA-Z0-9]{1,32}$/);
    expect(clOrdIdFrom('ETH-USDT|4H|1794600000000|LONG')).toBe(a);
    expect(clOrdIdFrom('ETH-USDT|4H|1794600000000|SHORT')).not.toBe(a);
  });

  it('validação: ativo, alavancagem ≤ 3, limite de margem, SL/TP obrigatórios', () => {
    const ok = { instId: 'ETH-USDT', side: 'LONG' as const, marginUsdt: 50, leverage: 1, stopPrice: 1900, takePrice: 2100, ref: 'x' };
    expect(validateOpenRequest(ok, 200)).toEqual([]);
    expect(validateOpenRequest({ ...ok, instId: 'SOL-USDT' }, 200).join()).toContain('não permitido');
    expect(validateOpenRequest({ ...ok, leverage: 5 }, 200).join()).toContain('Alavancagem');
    expect(validateOpenRequest({ ...ok, marginUsdt: 500 }, 200).join()).toContain('limite');
    expect(validateOpenRequest({ ...ok, stopPrice: 0 }, 200).join()).toContain('obrigatórios');
  });

  it('ordem a mercado com SL/TP anexados; posSide só no modo long/short', () => {
    const o = buildOrder({ swapId: 'ETH-USDT-SWAP', side: 'SHORT', sz: '0.50', stopPx: '2030', takePx: '1940', clOrdId: 'abc', posMode: 'net_mode' });
    expect(o).toMatchObject({ instId: 'ETH-USDT-SWAP', tdMode: 'isolated', side: 'sell', ordType: 'market', sz: '0.50' });
    expect((o.attachAlgoOrds as any[])[0]).toMatchObject({ slTriggerPx: '2030', slOrdPx: '-1', tpTriggerPx: '1940', tpOrdPx: '-1' });
    expect(o.posSide).toBeUndefined();
    expect(buildOrder({ swapId: 'x', side: 'LONG', sz: '1', stopPx: '1', takePx: '2', clOrdId: 'a', posMode: 'long_short_mode' }).posSide).toBe('long');
  });
});

describe('espelhamento simulador → Demo', () => {
  const pos = (id: string): Position => ({ id, instId: 'ETH-USDT', timeframe: '4H', side: 'LONG', entryTime: 0, entryPrice: 2000, qty: 0.05, margin: 100, leverage: 1, entryFee: 0, stopPrice: 1970, takePrice: 2060, signalCandleTs: 0, signalId: 's' + id });
  it('abre, fecha e troca (fecha antes de abrir); sem mudança = nada', () => {
    expect(demoActions(null, pos('a')).map((x) => x.type)).toEqual(['open']);
    expect(demoActions(pos('a'), null).map((x) => x.type)).toEqual(['close']);
    expect(demoActions(pos('a'), pos('b')).map((x) => x.type)).toEqual(['close', 'open']);
    expect(demoActions(pos('a'), pos('a'))).toEqual([]);
    expect(demoActions(null, null)).toEqual([]);
  });
});
