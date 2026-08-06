-- TRIP-153 (1/4): журнал сверок энтайтлмента.
--
-- Два уровня намеренно, а не один: сводка отвечает на вопрос «прогон вообще
-- отработал», построчный след — на вопрос «что именно разошлось и почему».
-- Без второго алерт есть, а разбирать нечего; без первого «упал на полпути»
-- неотличим от «расхождений не нашлось».
--
-- pg_cron рапортует об успехе по факту завершения вызова, поэтому вердикт
-- прогона обязан писать САМ прогон: строка со status='running', которая не
-- закрылась в 'ok', и есть сигнал «умер на полпути». Для Сверки Б (edge через
-- HTTP) это тем более так — pg_net асинхронен и не знает, чем кончился вызов.
--
-- Ярус B: пишет только service_role (и cron-владелец), клиент не читает и не
-- пишет — смотреть SQL-редактором. UI не делаем.
--
-- Ретеншн: НЕ пишем. По П6 строка появляется только на реальном расхождении,
-- а не на каждый прогон, поэтому объём растёт по числу дефектов, а не по
-- времени. Чистку заводим, когда будет что чистить, — это решение, а не
-- забывчивость (обоснование «второй cron.job_run_details на 17 506 строк» сюда
-- не переносится: там строка на КАЖДЫЙ запуск раз в минуту).

-- ============================================================================
-- 1. reconcile_run — один ряд на прогон
-- ============================================================================
create table if not exists public.reconcile_run (
  id                     uuid primary key default extensions.uuid_generate_v4(),
  kind                   public.short_text not null check (kind in ('cache', 'stripe')),
  mode                   public.short_text not null check (mode in ('report', 'apply')),
  started_at             timestamptz not null default now(),
  finished_at            timestamptz,
  status                 public.short_text not null default 'running'
                         check (status in ('running', 'ok', 'partial', 'failed')),
  scanned_users          integer not null default 0,
  scanned_trips          integer not null default 0,
  scanned_stripe_objects integer not null default 0,
  found                  integer not null default 0,
  fixed                  integer not null default 0,
  unfixable              integer not null default 0,
  error                  public.long_text
);

comment on table public.reconcile_run is
  'Сводка одного прогона сверки энтайтлмента. status=running, не закрывшийся в ok, = упал на полпути. TRIP-153.';
comment on column public.reconcile_run.unfixable is
  'Находки, НЕ починенные этим прогоном (action=reported|failed). В режиме report сюда попадают ВСЕ — это ожидаемо, в нём чинить нечего по определению.';

create index if not exists idx_reconcile_run_started on public.reconcile_run (started_at desc);

-- ============================================================================
-- 2. reconcile_finding — один ряд на расхождение
-- ============================================================================
-- subject_id — text, а не uuid: у Сверки Б субъектом бывает объект Stripe
-- (sub_…, pi_…, cus_…), у Сверки А — наш uuid. Один столбец на оба, потому что
-- вопрос «что разошлось» одинаковый.
create table if not exists public.reconcile_finding (
  id           uuid primary key default extensions.uuid_generate_v4(),
  run_id       uuid not null references public.reconcile_run(id) on delete cascade,
  kind         public.short_text not null check (kind in (
                 'cache_drift_user', 'cache_drift_trip', 'addons_revoked',
                 'tg_binding_on_non_pro_trip',
                 'sub_missing_in_stripe', 'sub_status_drift',
                 'purchase_missing', 'purchase_refunded_in_stripe',
                 'unattributable', 'needs_review', 'orphan_purchase',
                 'multi_live_sub', 'webhook_event_failed')),
  subject_type public.short_text not null check (subject_type in ('user', 'trip', 'subscription', 'purchase', 'webhook_event')),
  subject_id   public.short_text not null,
  before       jsonb,
  after        jsonb,
  source       jsonb,
  action       public.short_text not null check (action in ('fixed', 'reported', 'failed')),
  error        public.long_text,
  created_at   timestamptz not null default now()
);

comment on table public.reconcile_finding is
  'Одно расхождение, найденное сверкой. action=fixed — починили, reported — только зафиксировали. TRIP-153.';
comment on column public.reconcile_finding.source is
  'Нормализованный срез входа вердикта. Полный объект Stripe кладём только у находок, не по всем просмотренным.';

create index if not exists idx_reconcile_finding_run  on public.reconcile_finding (run_id);
create index if not exists idx_reconcile_finding_kind on public.reconcile_finding (kind, created_at desc);

-- ============================================================================
-- 3. Ярус B — ни anon, ни authenticated
-- ============================================================================
-- RLS включаем без политик: даже при случайном гранте строк не видно.
alter table public.reconcile_run     enable row level security;
alter table public.reconcile_finding enable row level security;

revoke all on table public.reconcile_run     from anon, authenticated;
revoke all on table public.reconcile_finding from anon, authenticated;
grant  all on table public.reconcile_run     to service_role;
grant  all on table public.reconcile_finding to service_role;

-- ============================================================================
-- 4. Вью для разбора глазами
-- ============================================================================
create or replace view public.reconcile_last_runs as
  select r.id, r.kind, r.mode, r.status, r.started_at, r.finished_at,
         r.finished_at - r.started_at as duration,
         r.scanned_users, r.scanned_trips, r.scanned_stripe_objects,
         r.found, r.fixed, r.unfixable, r.error
    from public.reconcile_run r
   order by r.started_at desc
   limit 50;

comment on view public.reconcile_last_runs is 'Последние прогоны сверки со сводкой. TRIP-153.';

-- Находки ПОСЛЕДНЕГО прогона каждого вида, сгруппированные по классу: ответ на
-- вопрос «что сейчас разошлось», а не «что когда-либо находили».
create or replace view public.reconcile_open_findings as
  with last_run as (
    select distinct on (kind) id, kind, started_at
      from public.reconcile_run
     where status in ('ok', 'partial')
     order by kind, started_at desc
  )
  select lr.kind as run_kind, lr.started_at as run_started_at,
         f.kind, f.action, count(*) as n,
         min(f.created_at) as first_seen,
         (array_agg(f.subject_id order by f.created_at))[1:20] as sample_subjects
    from last_run lr
    join public.reconcile_finding f on f.run_id = lr.id
   group by lr.kind, lr.started_at, f.kind, f.action
   order by lr.kind, f.kind;

comment on view public.reconcile_open_findings is 'Находки последнего успешного прогона по классам. TRIP-153.';

revoke all on public.reconcile_last_runs     from anon, authenticated;
revoke all on public.reconcile_open_findings from anon, authenticated;
grant  select on public.reconcile_last_runs     to service_role;
grant  select on public.reconcile_open_findings to service_role;
