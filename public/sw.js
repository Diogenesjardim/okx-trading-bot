// Service worker mínimo: não faz cache nem push de servidor.
// Existe para permitir showNotification() (exigido no iOS para apps da Tela de Início).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) return c.focus();
      return self.clients.openWindow ? self.clients.openWindow('./#analista') : undefined;
    }),
  );
});
