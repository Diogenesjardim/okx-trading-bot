import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { Candle, Trade } from '../types';
import { sma } from '../lib/indicators';
import { fmtNum, fmtPrice, fmtShort, fmtUSD } from '../lib/format';

const GREEN = '#34d399';
const RED = '#fb7185';
const AXIS = { fontSize: 10, fill: '#71717a' };
const tooltipStyle = {
  contentStyle: { background: '#18181b', border: '1px solid #3f3f46', borderRadius: 12, fontSize: 12 },
  labelStyle: { color: '#a1a1aa' },
};

/** Preço de fechamento + SMA9 + SMA21 (indicadores calculados sobre todo o histórico carregado). */
export function PriceChart({ candles, show = 120 }: { candles: Candle[]; show?: number }) {
  const closes = candles.map((c) => c.close);
  const s9 = sma(closes, 9);
  const s21 = sma(closes, 21);
  const data = candles
    .map((c, i) => ({ ts: c.ts, close: c.close, sma9: s9[i], sma21: s21[i], open: !c.confirmed }))
    .slice(-show);
  const min = Math.min(...data.map((d) => d.close));
  const max = Math.max(...data.map((d) => d.close));
  const pad = (max - min) * 0.08 || max * 0.01;
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 5, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#27272a" vertical={false} />
          <XAxis dataKey="ts" tickFormatter={(v) => fmtShort(v).slice(-5)} tick={AXIS} minTickGap={40} />
          <YAxis domain={[min - pad, max + pad]} tickFormatter={(v) => fmtNum(v, 0)} tick={AXIS} width={52} orientation="right" />
          <Tooltip
            {...tooltipStyle}
            labelFormatter={(v) => fmtShort(Number(v))}
            formatter={(v, name) => [fmtPrice(Number(v)), name === 'close' ? 'Fechamento' : String(name).toUpperCase()]}
          />
          <Area type="monotone" dataKey="close" stroke="#e4e4e7" fill="#e4e4e7" fillOpacity={0.05} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="sma9" stroke="#fbbf24" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
          <Line type="monotone" dataKey="sma21" stroke="#60a5fa" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function EquityChart({ curve, initial }: { curve: { label: string; equity: number }[]; initial: number }) {
  const up = (curve[curve.length - 1]?.equity ?? initial) >= initial;
  const color = up ? GREEN : RED;
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer>
        <AreaChart data={curve} margin={{ top: 5, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#27272a" vertical={false} />
          <XAxis dataKey="label" tick={AXIS} minTickGap={20} />
          <YAxis tick={AXIS} width={52} orientation="right" tickFormatter={(v) => fmtNum(v, Math.abs(v) >= 1000 ? 0 : 1)} domain={['auto', 'auto']} />
          <ReferenceLine y={initial} stroke="#52525b" strokeDasharray="4 4" />
          <Tooltip {...tooltipStyle} formatter={(v) => [fmtUSD(Number(v)), 'Saldo fictício']} />
          <Area type="monotone" dataKey="equity" stroke={color} fill="url(#eq)" strokeWidth={2} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PnlBars({ trades }: { trades: Trade[] }) {
  const data = trades.map((t, i) => ({ label: `#${i + 1}`, pnl: t.pnl }));
  return (
    <div className="h-44 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 5, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#27272a" vertical={false} />
          <XAxis dataKey="label" tick={AXIS} minTickGap={16} />
          <YAxis tick={AXIS} width={52} orientation="right" tickFormatter={(v) => fmtNum(v, 1)} />
          <ReferenceLine y={0} stroke="#52525b" />
          <Tooltip {...tooltipStyle} cursor={{ fill: '#27272a' }} formatter={(v) => [fmtUSD(Number(v)), 'Resultado']} />
          <Bar dataKey="pnl" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {data.map((d, i) => <Cell key={i} fill={d.pnl >= 0 ? GREEN : RED} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function WinLossPie({ wins, losses }: { wins: number; losses: number }) {
  const data = [
    { name: 'Vencedoras', value: wins, color: GREEN },
    { name: 'Perdedoras', value: losses, color: RED },
  ];
  const total = wins + losses;
  return (
    <div className="flex items-center gap-4">
      <div className="h-32 w-32 shrink-0">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius={36} outerRadius={56} stroke="none" isAnimationActive={false}>
              {data.map((d) => <Cell key={d.name} fill={d.color} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="space-y-2 text-sm">
        {data.map((d) => (
          <li key={d.name} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
            <span className="text-zinc-300">{d.name}</span>
            <span className="font-semibold tabular-nums text-zinc-100">{d.value}</span>
            <span className="text-xs text-zinc-500">({total ? Math.round((d.value / total) * 100) : 0}%)</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RsiBar({ value }: { value: number | null }) {
  if (value == null) return <p className="text-sm text-zinc-500">Dados insuficientes.</p>;
  const zone = value >= 70 ? 'Sobrecomprado' : value <= 30 ? 'Sobrevendido' : 'Neutro';
  const color = value >= 70 ? 'text-rose-400' : value <= 30 ? 'text-emerald-400' : 'text-zinc-200';
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className={`text-xl font-bold tabular-nums ${color}`}>RSI {fmtNum(value, 1)}</span>
        <span className={`text-xs ${color}`}>{zone}</span>
      </div>
      <div className="relative mt-2 h-2 rounded-full bg-gradient-to-r from-emerald-600 via-zinc-600 to-rose-600">
        <div className="absolute -top-1 h-4 w-1 rounded bg-white shadow" style={{ left: `calc(${Math.min(100, Math.max(0, value))}% - 2px)` }} />
        <span className="absolute top-3 text-[9px] text-zinc-500" style={{ left: '30%' }}>30</span>
        <span className="absolute top-3 text-[9px] text-zinc-500" style={{ left: '70%' }}>70</span>
      </div>
      <div className="h-3" />
    </div>
  );
}
