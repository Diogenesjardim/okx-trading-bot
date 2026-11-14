# OKX Trading Bot Dashboard

Dashboard de **estudo e simulação** de estratégias de trading (BTC/USDT e ETH/USDT) com dados públicos reais da OKX.

> ⚠️ **MODO SIMULAÇÃO — NENHUMA ORDEM REAL.** O app não pede API Key, senha ou credenciais, e não envia ordens.

## Stack
React 19 + TypeScript + Vite · Tailwind CSS v4 · Recharts · Lucide React · LocalStorage · Vitest

## Módulos
| Aba | O que faz |
|---|---|
| **Início** | Status dos dois robôs, último sinal, posição aberta, resultado do dia, saldo, gráficos, histórico de alertas e de operações |
| **Robô Analista** | Monitora BTC/USDT e ETH/USDT em 5m/15m/1h/4h (8 gráficos), SMA9/SMA21/RSI14, painel 🟢 POSSÍVEL LONG / 🔴 POSSÍVEL SHORT / 🟡 AGUARDAR, SL/TP sugeridos, histórico de sinais, alertas sonoros e notificações sem duplicar |
| **Robô Simulador** | Recebe os sinais do Analista e opera com dinheiro fictício (máquina de estados, 1 posição, SL/TP, taxas, slippage, limites diários), mostra o motivo de cada rejeição, resultado bruto e líquido |
| **Backtest** | 3 sub-abas: **Backtest** (histórico real, sem look-ahead, CSV) · **Validação** (Fase 3) · **Matriz** (8 mercados) |
| **Config.** | Ativos/tempos/intervalo/filtro RSI do Analista, backup e limpeza do armazenamento local, o que funciona e o que falta, arquitetura 24h |

### Fluxo de integração (a cada ciclo de 15/30/60 s)
1. Orquestrador (`src/hooks/BotsContext.tsx`) consulta a OKX (tickers + candles).
2. Simulador atualiza preços e verifica SL/TP (`simEngine.onPrice`).
3. Analista processa cada candle **fechado** uma única vez (`analystEngine.analyzeStream`).
4. Sinal novo → histórico → `simEngine.onSignal` aplica regras de risco → abre posição ou registra o motivo da rejeição.
5. Alertas (som/notificação) disparam uma única vez por sinal.

### Máquina de estados do Simulador
`PAUSADO ⇄ ATIVO → ENCERRADO → (Iniciar) ATIVO`; fases exibidas: aguardando sinal, posição aberta, bloqueado por limite, pausado, encerrado.
Garantias (testadas): 1 posição por vez · cada sinal avaliado uma vez (`processedSignalIds`) · cada candle processado uma vez (`lastProcessed`) · sinal anterior ao início ou com mais de 1 período de atraso é rejeitado · SL/TP seguem monitorados mesmo pausado.

## Filtros da estratégia
- **RSI:** não compra com RSI ≥ 70 nem vende com RSI ≤ 30.
- **Tendência (SMA50/100/200):** LONG só com fechamento acima da média longa; SHORT só abaixo. Sem dados suficientes para a média → não opera (conservador).
- **Saída no cruzamento oposto:** pode ser desligada para sair só por SL/TP.
Disponíveis no Backtest, Validação e Matriz (comparar execuções salvas) e no Robô Analista (Config.).

## Validação de estratégia (Fase 3) — `src/lib/validation.ts`
- **Treino × teste:** divide o histórico (60/70/80%). O teste usa dados que não serviram para escolher nada.
- **Otimização só no treino:** 16 combinações de SL/TP; a melhor é aplicada no teste (detecta sobreajuste).
- **Janelas sucessivas:** 4–6 períodos com os mesmos parâmetros (consistência).
- **Referências:** comprar e segurar (1X) e 300 simulações de entradas aleatórias com mesma frequência, SL/TP, alavancagem e custos (PRNG com semente → reprodutível).
- **Veredito objetivo:** Evidência insuficiente / fraca / promissora — regras: ≥ 30 operações, líquido > 0, teste > 0, ≥ 60% das janelas positivas, supera ≥ 90% das aleatórias, supera comprar e segurar.
- **Histórico de validações** salvo localmente para comparar parâmetros.
- **Matriz:** os 8 mercados de uma vez (atenção: muitos testes aumentam a chance de um parecer bom por sorte).
- Limitação: o histórico público da OKX tem profundidade limitada; 3.000 candles de 15 min ≈ 1 mês.

