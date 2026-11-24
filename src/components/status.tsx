import type { ReactNode } from 'react';
import { CheckCircle2, CircleSlash, LogOut, XCircle } from 'lucide-react';
import type { Signal } from '../types';
import type { AnalystStatus, SignalDecision } from '../lib/analystEngine';
import type { SimPhase } from '../lib/simEngine';

const chip = 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold';

export const ANALYST_STATUS: Record<AnalystStatus, { label: string; cls: string; dot: string; desc: string }> = {
  ativo: { label: 'Monitoramento ativo', cls: 'bg-emerald-500/15 text-emerald-400', dot: 'bg-emerald-400 animate-pulse', desc: 'Consultando a OKX periodicamente.' },
  iniciando: { label: 'Conectando…', cls: 'bg-sky-500/15 text-sky-300', dot: 'bg-sky-300 animate-pulse', desc: 'Primeira consulta em andamento.' },
  pausado: { label: 'Analista pausado', cls: 'bg-zinc-800 text-zinc-400', dot: 'bg-zinc-500', desc: 'Nenhuma consulta sendo feita.' },
  erro: { label: 'Erro de conexão', cls: 'bg-rose-500/15 text-rose-400', dot: 'bg-rose-400', desc: 'A API da OKX não respondeu. Nova tentativa no próximo ciclo.' },
  interrompido: { label: 'Monitoramento interrompido', cls: 'bg-amber-500/15 text-amber-300', dot: 'bg-amber-300', desc: 'Sem consulta recente (site fechado, PC dormindo, iPhone bloqueado ou sem conexão). Volte ao site para retomar.' },
};

export function AnalystChip({ status }: { status: AnalystStatus }) {
  const s = ANALYST_STATUS[status];
  return <span className={`${chip} ${s.cls}`}><span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />{s.label}</span>;
}

export const SIM_PHASE: Record<SimPhase, { label: string; cls: string; desc: string }> = {
  AGUARDANDO_SINAL: { label: 'Simulação ativa', cls: 'bg-emerald-500/15 text-emerald-400', desc: 'Aguardando um novo sinal válido do Robô Analista.' },
  POSICAO_ABERTA: { label: 'Posição aberta', cls: 'bg-sky-500/15 text-sky-300', desc: 'Monitorando Stop Loss, Take Profit e cruzamento oposto.' },
  BLOQUEADO_LIMITE: { label: 'Bloqueado por limite', cls: 'bg-amber-500/15 text-amber-300', desc: 'Limite diário atingido. Novas entradas só amanhã.' },
  PAUSADO: { label: 'Simulador pausado', cls: 'bg-zinc-800 text-zinc-400', desc: 'Não abre novas posições.' },
  ENCERRADO: { label: 'Simulação encerrada', cls: 'bg-zinc-800 text-zinc-400', desc: 'Toque em Iniciar para retomar com o saldo atual.' },
};

export function SimChip({ phase, running }: { phase: SimPhase; running?: boolean }) {
  const s = SIM_PHASE[phase];
  const label = phase === 'POSICAO_ABERTA' && !running ? 'Posição aberta (pausado)' : s.label;
  return <span className={`${chip} ${s.cls}`}>{label}</span>;
}

export function SignalPill({ signal, size = 'md' }: { signal: Signal; size?: 'sm' | 'md' | 'lg' }) {
  const map = {
    LONG: { t: '🟢 POSSÍVEL LONG', c: 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/40' },
    SHORT: { t: '🔴 POSSÍVEL SHORT', c: 'bg-rose-500/15 text-rose-400 ring-rose-500/40' },
    AGUARDAR: { t: '🟡 AGUARDAR', c: 'bg-amber-500/10 text-amber-300 ring-amber-500/30' },
  }[signal];
  const sz = size === 'lg' ? 'px-4 py-2.5 text-base' : size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs';
  return <span className={`inline-block whitespace-nowrap rounded-lg font-bold ring-1 ${map.c} ${sz}`}>{map.t}</span>;
}

export function DecisionTag({ d }: { d: SignalDecision }) {
  const map: Record<SignalDecision['status'], { icon: ReactNode; cls: string }> = {
    aberta: { icon: <CheckCircle2 className="h-3.5 w-3.5" />, cls: 'text-emerald-400' },
    rejeitada: { icon: <XCircle className="h-3.5 w-3.5" />, cls: 'text-zinc-400' },
    saida: { icon: <LogOut className="h-3.5 w-3.5" />, cls: 'text-sky-300' },
  };
  const m = map[d.status];
  return (
    <span className={`flex items-start gap-1 text-[11px] ${m.cls}`}>
      <span className="mt-px shrink-0">{m.icon}</span>
      <span>{d.status === 'rejeitada' ? 'Simulador rejeitou: ' : 'Simulador: '}{d.reason}</span>
    </span>
  );
}

export function NoDecision() {
  return <span className="flex items-center gap-1 text-[11px] text-zinc-500"><CircleSlash className="h-3.5 w-3.5" />Sem decisão do simulador</span>;
}
