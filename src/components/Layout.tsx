import type { ReactNode } from 'react';
import { Bot, FlaskConical, Home, Radar, Settings, ShieldAlert } from 'lucide-react';
import type { AnalystStatus } from '../lib/analystEngine';
import { ANALYST_STATUS } from './status';

export type Route = 'inicio' | 'analista' | 'simulador' | 'backtest' | 'config';

export const ROUTES: { id: Route; label: string; icon: typeof Bot }[] = [
  { id: 'inicio', label: 'Início', icon: Home },
  { id: 'analista', label: 'Analista', icon: Radar },
  { id: 'simulador', label: 'Simulador', icon: Bot },
  { id: 'backtest', label: 'Backtest', icon: FlaskConical },
  { id: 'config', label: 'Config.', icon: Settings },
];

export function Layout({ route, onNavigate, analystStatus, simActive, children }: {
  route: Route; onNavigate: (r: Route) => void; analystStatus: AnalystStatus; simActive: boolean; children: ReactNode;
}) {
  const a = ANALYST_STATUS[analystStatus];
  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-2">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-500/15 text-emerald-400">
              <Bot className="h-5 w-5" />
            </div>
            <div className="text-sm font-bold leading-tight">OKX Trading Bot</div>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-semibold">
            <button onClick={() => onNavigate('analista')} className={`flex items-center gap-1 rounded-full px-2 py-1 ${a.cls}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${a.dot}`} /> Analista
            </button>
            <button onClick={() => onNavigate('simulador')} className={`flex items-center gap-1 rounded-full px-2 py-1 ${simActive ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-800 text-zinc-400'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${simActive ? 'animate-pulse bg-emerald-400' : 'bg-zinc-500'}`} /> Simulador
            </button>
          </div>
        </div>
        <div className="flex items-center justify-center gap-1.5 bg-amber-500 px-3 py-1 text-center text-[11px] font-bold tracking-wide text-zinc-950">
          <ShieldAlert className="h-3.5 w-3.5" /> MODO SIMULAÇÃO — NENHUMA ORDEM REAL
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 px-4 pb-28 pt-4">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="mx-auto grid max-w-5xl grid-cols-5">
          {ROUTES.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => onNavigate(id)} className={`flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${route === id ? 'text-emerald-400' : 'text-zinc-500'}`}>
              <Icon className="h-5 w-5" />
              {label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
