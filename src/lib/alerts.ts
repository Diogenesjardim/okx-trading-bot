/** Alertas sonoros (Web Audio) e notificações do navegador. Sem servidor de push. */

let ctx: AudioContext | null = null;

/** Precisa ser chamado dentro de um toque/clique (exigência do iOS). */
export function unlockAudio(): boolean {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return false;
    ctx = ctx ?? new AC();
    void ctx.resume();
    return true;
  } catch {
    return false;
  }
}

export function beep(kind: 'LONG' | 'SHORT') {
  if (!ctx) return;
  try {
    const notes = kind === 'LONG' ? [660, 880, 1100] : [880, 660, 440];
    notes.forEach((f, i) => {
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      o.connect(g);
      g.connect(ctx!.destination);
      const t = ctx!.currentTime + i * 0.16;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      o.start(t);
      o.stop(t + 0.15);
    });
  } catch {
    /* som indisponível */
  }
}

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

export type NotifySupport = 'concedido' | 'negado' | 'pendente' | 'nao-suportado';

export function notifySupport(): NotifySupport {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'nao-suportado';
  const p = Notification.permission;
  return p === 'granted' ? 'concedido' : p === 'denied' ? 'negado' : 'pendente';
}

export async function requestNotifyPermission(): Promise<NotifySupport> {
  if (!('Notification' in window)) return 'nao-suportado';
  try {
    await Notification.requestPermission();
  } catch {
    /* navegadores antigos */
  }
  return notifySupport();
}

export async function showNotification(title: string, body: string, tag: string) {
  if (notifySupport() !== 'concedido') return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(title, { body, tag, icon: 'icon-192.png', badge: 'icon-192.png' });
      return;
    }
    new Notification(title, { body, tag });
  } catch {
    /* notificação indisponível */
  }
}
