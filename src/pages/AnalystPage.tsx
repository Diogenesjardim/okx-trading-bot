import { useState } from 'react';
import { Bell, BellOff, CandlestickChart, ListChecks, Pause, Play, Radar, RefreshCw, Trash2, Volume2, VolumeX } from 'lucide-react';
import { INSTRUMENTS, TIMEFRAMES, instLabel, streamKey, tfLabel, type InstId, type Timeframe } from '../types';
import { useBots } from '../hooks/BotsContext';
import { fmtDateTime, fmtPrice, fmtTime } from '../lib/format';
import { beep, isIOS, isStandalone, notifySupport, requestNotifyPermission, unlockAudio, type NotifySupport } from '../lib/alerts';
import { Card, ConfirmButton, ErrorBox, Notice, Segmented, Toggle } from '../components/ui';
import { PriceChart, RsiBar } from '../components/Charts';
import { SignalHistory } from '../components/SignalHistory';
import { ANALYST_STATUS, AnalystChip, SignalPill } from '../components/status';

export function AnalystPage() {
  const { analyst, candles, status, polling, pollNow, setAnalystEnabled, setAnalystConfig, clearSignals, visible } = useBots();
  const cfg = analyst.config;
  const streams = cfg.instruments.flatMap((i) => cfg.timeframes.map((tf) => ({ instId: i, tf, key: streamKey(i, tf) })));
  const [selected, setSelected] = useState<string>(streams.find((x) => x.key === 'ETH-USDT|15m')?.key ?? streams[0]?.key ?? '');
  const [notif, setNotif] = useState<NotifySupport>(notifySupport());
  const sel = analyst.snapshots[selected];
  const [selInst, selTf] = (selected || streamKey(cfg.instruments[0], cfg.timeframes[0])).split('|') as [InstId, Timeframe];
  const selCandles = candles[selected];

  const toggleSound = (v: boolean) => {
    if (v) {
      unlockAudio();
      beep('LONG');
    }
    setAnalystConfig({ ...cfg, sound: v });
  };
  const toggleNotify = async (v: boolean) => {
    if (v) {
      const r = await requestNotifyPermission();
      setNotif(r);
      if (r !== 'concedido') return;
    }
    setAnalystConfig({ ...cfg, notifications: v });
  };

  return (
    <>
      <Card title="Robô Analista" icon={<Radar className="h-4 w-4 text-emerald-400" />}>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5">
            <AnalystChip status={status} />
            <p className="text-[11px] text-zinc-500">{ANALYST_STATUS[status].desc}</p>
            <p className="text-[11px] text-zinc-500">
              {streams.length} gráficos · a cada {cfg.intervalSec}s · última consulta {analyst.lastSuccessAt ? fmtTime(analyst.lastSuccessAt) : '—'}
            </p>
          </div>
          {analyst.enabled ? (
            <button onClick={() => setAnalystEnabled(false)} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-zinc-800 px-4 py-2.5 text-sm font-semibold">
              <Pause className="h-4 w-4" /> Pausar
            </button>
          ) : (
            <button onClick={() => setAnalystEnabled(true)} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white">
              <Play className="h-4 w-4" /> Ativar
            </button>
          )}
        </div>
        {analyst.enabled && (
          <button onClick={pollNow} disabled={polling} className="mt-3 inline-flex items-center gap-1.5 text-xs text-zinc-400 disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${polling ? 'animate-spin' : ''}`} /> Atualizar agora
          </button>
        )}
        {analyst.enabled && analyst.lastError && <div className="mt-3"><ErrorBox message={analyst.lastError} onRetry={pollNow} /></div>}
        {!visible && analyst.enabled && <div className="mt-3"><Notice tone="warn">Site em segundo plano: o navegador suspende as consultas.</Notice></div>}
        <div className="mt-3">
          <Notice>Só analisa. Nunca abre posições — isso é papel do Robô Simulador. Funciona enquanto o site estiver aberto e em primeiro plano.</Notice>
        </div>
      </Card>

      <Card title="Gráfico de preço" icon={<CandlestickChart className="h-4 w-4 text-emerald-400" />}>
        <div className="space-y-2">
          <Segmented options={INSTRUMENTS.filter((i) => cfg.instruments.includes(i.id)).map((i) => ({ id: i.id, label: i.label }))} value={selInst} onChange={(v) => setSelected(streamKey(v, selTf))} />
          <Segmented options={TIMEFRAMES.filter((t) => cfg.timeframes.includes(t.id)).map((t) => ({ id: t.id, label: t.label }))} value={selTf} onChange={(v) => setSelected(streamKey(selInst, v))} />
        </div>
        <div className="mt-3">
          {selCandles ? (
            <>
              <div className="mb-2 flex items-center justify-between text-[11px]">
                <span className="font-semibold text-zinc-200">{fmtPrice(selCandles[selCandles.length - 1]?.close)}</span>
                <span className="flex gap-3">
                  <span className="flex items-center gap-1"><i className="h-0.5 w-3 bg-zinc-200" />Preço</span>
                  <span className="flex items-center gap-1"><i className="h-0.5 w-3 bg-amber-400" />SMA9</span>
                  <span className="flex items-center gap-1"><i className="h-0.5 w-3 bg-sky-400" />SMA21</span>
                </span>
              </div>
              <PriceChart candles={selCandles} show={80} />
              {sel && <div className="mt-3"><RsiBar value={sel.rsi} /></div>}
            </>
          ) : !analyst.enabled ? (
            <div className="grid h-48 place-items-center rounded-xl border border-dashed border-zinc-800 px-6 text-center">
              <div>
                <p className="text-xs text-zinc-500">O gráfico usa os dados que o Robô Analista baixa da OKX.</p>
                <button onClick={() => setAnalystEnabled(true)} className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white">
                  <Play className="h-4 w-4" /> Ativar e carregar gráfico
                </button>
              </div>
            </div>
          ) : analyst.lastError || analyst.streamErrors[selected] ? (
            <ErrorBox message={analyst.streamErrors[selected] || analyst.lastError!} onRetry={pollNow} />
          ) : (
            <div className="grid h-48 place-items-center rounded-xl bg-zinc-800/30 text-xs text-zinc-500 animate-pulse">Carregando candles da OKX…</div>
          )}
        </div>
      </Card>

      <Card title="Alertas" icon={<Bell className="h-4 w-4 text-amber-400" />}>
        <div className="space-y-3">
          <Toggle label="Alerta sonoro" hint="Toca um bipe a cada novo sinal (som do iPhone precisa estar ligado)" checked={cfg.sound} onChange={toggleSound} />
          <Toggle
            label="Notificações do navegador"
            hint={
              notif === 'nao-suportado'
                ? isIOS() && !isStandalone()
                  ? 'No iPhone: Compartilhar → “Adicionar à Tela de Início”, abra pelo ícone e ative aqui (iOS 16.4+).'
                  : 'Não suportado neste navegador.'
                : notif === 'negado'
                  ? 'Permissão negada. Libere nas configurações do navegador.'
                  : 'Mostra um aviso quando surgir um sinal (com o site aberto).'
            }
            checked={cfg.notifications && notif === 'concedido'}
            onChange={toggleNotify}
            disabled={notif === 'nao-suportado' || notif === 'negado'}
          />
          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            {cfg.sound ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
            {cfg.notifications && notif === 'concedido' ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
            Cada sinal alerta uma única vez.
          </div>
        </div>
      </Card>

      <Card title="Painel de sinais (candles fechados)" icon={<CandlestickChart className="h-4 w-4 text-sky-400" />}>
        {!analyst.enabled && !Object.keys(analyst.snapshots).length ? (
          <p className="text-sm text-zinc-500">Ative o robô para analisar os gráficos.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {streams.map(({ key, instId, tf }) => {
              const s = analyst.snapshots[key];
              const err = analyst.streamErrors[key];
              return (
                <button key={key} onClick={() => setSelected(key)} className={`rounded-xl bg-zinc-950/60 p-3 text-left ring-1 ${selected === key ? 'ring-emerald-600' : 'ring-zinc-800'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{instLabel(instId)} <span className="text-zinc-500">· {tfLabel(tf)}</span></span>
                    <SignalPill signal={s?.signal ?? 'AGUARDAR'} size="sm" />
                  </div>
                  {s ? (
                    <>
                      <div className="mt-1 text-[11px] tabular-nums text-zinc-400">
                        Fechamento {fmtPrice(s.close)} · {fmtDateTime(s.closeTime)}
                      </div>
                      <p className="mt-1 text-[11px] leading-snug text-zinc-500">{s.reason}</p>
                      {s.suggestedStop != null && (
                        <div className="mt-1.5 flex gap-3 text-[11px] tabular-nums">
                          <span className="text-rose-400">SL sug. {fmtPrice(s.suggestedStop)}</span>
                          <span className="text-emerald-400">TP sug. {fmtPrice(s.suggestedTake)}</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="mt-1 text-[11px] text-zinc-600">{err ? `Erro: ${err}` : 'Aguardando dados…'}</p>
                  )}
                </button>
              );
            })}
          </div>
        )}
        <p className="mt-2 text-[11px] text-zinc-500">SL/TP sugeridos = cálculo matemático com os % do Robô Simulador. Não é recomendação.</p>
      </Card>

      <Card
        title={`Histórico de sinais (${analyst.signals.length})`}
        icon={<ListChecks className="h-4 w-4 text-zinc-400" />}
      >
        <SignalHistory signals={analyst.signals} />
        {analyst.signals.length > 0 && (
          <div className="mt-3">
            <ConfirmButton label="Limpar histórico de sinais" confirmText="Apagar todos os sinais registrados?" onConfirm={clearSignals} icon={<Trash2 className="h-3.5 w-3.5" />} className="w-full text-xs text-zinc-500" />
          </div>
        )}
      </Card>

      <Card title="Registro de conexão" icon={<RefreshCw className="h-4 w-4 text-zinc-400" />}>
        {analyst.log.length ? (
          <ul className="max-h-56 space-y-1.5 overflow-y-auto text-xs">
            {analyst.log.map((l, i) => (
              <li key={i} className="flex gap-2">
                <span className="shrink-0 tabular-nums text-zinc-600">{fmtDateTime(l.ts)}</span>
                <span className={l.type === 'erro' ? 'text-rose-400' : l.type === 'ok' ? 'text-emerald-400' : l.type === 'alerta' ? 'text-amber-300' : 'text-zinc-400'}>{l.msg}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-500">Sem eventos.</p>
        )}
      </Card>

      <Notice tone="warn">Sinais experimentais, baseados em médias móveis e RSI. <b>Não representam recomendação garantida</b> de compra ou venda e não garantem lucro.</Notice>
    </>
  );
}
