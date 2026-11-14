export type InstId = 'BTC-USDT' | 'ETH-USDT';
export type Timeframe = '5m' | '15m' | '1H' | '4H';
export type Side = 'LONG' | 'SHORT';
export type Signal = 'LONG' | 'SHORT' | 'AGUARDAR';

export const INSTRUMENTS: { id: InstId; label: string }[] = [
  { id: 'BTC-USDT', label: 'BTC/USDT' },
  { id: 'ETH-USDT', label: 'ETH/USDT' },
];

export const TIMEFRAMES: { id: Timeframe; label: string; ms: number }[] = [
  { id: '5m', label: '5 min', ms: 5 * 60_000 },
  { id: '15m', label: '15 min', ms: 15 * 60_000 },
  { id: '1H', label: '1 hora', ms: 60 * 60_000 },
  { id: '4H', label: '4 horas', ms: 4 * 60 * 60_000 },
];

export const tfMs = (tf: Timeframe) => TIMEFRAMES.find((t) => t.id === tf)!.ms;
export const tfLabel = (tf: Timeframe) => TIMEFRAMES.find((t) => t.id === tf)!.label;
export const instLabel = (id: string) => id.replace('-', '/');
export const streamKey = (instId: InstId, tf: Timeframe) => `${instId}|${tf}`;

export interface Candle {
  ts: number; // abertura do candle (ms)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  confirmed: boolean; // true = candle fechado
}

export interface Ticker {
  instId: string;
  last: number;
  open24h: number;
  high24h: number;
  low24h: number;
  vol24h: number;
  ts: number;
}

export type ExitReason =
  | 'Stop Loss'
  | 'Take Profit'
  | 'Cruzamento oposto'
  | 'Encerramento manual'
  | 'Liquidação simulada'
  | 'Fim do período';

export interface Position {
  id: string;
  instId: InstId;
  timeframe: Timeframe;
  side: Side;
  entryTime: number;
  entryPrice: number;
  qty: number;
  margin: number;
  leverage: number;
  entryFee: number;
  stopPrice: number;
  takePrice: number;
  signalCandleTs: number;
  signalId?: string;
}

export interface Trade {
  id: string;
  instId: InstId;
  timeframe: Timeframe;
  side: Side;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  qty: number;
  margin: number;
  leverage: number;
  fees: number;
  grossPnl?: number; // resultado bruto (antes das taxas)
  pnl: number; // resultado líquido (após taxas)
  signalId?: string;
  pnlPctMargin: number;
  exitReason: ExitReason;
}

export interface StrategyConfig {
  leverage: 1 | 2 | 3;
  stopLossPct: number; // % do preço
  takeProfitPct: number; // % do preço
  positionSizePct: number; // % do saldo usado como margem
  feePct: number; // % por lado sobre o valor nocional
  slippagePct: number; // % por execução
  rsiFilter: boolean;
  /** Filtro de tendência: LONG só com preço acima da SMA longa; SHORT só abaixo. */
  trendFilter?: boolean;
  trendPeriod?: number; // padrão 200
  exitOnOppositeCross: boolean;
  /** Mercado à vista (spot): só compra (LONG), 1X. Sinal de venda serve apenas para SAIR. */
  longOnly?: boolean;
}

/** Configuração do Robô Simulador (o filtro RSI pertence ao Robô Analista). */
export interface SimConfig extends Omit<StrategyConfig, 'rsiFilter' | 'trendFilter' | 'trendPeriod'> {
  initialCapital: number;
  allowedInst: InstId[];
  allowedTf: Timeframe[];
  maxDailyLossPct: number; // % do capital inicial
  maxTradesPerDay: number;
}
