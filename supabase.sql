-- Rode isto uma vez no Supabase: SQL Editor > New query > cole > Run.
-- Cria a tabela onde a mesa guarda contas, salas e fichas.
create table if not exists public.colisao_kv (
  id text primary key,
  data jsonb not null,
  atualizado_em timestamptz not null default now()
);

-- Liga a proteção por linha sem nenhuma regra: ninguém de fora lê ou escreve.
-- Só o servidor, usando a chave service_role, consegue acessar.
alter table public.colisao_kv enable row level security;