## Modo à vista (OKX Brasil)
A conta brasileira da OKX só permite mercado **à vista (spot)**: sem futuros, sem SHORT, sem alavancagem (restrição da CVM a derivativos para brasileiros). Por isso o padrão agora é **Somente LONG**: sinal de compra abre, sinal de venda só **encerra** a compra. Disponível no Simulador, Backtest, Validação e Matriz.

## Ordens automáticas na conta DEMO da OKX — `supabase/functions/okx-demo`
> Atualizado para o **Trading simulado à vista**: compra a mercado de ETH-BRL / BTC-BRL (ou pares USDT) com SL/TP anexados; saída = cancela SL/TP pendentes e vende o que a compra rendeu. Idempotente por sinal (clOrdId). Limites: 2000 BRL / 400 USDT por ordem.

O Robô Simulador pode **espelhar cada posição** como ordem real na **conta Demo** da OKX (dinheiro fictício da OKX), com Stop Loss e Take Profit anexados à ordem — executados pela própria OKX, mesmo com o celular bloqueado.

**Segurança**
- Toda chamada usa o cabeçalho `x-simulated-trading: 1` (ambiente Demo). Chaves da conta real não funcionam nele.
- Chaves da OKX ficam só nos **Secrets do Supabase**. O site guarda apenas a URL da função e um token (BOT_TOKEN).
- Travas: só BTC/ETH-USDT-SWAP, alavancagem ≤ 3X, margem ≤ 200 USDT (`MAX_MARGIN_USDT`), 1 posição por ativo, SL/TP obrigatórios e coerentes com o preço.
- Sem saques, transferências ou outros endpoints.

**Configuração (dá para fazer pelo iPhone)**
1. **Supabase:** crie um projeto gratuito. Anote o *Project ref* (código na URL do projeto).
2. **Supabase → Account → Access Tokens:** gere um token.
3. **GitHub → Settings → Secrets and variables → Actions:** Secret `SUPABASE_ACCESS_TOKEN` e Variable `SUPABASE_PROJECT_REF`. Rode o workflow *Publicar funções no Supabase*.
4. **OKX → Negociação demo → API:** crie uma chave **Demo** com permissão *Ler* + *Negociar* (sem saque). Guarde key, secret e passphrase.
5. **Supabase → Edge Functions → Secrets:** `OKX_DEMO_API_KEY`, `OKX_DEMO_SECRET`, `OKX_DEMO_PASSPHRASE`, `BOT_TOKEN` (uma senha sua, mín. 8 caracteres).
6. **App → Config. → Ordens automáticas (conta Demo):** URL `https://<ref>.supabase.co/functions/v1/okx-demo` + o mesmo token → *Testar conexão* → *Preparar conta Demo* (se aparecer) → ligar *Espelhar*.

**Limitações:** as entradas dependem do app aberto (o robô ainda roda no navegador); SL/TP depois de enviados ficam na OKX. Posições abertas antes de ligar o espelhamento não são enviadas.

## Funcionamento real (importante)
Os robôs rodam no navegador: **só funcionam com o site aberto e em primeiro plano**. Com o iPhone bloqueado ou o Safari em segundo plano, o iOS suspende o código. Ao voltar, o intervalo interrompido é registrado e nenhum sinal retroativo é criado.
Para 24h: worker na nuvem (Node/Cloudflare Cron) rodando `analystEngine` + `simEngine`, banco (Supabase), API com login e Web Push/Telegram. Os motores já são funções puras, prontas para reaproveitar.

### Notificações no iPhone
Só funcionam com o site instalado: Safari → Compartilhar → **Adicionar à Tela de Início** → abrir pelo ícone → ativar em *Robô Analista › Alertas* (iOS 16.4+). Disparam apenas com o app aberto (não há push de servidor).

## Rodar localmente
```bash
npm install
npm run dev        # http://localhost:5173 (abre na rede local com --host → acesse pelo iPhone no mesmo Wi-Fi)
npm test           # testes do motor (indicadores, backtest, robô, métricas)
npm run build      # gera /dist
```
Requer Node 20+.

## Publicar no GitHub Pages (com deploy automático)
1. Crie um repositório vazio no GitHub (ex.: `okx-trading-bot`) e envie o código para a branch `main`.
2. No repositório: **Settings → Pages → Source: GitHub Actions**.
3. A cada push, `.github/workflows/deploy.yml` roda os testes, faz o build e publica em `https://<usuario>.github.io/okx-trading-bot/`.

