import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Proxy opcional: se o navegador bloquear a chamada direta à OKX (CORS),
// o app tenta /okx-api, que aqui é redirecionado para https://www.okx.com.
const okxProxy = {
  '/okx-api': {
    target: 'https://www.okx.com',
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/okx-api/, ''),
  },
};

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: { proxy: okxProxy },
  preview: { proxy: okxProxy },
});
