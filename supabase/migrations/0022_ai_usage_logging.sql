-- ============================================================
-- AI usage logging & cost accounting
-- Two tables: versioned price book + per-model-call usage events.
-- Cost is snapshotted at insert by a trigger using the price
-- effective at occurred_at, so historical reports never drift.
-- Applied to both Supabase projects: Triplanio (prod) and Triplanio dev.
-- ============================================================

-- 1) Versioned price book: (provider, model, unit) -> price per 1 unit
create table if not exists public.ai_model_prices (
  id             uuid primary key default gen_random_uuid(),
  provider       text not null,
  model          text not null,
  unit           text not null check (unit in (
                   'input_token','output_token','total_token',
                   'page','request','second','character','image')),
  unit_price_usd numeric(20,12) not null,
  effective_from timestamptz not null default now(),
  effective_to   timestamptz,
  notes          text,
  created_at     timestamptz not null default now()
);
comment on table public.ai_model_prices is
  'Versioned price book. One row per (provider, model, unit). unit_price_usd is price for ONE unit. effective_to null = currently active.';
create index if not exists ai_model_prices_lookup_idx
  on public.ai_model_prices (provider, model, unit, effective_from desc);

-- 2) Usage events: one row per billable model invocation
create table if not exists public.ai_usage_events (
  id            uuid primary key default gen_random_uuid(),
  occurred_at   timestamptz not null default now(),
  process       text not null,                 -- trip_parser|trip_planner|tg_reminders|tg_chatbot|inapp_group_chat
  workflow_id   text,                          -- n8n workflow id
  execution_id  text,                          -- n8n execution id (groups one run)
  node_name     text,                          -- which node produced this call
  provider      text not null,                 -- google | mistral | ...
  model         text not null,                 -- gemini-3.1-flash-lite | gemini-3-flash-preview | mistral-ocr-latest
  operation     text,                          -- chat | ocr | embedding ...
  user_id       uuid,
  trip_id       uuid,
  channel       text,                          -- telegram | inapp | web
  tag           text,                          -- domain tag: hotel|transfer|reminder type...
  tokens_input  bigint,
  tokens_output bigint,
  tokens_total  bigint,
  pages         integer,
  requests      integer not null default 1,
  metrics       jsonb,                         -- raw/extra usage payload, future commerce models
  cost_usd      numeric(20,10),                -- snapshot computed by trigger at insert
  cost_breakdown jsonb,                        -- {"input_token":..,"output_token":..,"page":..}
  pricing_complete boolean,                    -- false if some present metric had no matching price
  status        text not null default 'success',
  duration_ms   integer,
  created_at    timestamptz not null default now()
);
comment on table public.ai_usage_events is
  'One row per billable AI model call. cost_usd/cost_breakdown/pricing_complete are filled at insert by trg_ai_usage_cost from ai_model_prices.';
create index if not exists ai_usage_events_occurred_idx     on public.ai_usage_events (occurred_at);
create index if not exists ai_usage_events_process_idx      on public.ai_usage_events (process, occurred_at);
create index if not exists ai_usage_events_user_idx         on public.ai_usage_events (user_id);
create index if not exists ai_usage_events_trip_idx         on public.ai_usage_events (trip_id);
create index if not exists ai_usage_events_execution_idx    on public.ai_usage_events (execution_id);
create index if not exists ai_usage_events_model_idx        on public.ai_usage_events (provider, model);

-- 3) Cost computation: snapshot at insert using price effective at occurred_at
create or replace function public.compute_ai_usage_cost()
returns trigger
language plpgsql
as $$
declare
  v_price  numeric(20,12);
  v_total  numeric(20,10) := 0;
  v_bd     jsonb := '{}'::jsonb;
  v_complete boolean := true;
