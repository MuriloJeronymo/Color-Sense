-- ============================================================================
-- ColorSense — schema do Supabase
-- ============================================================================
--
-- Cole este arquivo inteiro no SQL Editor de um projeto Supabase novo e rode
-- uma vez. Ele cria as três tabelas, as políticas de RLS, os gatilhos de
-- cadastro e as restrições de integridade.
--
-- PROCEDÊNCIA: este schema foi RECONSTRUÍDO a partir do comportamento
-- observado do projeto original (colunas retornadas pelas consultas, efeitos
-- do cadastro, cascata ao apagar cena e resultado dos testes de RLS). Não é
-- um dump do banco original — aquele projeto ficou inacessível antes de ser
-- exportado. Se vocês recuperarem o projeto antigo, comparem antes de assumir
-- que são idênticos.
--
-- Diferenças deliberadas em relação ao original, todas apertando integridade:
--   • CHECK em pattern_rules.pattern — o banco antigo aceitava qualquer texto,
--     e uma regra com padrão inexistente ficava invisível sem erro nenhum.
--   • CHECK em filter_type, hue_center, hue_tolerance e opacity.
--   • Índice único parcial garantindo no máximo uma cena padrão por usuário.
-- ============================================================================


-- ─── Perfis ──────────────────────────────────────────────────────────────────
-- Espelha auth.users. O app lê o nome daqui (src/store/auth.js: getUser()).
-- Não guarda e-mail: ele já vive em auth.users e duplicá-lo só aumentaria a
-- superfície de dado pessoal exposta pelo RLS.

create table if not exists public.users (
  id              uuid primary key references auth.users (id) on delete cascade,
  name            text not null default '',
  daltonism_type  text not null default 'normal',
  created_at      timestamptz not null default now(),

  constraint users_daltonism_type_valido check (daltonism_type in (
    'normal','protanopia','protanomalia','deuteranopia','deuteranomalia',
    'tritanopia','tritanomalia','achromatopsia','achromatomaly'
  ))
);


-- ─── Cenas ───────────────────────────────────────────────────────────────────

create table if not exists public.scenes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null,
  filter_type  text not null default 'normal',
  is_default   boolean not null default false,
  created_at   timestamptz not null default now(),

  constraint scenes_nome_nao_vazio check (length(btrim(name)) > 0),
  constraint scenes_filter_type_valido check (filter_type in (
    'normal','protanopia','protanomalia','deuteranopia','deuteranomalia',
    'tritanopia','tritanomalia','achromatopsia','achromatomaly'
  ))
);

create index if not exists scenes_user_id_idx on public.scenes (user_id);

-- No máximo uma cena padrão por usuário. O app já zera as outras antes de
-- marcar uma nova (sceneStore.js), então isto é rede de segurança.
create unique index if not exists scenes_uma_padrao_por_usuario
  on public.scenes (user_id) where is_default;


-- ─── Regras de padrão visual ─────────────────────────────────────────────────

create table if not exists public.pattern_rules (
  id             uuid primary key default gen_random_uuid(),
  scene_id       uuid not null references public.scenes (id) on delete cascade,
  label          text not null default '',
  color_hex      text not null,
  hue_center     integer not null,
  hue_tolerance  integer not null default 30,
  pattern        text not null,
  opacity        real not null default 0.7,

  -- O overlay chama getPatternTile(pattern) e devolve tile vazio para valor
  -- desconhecido: a regra sumia da tela sem erro. Esta lista é a mesma de
  -- PATTERNS em src/ui/app.js.
  constraint pattern_rules_pattern_valido check (pattern in (
    'diagonal','crosshatch','horizontal','vertical','dots','zigzag'
  )),
  constraint pattern_rules_cor_hex check (color_hex ~* '^#[0-9a-f]{6}$'),
  constraint pattern_rules_matiz     check (hue_center between 0 and 360),
  constraint pattern_rules_tolerancia check (hue_tolerance between 1 and 180),
  constraint pattern_rules_opacidade check (opacity between 0 and 1)
);

create index if not exists pattern_rules_scene_id_idx on public.pattern_rules (scene_id);


