-- Robô na nuvem (Fase 4) — rodar UMA vez no Supabase: SQL Editor → New query → colar → Run.
-- Troque COLE_AQUI_SEU_BOT_TOKEN pelo mesmo valor do secret BOT_TOKEN (mantenha as aspas simples).

-- 1) Tabela onde o robô guarda o estado (RLS ligado e sem políticas: só a função acessa)
create table if not exists public.bot_state (
  id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.bot_state enable row level security;

-- 2) Agendador: chama a função bot-cycle a cada minuto
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('robo-nuvem') where exists (select 1 from cron.job where jobname = 'robo-nuvem');
select cron.schedule(
  'robo-nuvem',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://puwrgxthizmydhzvdpvh.supabase.co/functions/v1/bot-cycle?forceFunctionRegion=sa-east-1',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-bot-token', 'COLE_AQUI_SEU_BOT_TOKEN'),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

-- Para parar o robô na nuvem:  select cron.unschedule('robo-nuvem');