begin
  if NEW.model like 'models/%' then
    NEW.model := substring(NEW.model from 8);
  end if;

  if NEW.tokens_total is null and (NEW.tokens_input is not null or NEW.tokens_output is not null) then
    NEW.tokens_total := coalesce(NEW.tokens_input,0) + coalesce(NEW.tokens_output,0);
  end if;

  if NEW.cost_usd is not null then
    return NEW;
  end if;

  if NEW.tokens_input is not null and NEW.tokens_input <> 0 then
    select unit_price_usd into v_price from public.ai_model_prices
      where provider = NEW.provider and model = NEW.model and unit = 'input_token'
        and effective_from <= NEW.occurred_at
        and (effective_to is null or effective_to > NEW.occurred_at)
      order by effective_from desc limit 1;
    if v_price is null then v_complete := false;
    else
      v_total := v_total + NEW.tokens_input * v_price;
      v_bd := v_bd || jsonb_build_object('input_token', round((NEW.tokens_input * v_price)::numeric, 10));
    end if;
  end if;

  v_price := null;
  if NEW.tokens_output is not null and NEW.tokens_output <> 0 then
    select unit_price_usd into v_price from public.ai_model_prices
      where provider = NEW.provider and model = NEW.model and unit = 'output_token'
        and effective_from <= NEW.occurred_at
        and (effective_to is null or effective_to > NEW.occurred_at)
      order by effective_from desc limit 1;
    if v_price is null then v_complete := false;
    else
      v_total := v_total + NEW.tokens_output * v_price;
      v_bd := v_bd || jsonb_build_object('output_token', round((NEW.tokens_output * v_price)::numeric, 10));
    end if;
  end if;

  v_price := null;
  if NEW.pages is not null and NEW.pages <> 0 then
    select unit_price_usd into v_price from public.ai_model_prices
      where provider = NEW.provider and model = NEW.model and unit = 'page'
        and effective_from <= NEW.occurred_at
        and (effective_to is null or effective_to > NEW.occurred_at)
      order by effective_from desc limit 1;
    if v_price is null then v_complete := false;
    else
      v_total := v_total + NEW.pages * v_price;
      v_bd := v_bd || jsonb_build_object('page', round((NEW.pages * v_price)::numeric, 10));
    end if;
  end if;

  v_price := null;
  if NEW.requests is not null and NEW.requests <> 0 then
    select unit_price_usd into v_price from public.ai_model_prices
      where provider = NEW.provider and model = NEW.model and unit = 'request'
        and effective_from <= NEW.occurred_at
        and (effective_to is null or effective_to > NEW.occurred_at)
      order by effective_from desc limit 1;
    if v_price is not null then
      v_total := v_total + NEW.requests * v_price;
      v_bd := v_bd || jsonb_build_object('request', round((NEW.requests * v_price)::numeric, 10));
    end if;
  end if;

  NEW.cost_usd := round(v_total, 10);
  NEW.cost_breakdown := v_bd;
  NEW.pricing_complete := v_complete;
  return NEW;
end;
$$;

drop trigger if exists trg_ai_usage_cost on public.ai_usage_events;
create trigger trg_ai_usage_cost
  before insert on public.ai_usage_events
  for each row execute function public.compute_ai_usage_cost();

-- 4) Seed current prices (price per 1 unit, USD)
insert into public.ai_model_prices (provider, model, unit, unit_price_usd, notes) values
  ('mistral','mistral-ocr-latest',    'page',         0.002,        '$2 / 1000 pages'),
  ('google', 'gemini-3.1-flash-lite', 'input_token',  0.00000025,   '$0.25 / 1M input tokens'),
  ('google', 'gemini-3.1-flash-lite', 'output_token', 0.0000015,    '$1.50 / 1M output tokens'),
  ('google', 'gemini-3-flash-preview','input_token',  0.0000005,    '$0.50 / 1M input tokens (preview)'),
  ('google', 'gemini-3-flash-preview','output_token', 0.000003,     '$3.00 / 1M output tokens (preview)');

-- 5) Reporting views
create or replace view public.ai_cost_by_day as
  select date_trunc('day', occurred_at)::date as day,
         count(*) as calls, sum(cost_usd) as cost_usd,
         sum(tokens_input) as tokens_input, sum(tokens_output) as tokens_output, sum(pages) as pages
  from public.ai_usage_events group by 1 order by 1 desc;

create or replace view public.ai_cost_by_week as
  select date_trunc('week', occurred_at)::date as week_start,
         count(*) as calls, sum(cost_usd) as cost_usd
  from public.ai_usage_events group by 1 order by 1 desc;

create or replace view public.ai_cost_by_process as
  select process, count(*) as calls, sum(cost_usd) as cost_usd,
         sum(tokens_input) as tokens_input, sum(tokens_output) as tokens_output, sum(pages) as pages
  from public.ai_usage_events group by 1 order by cost_usd desc nulls last;

create or replace view public.ai_cost_by_user as
  select user_id, count(*) as calls, sum(cost_usd) as cost_usd
  from public.ai_usage_events where user_id is not null group by 1 order by cost_usd desc nulls last;

create or replace view public.ai_cost_by_trip as
  select trip_id, count(*) as calls, sum(cost_usd) as cost_usd
  from public.ai_usage_events where trip_id is not null group by 1 order by cost_usd desc nulls last;

create or replace view public.ai_cost_by_run as
  select execution_id, process, min(occurred_at) as started_at,
         count(*) as calls, sum(cost_usd) as cost_usd,
         bool_and(pricing_complete) as fully_priced
  from public.ai_usage_events where execution_id is not null
  group by execution_id, process order by started_at desc;

-- 6) Security: deny by default (service role bypasses RLS for the n8n poller inserts)
alter table public.ai_model_prices  enable row level security;
alter table public.ai_usage_events  enable row level security;