-- ─── Row Level Security ──────────────────────────────────────────────────────
-- Sem sessão, nenhuma linha é visível em nenhuma tabela. Com sessão, só as
-- próprias. Foi assim que o projeto original se comportou nos testes, e é o
-- que o TCLE promete ao participante.

alter table public.users         enable row level security;
alter table public.scenes        enable row level security;
alter table public.pattern_rules enable row level security;

-- users: cada um enxerga e edita apenas o próprio perfil.
drop policy if exists "perfil proprio: ler"      on public.users;
drop policy if exists "perfil proprio: atualizar" on public.users;

create policy "perfil proprio: ler"
  on public.users for select
  using (auth.uid() = id);

create policy "perfil proprio: atualizar"
  on public.users for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- scenes: dono total sobre as próprias cenas.
drop policy if exists "cenas proprias: ler"     on public.scenes;
drop policy if exists "cenas proprias: criar"   on public.scenes;
drop policy if exists "cenas proprias: alterar" on public.scenes;
drop policy if exists "cenas proprias: apagar"  on public.scenes;

create policy "cenas proprias: ler"
  on public.scenes for select using (auth.uid() = user_id);

create policy "cenas proprias: criar"
  on public.scenes for insert with check (auth.uid() = user_id);

create policy "cenas proprias: alterar"
  on public.scenes for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "cenas proprias: apagar"
  on public.scenes for delete using (auth.uid() = user_id);

-- pattern_rules: o acesso é herdado da cena dona.
drop policy if exists "regras da cena propria: ler"     on public.pattern_rules;
drop policy if exists "regras da cena propria: criar"   on public.pattern_rules;
drop policy if exists "regras da cena propria: alterar" on public.pattern_rules;
drop policy if exists "regras da cena propria: apagar"  on public.pattern_rules;

create policy "regras da cena propria: ler"
  on public.pattern_rules for select
  using (exists (select 1 from public.scenes s
                 where s.id = pattern_rules.scene_id and s.user_id = auth.uid()));

create policy "regras da cena propria: criar"
  on public.pattern_rules for insert
  with check (exists (select 1 from public.scenes s
                      where s.id = pattern_rules.scene_id and s.user_id = auth.uid()));

create policy "regras da cena propria: alterar"
  on public.pattern_rules for update
  using (exists (select 1 from public.scenes s
                 where s.id = pattern_rules.scene_id and s.user_id = auth.uid()))
  with check (exists (select 1 from public.scenes s
                      where s.id = pattern_rules.scene_id and s.user_id = auth.uid()));

create policy "regras da cena propria: apagar"
  on public.pattern_rules for delete
  using (exists (select 1 from public.scenes s
                 where s.id = pattern_rules.scene_id and s.user_id = auth.uid()));


-- ─── Cadastro: perfil e cena padrão ──────────────────────────────────────────
-- O app chama supabase.auth.signUp passando name e daltonism_type em
-- options.data, e logo depois espera encontrar o perfil em public.users e ao
-- menos uma cena. Estes gatilhos é que fazem isso acontecer.

create or replace function public.criar_perfil_no_cadastro()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text := coalesce(new.raw_user_meta_data ->> 'name', '');
  v_tipo text := coalesce(new.raw_user_meta_data ->> 'daltonism_type', 'normal');
begin
  -- tipo desconhecido não pode derrubar o cadastro
  if v_tipo not in ('normal','protanopia','protanomalia','deuteranopia',
                    'deuteranomalia','tritanopia','tritanomalia',
                    'achromatopsia','achromatomaly') then
    v_tipo := 'normal';
  end if;

  insert into public.users (id, name, daltonism_type)
  values (new.id, v_nome, v_tipo)
  on conflict (id) do nothing;

  -- Cena padrão já com o filtro do tipo declarado: o usuário abre o app e o
  -- filtro dele está a um clique, em vez de uma lista vazia.
  insert into public.scenes (user_id, name, filter_type, is_default)
  values (new.id, 'Padrão', v_tipo, true)
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function public.criar_perfil_no_cadastro();


-- ─── Conferência rápida ──────────────────────────────────────────────────────
-- Rode depois de aplicar. Deve listar as 3 tabelas com rowsecurity = true.

-- select tablename, rowsecurity
--   from pg_tables
--  where schemaname = 'public'
--    and tablename in ('users','scenes','pattern_rules');
