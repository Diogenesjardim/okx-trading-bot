import { useState } from 'react';
import type { Trade } from '../types';
import { fmtDateTime, fmtPrice, fmtSignedUSD, fmtUSD, pnlColor } from '../lib/format';
import { Empty, SideBadge } from './ui';

const PAGE = 20;

export function TradesTable({ trades, emptyText = 'Nenhuma operação registrada ainda.' }: { trades: Trade[]; emptyText?: string }) {
  const [limit, setLimit] = useState(PAGE);
  if (!trades.length) return <Empty>{emptyText}</Empty>;
  const rows = [...trades].sort((a, b) => b.exitTime - a.exitTime).slice(0, limit);
  return (
    <div>
      <div className="-mx-4 overflow-x-auto px-4">
        <table className="w-full min-w-[800px] text-left text-xs">
          <thead className="text-[11px] uppercase text-zinc-500">
            <tr className="border-b border-zinc-800">
              <th className="py-2 pr-2 font-medium">Data (saída)</th>
              <th className="pr-2 font-medium">Ativo</th>
              <th className="pr-2 font-medium">Tipo</th>
              <th className="pr-2 text-right font-medium">Entrada</th>
              <th className="pr-2 text-right font-medium">Saída</th>
              <th className="pr-2 font-medium">Motivo</th>
              <th className="pr-2 text-right font-medium">Bruto</th>
              <th className="pr-2 text-right font-medium">Taxas</th>
              <th className="text-right font-medium">Líquido</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map((t) => (
              <tr key={t.id + t.exitTime} className="border-b border-zinc-800/60">
                <td className="py-2 pr-2 text-zinc-400">{fmtDateTime(t.exitTime)}</td>
                <td className="pr-2 text-zinc-300">{t.instId.replace('-', '/')} <span className="text-zinc-600">{t.timeframe}</span></td>
                <td className="pr-2"><SideBadge side={t.side} /> <span className="text-zinc-600">{t.leverage}X</span></td>
                <td className="pr-2 text-right text-zinc-300">{fmtPrice(t.entryPrice)}</td>
                <td className="pr-2 text-right text-zinc-300">{fmtPrice(t.exitPrice)}</td>
                <td className="pr-2 text-zinc-400">{t.exitReason}</td>
                <td className={`pr-2 text-right ${pnlColor(t.grossPnl)}`}>{t.grossPnl == null ? '—' : fmtSignedUSD(t.grossPnl)}</td>
                <td className="pr-2 text-right text-zinc-500">{fmtUSD(t.fees)}</td>
                <td className={`text-right font-semibold ${pnlColor(t.pnl)}`}>{fmtSignedUSD(t.pnl)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-zinc-500">
        <span>{Math.min(limit, trades.length)} de {trades.length} operações · valores fictícios</span>
        {trades.length > limit && (
          <button className="rounded-lg bg-zinc-800 px-3 py-1 text-zinc-200" onClick={() => setLimit((l) => l + PAGE)}>
            Ver mais
          </button>
        )}
      </div>
    </div>
  );
}
