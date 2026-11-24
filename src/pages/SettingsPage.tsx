import { useState } from 'react';
import { CheckCircle2, Cloud, Database, Radar, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { INSTRUMENTS, TIMEFRAMES } from '../types';
import { useBots } from '../hooks/BotsContext';
import { downloadText } from '../lib/csv';
import { KEYS } from '../lib/storage';
import { DemoSettingsCard } from '../components/DemoPanel';
import { Card, ChipMulti, ConfirmButton, Segmented, Toggle } from '../components/ui';

const WORKING = [
  'Dados reais e públicos da OKX (preço e candles de BTC/USDT e ETH/USDT), sem API Key.',
  'Robô Analista: SMA9, SMA21, RSI14 e cruzamentos em 8 gráficos (2 ativos × 5m/15m/1h/4h), com histórico de sinais.',
  'Painel 🟢 POSSÍVEL LONG / 🔴 POSSÍVEL SHORT / 🟡 AGUARDAR com preço, horário, motivo e SL/TP sugeridos.',
  'Alerta sonoro e notificação do navegador (quando suportados), sem duplicar o mesmo sinal.',
  'Robô Simulador integrado: máquina de estados, 1 posição por vez, SL/TP, taxas, slippage, limites diários.',
  'Motivo de rejeição exibido para cada sinal não operado.',
  'Resultado bruto e líquido por operação, saldo, taxa de acerto, drawdown e gráficos.',
  'Backtest com histórico real da OKX e exportação CSV.',
  'Validação (Fase 3): treino × teste, otimização só no treino, janelas sucessivas, comparação com comprar e segurar e 300 simulações aleatórias, veredito objetivo e histórico de validações.',
  'Matriz BTC/ETH × 5m/15m/1h/4h com os mesmos parâmetros e histórico das últimas 5 execuções para comparar.',
  'Filtro de tendência (SMA50/100/200) no Analista, Backtest, Validação e Matriz.',
  'Diário de operações reais (registro manual, separado do fictício) com comparação real × simulador e CSV.',
  'Ordens automáticas na conta DEMO da OKX espelhando o simulador, com SL/TP na própria OKX (chaves guardadas no Supabase).',
  'Métricas: resultado bruto e líquido, maior sequência de perdas, média por operação.',
  'Configurações e históricos salvos no LocalStorage.',
];

const PENDING = [
  'Monitoramento 24h com o iPhone bloqueado ou o site fechado (exige backend — ver arquitetura abaixo).',
  'Notificações push vindas de servidor (hoje só disparam com o site aberto).',
  'Sincronização entre dispositivos (dados ficam apenas neste navegador).',
  'Gráfico de velas (candlestick); hoje o preço é exibido em linha.',
  'Estratégias além do cruzamento SMA9/SMA21 + filtro RSI.',
  'Ordens automáticas com dinheiro REAL (hoje só na conta Demo da OKX, por segurança).',
  'Robô rodando na nuvem: as entradas na Demo ainda dependem do app aberto (o SL/TP já fica na OKX).',
];

export function SettingsPage() {
  const { analyst, setAnalystConfig, wipeAll } = useBots();
  const cfg = analyst.config;
  const [copied, setCopied] = useState<string | null>(null);

  const backup = () => {
    const data: Record<string, unknown> = {};
    Object.values(KEYS).forEach((k) => {
      try {
        const v = localStorage.getItem(k);
        if (v) data[k] = JSON.parse(v);
      } catch { /* */ }
    });
    return JSON.stringify({ exportadoEm: new Date().toISOString(), data }, null, 2);
  };
  const onDownload = () => setCopied(downloadText('okx-bot-backup.json', backup(), 'application/json') ? 'Download iniciado.' : 'Download bloqueado. Use “Copiar”.');
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(backup());
      setCopied('Backup copiado.');
    } catch {
      setCopied('Não foi possível copiar.');
    }
  };

  return (
    <>
      <Card title="Robô Analista" icon={<Radar className="h-4 w-4 text-emerald-400" />}>
        <div className="space-y-3">
          <div>
            <span className="text-xs text-zinc-400">Ativos monitorados</span>
            <div className="mt-1"><ChipMulti options={INSTRUMENTS.map((i) => ({ id: i.id, label: i.label }))} value={cfg.instruments} onChange={(v) => setAnalystConfig({ ...cfg, instruments: v })} /></div>
          </div>
          <div>
            <span className="text-xs text-zinc-400">Tempos gráficos</span>
            <div className="mt-1"><ChipMulti options={TIMEFRAMES.map((t) => ({ id: t.id, label: t.label }))} value={cfg.timeframes} onChange={(v) => setAnalystConfig({ ...cfg, timeframes: v })} /></div>
          </div>
          <div>
            <span className="text-xs text-zinc-400">Atualização automática</span>
            <div className="mt-1">
              <Segmented options={[{ id: 15, label: '15 s' }, { id: 30, label: '30 s' }, { id: 60, label: '60 s' }]} value={cfg.intervalSec} onChange={(v) => setAnalystConfig({ ...cfg, intervalSec: v as 15 | 30 | 60 })} />
            </div>
          </div>
          <Toggle label="Filtro RSI" hint="Bloqueia LONG com RSI ≥ 70 e SHORT com RSI ≤ 30" checked={cfg.rsiFilter} onChange={(v) => setAnalystConfig({ ...cfg, rsiFilter: v })} />
          <Toggle label="Filtro de tendência" hint="LONG só com preço acima da média longa; SHORT só abaixo" checked={cfg.trendFilter} onChange={(v) => setAnalystConfig({ ...cfg, trendFilter: v })} />
          {cfg.trendFilter && (
            <Segmented options={[{ id: 50, label: 'SMA50' }, { id: 100, label: 'SMA100' }, { id: 200, label: 'SMA200' }]} value={cfg.trendPeriod} onChange={(v) => setAnalystConfig({ ...cfg, trendPeriod: v })} />
          )}
          <p className="text-[11px] text-zinc-500">Alertas sonoros e notificações ficam na aba Analista. Risco, alavancagem e limites ficam na aba Simulador.</p>
        </div>
      </Card>

      <DemoSettingsCard />

      <Card title="Armazenamento local" icon={<Database className="h-4 w-4 text-sky-400" />}>
        <p className="text-xs leading-relaxed text-zinc-400">
          Configurações, sinais e operações ficam <b className="text-zinc-200">apenas neste navegador</b> (LocalStorage). Podem ser perdidos ao limpar dados do Safari, usar aba privada ou trocar de aparelho. No iPhone, o Safari pode apagar dados de sites não usados por alguns dias. Faça backup quando quiser guardar.
        </p>
        <div className="mt-3 flex gap-2">
          <button onClick={onDownload} className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs">Baixar backup (JSON)</button>
          <button onClick={onCopy} className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs">Copiar backup</button>
        </div>
        {copied && <p className="mt-1.5 text-[11px] text-zinc-500">{copied}</p>}
        <div className="mt-3">
          <ConfirmButton label="Apagar todos os dados locais" icon={<Trash2 className="h-3.5 w-3.5" />} confirmText="Apagar configurações, sinais, simulação e backtest deste navegador?" onConfirm={wipeAll} className="text-xs text-rose-400" />
        </div>
      </Card>

      <Card title="Funcionando nesta versão" icon={<CheckCircle2 className="h-4 w-4 text-emerald-400" />}>
        <ul className="space-y-1.5 text-xs text-zinc-300">{WORKING.map((d) => <li key={d} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />{d}</li>)}</ul>
      </Card>
      <Card title="Ainda depende de implementação" icon={<XCircle className="h-4 w-4 text-rose-400" />}>
        <ul className="space-y-1.5 text-xs text-zinc-300">{PENDING.map((d) => <li key={d} className="flex gap-2"><XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />{d}</li>)}</ul>
      </Card>

      <Card title="Funcionamento e monitoramento 24h" icon={<Cloud className="h-4 w-4 text-sky-400" />}>
        <p className="text-xs leading-relaxed text-zinc-400">
          Os robôs rodam <b className="text-zinc-200">dentro do navegador</b>. No computador funcionam com a aba aberta, mesmo minimizada (desde que o PC não durma). Com o iPhone bloqueado, o app em segundo plano ou o Safari fechado, o iOS suspende o código e o monitoramento <b className="text-zinc-200">para</b>. Ao voltar, o sistema registra o intervalo interrompido e não cria sinais retroativos.
        </p>
        <p className="mt-3 text-xs font-semibold text-zinc-200">Arquitetura proposta para monitoramento contínuo:</p>
        <ol className="mt-1 list-decimal space-y-1 pl-4 text-xs leading-relaxed text-zinc-400">
          <li><b className="text-zinc-300">Worker na nuvem</b> (Node.js em Railway/Fly.io/Render, ou Cloudflare Workers + Cron) executando os mesmos módulos <code>analystEngine</code> e <code>simEngine</code> a cada 30 s.</li>
          <li><b className="text-zinc-300">Banco de dados</b> (Supabase/Postgres) com sinais, posições, operações e configurações — fonte única de verdade.</li>
          <li><b className="text-zinc-300">API</b> para o site ler o estado e alterar configurações (com login).</li>
          <li><b className="text-zinc-300">Web Push</b> (VAPID) ou Telegram para alertas com o celular bloqueado.</li>
          <li>Site vira só painel; a lógica já está isolada em funções puras e testadas, prontas para reaproveitar no backend.</li>
        </ol>
      </Card>

      <Card title="Segurança" icon={<ShieldCheck className="h-4 w-4 text-emerald-400" />}>
        <p className="text-xs leading-relaxed text-zinc-400">
          Exclusivamente simulação. Sem API Key privada, sem conexão com carteira, sem depósitos, saques ou envio de ordens à OKX. Só endpoints públicos de mercado são consultados.
        </p>
      </Card>
      <p className="pb-2 text-center text-[11px] text-zinc-600">Dados: OKX API v5 pública · Projeto de estudo, sem vínculo com a OKX.</p>
    </>
  );
}