### Se o navegador bloquear a OKX (CORS) — proxy no Supabase
O GitHub Pages não tem servidor. Se aparecer “Não foi possível conectar à API pública da OKX”, use a Edge Function incluída:
```bash
npm i -g supabase
supabase login
supabase link --project-ref <SEU_REF>
supabase functions deploy okx-proxy --no-verify-jwt
```
Depois, no GitHub: **Settings → Secrets and variables → Actions → Variables → New**: `OKX_PROXY_URL` = `https://<SEU_REF>.supabase.co/functions/v1/okx-proxy` e rode o workflow de novo.
O proxy só aceita GET em 3 endpoints públicos de mercado (ticker, candles, history-candles) — não aceita chaves nem envia ordens.

## Publicar na Vercel (alternativa)
1. Suba a pasta para um repositório no GitHub.
2. Em vercel.com → *Add New Project* → importe o repositório (framework: Vite). Build: `npm run build`, output: `dist`.
3. Pronto. O `vercel.json` já cria o proxy `/okx-api` → `https://www.okx.com`.

**Netlify:** funciona igual (o arquivo `public/_redirects` cria o mesmo proxy).
**GitHub Pages / hospedagem estática:** funciona se o navegador permitir a chamada direta à OKX (CORS). Se aparecer erro de conexão, use Vercel/Netlify.

### Como a conexão com a OKX funciona
`src/lib/okx.ts` tenta primeiro `https://www.okx.com` direto; se o navegador bloquear (CORS/rede), tenta o proxy relativo `./okx-api`. Endpoints usados (públicos, sem chave):
- `GET /api/v5/market/ticker`
- `GET /api/v5/market/candles` (até 300 recentes)
- `GET /api/v5/market/history-candles` (paginação para o backtest)

## Estrutura
```
src/
  lib/okx.ts            cliente da API pública, tratamento de erro e fallback de proxy
  lib/indicators.ts     SMA, RSI (Wilder), cruzamentos
  lib/strategy.ts       sinal SMA9/SMA21 (+ filtro RSI opcional), só candles fechados
  lib/tradeMath.ts      abertura/fechamento, taxas, slippage, alavancagem
  lib/analystEngine.ts  Robô Analista (sinais por candle fechado, SL/TP sugeridos, status)
  lib/simEngine.ts      Robô Simulador — máquina de estados (eventos start/pause/end/onPrice/onSignal)
  lib/alerts.ts         alerta sonoro (Web Audio) e notificações
  lib/*.test.ts         testes: indicadores, backtest, analista, simulador, métricas
  lib/backtest.ts       backtest sem look-ahead, entrada na abertura seguinte, SL prioritário
  lib/metrics.ts        saldo, taxa de acerto, maior perda, drawdown, curva de capital
  lib/csv.ts            exportação CSV (; e vírgula decimal — abre no Excel pt-BR)
  hooks/BotsContext.tsx orquestrador que integra os dois robôs
  components/, pages/   UI (Início, Analista, Simulador, Backtest, Config.)
```

## Regras implementadas
- **Sinal:** LONG quando a SMA9 cruza acima da SMA21 no fechamento; SHORT no cruzamento para baixo; caso contrário AGUARDAR. Estar acima/abaixo não gera entrada.
- **Simulador:** SL executa ao preço atual (pode ser pior que o stop, como num gap); TP executa no preço-alvo (conservador); saída opcional no cruzamento oposto do mesmo gráfico; perda máxima limitada à margem (liquidação simulada).
- **Backtest:** indicadores só com dados até o candle; entrada na abertura do candle seguinte; SL/TP pela máxima/mínima; SL e TP no mesmo candle → SL; gap além do stop → executa na abertura; taxas e slippage nas duas pontas.

## Limitações (desta versão)
- Robôs rodam no navegador: só funcionam com o site aberto. Ao reabrir, não “recuperam” sinais perdidos.
- SL/TP verificados pelo preço a cada ciclo (não intrabar).
- Dados ficam no LocalStorage deste navegador (sem sincronização).
- Sem funding rate, livro de ofertas, latência ou regras reais de liquidação.
- Gráfico de preço em linha (fechamento), não em velas.
- Resultados são fictícios e **não** garantem resultados futuros.
