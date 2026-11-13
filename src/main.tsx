import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// Service worker mínimo: só para permitir notificações no iPhone (app na Tela de Início).
if ('serviceWorker' in navigator && import.meta.env.PROD && import.meta.env.VITE_SANDBOX_PREVIEW !== '1') {
  navigator.serviceWorker.register('./sw.js').catch(() => undefined);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
