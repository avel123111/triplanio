-- TRIP-67: единый rate-limit примитив (защита от перебора email) +
-- консолидация старого per-email кэпа сброса пароля на него.
--
-- Зачем: signupPrecheck / requestPasswordReset — намеренные оракулы существования
-- email. Раньше лимит был только у reset (отдельная таблица password_reset_attempts,
-- 5 писем/час/email) и стоял ПОСЛЕ проверки существования → перебор несуществующих
-- адресов не ограничивался вообще. Здесь вводим ОДИН общий счётчик попыток с
-- произвольными «корзинами» (bucket) + ключом (IP или email), чтобы не плодить
-- параллельные таблицы под каждый эндпоинт.
--
-- Корзины, которые на нём поедут (задаются в edge-функциях):
--   signup_precheck_ip / pwd_reset_ip — по IP, 10/мин и 60/час (анти-перебор)
--   pwd_reset_email                   — по email, 5/час (анти-спам инбокса; перенос
--                                       старого кэпа password_reset_attempts)
--
-- geocode_rate_bucket НЕ трогаем: у него другая задача (token-bucket под лимит
-- внешнего API LocationIQ), а не защита от злоупотребления по идентичности.

create table if not exists public.rate_limit_hits (
  id         bigint generated always as identity primary key,
  bucket     text not null,
  key        text not null,
  created_at timestamptz not null default now()
);

-- Покрывает оба запроса: COUNT по (bucket,key) в окне и точечную чистку.
create index if not exists idx_rate_limit_hits_lookup
  on public.rate_limit_hits (bucket, key, created_at desc);

-- Доступ только у service-role (edge-функции через supabaseAdmin); RLS включён без
-- политик → anon/authenticated полностью отрезаны (как у бывшей password_reset_attempts).
alter table public.rate_limit_hits enable row level security;
grant all on table public.rate_limit_hits to service_role;

-- Read-only проверка: true, если за окно (bucket,key) ещё НЕ достигли лимита.
-- Не пишет ничего — вызывающий сам решает, фиксировать ли попытку (record).
create or replace function public.rate_limit_check(
  p_bucket text,
  p_key text,
  p_max integer,
  p_window_seconds integer
) returns boolean
  language sql
  security definer
  set search_path = public
as $$
  select coalesce(count(*), 0) < p_max
  from public.rate_limit_hits
  where bucket = p_bucket
    and key = p_key
    and created_at >= now() - make_interval(secs => p_window_seconds);
$$;

-- Зафиксировать одну попытку + оппортунистическая чистка старых строк этого ключа
-- (окна ≤ 1ч, поэтому всё старше суток гарантированно мусор).
create or replace function public.rate_limit_record(
  p_bucket text,
  p_key text
) returns void
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  insert into public.rate_limit_hits (bucket, key) values (p_bucket, p_key);
  delete from public.rate_limit_hits
   where bucket = p_bucket
     and key = p_key
     and created_at < now() - interval '24 hours';
end;
$$;

revoke all on function public.rate_limit_check(text, text, integer, integer) from public;
grant execute on function public.rate_limit_check(text, text, integer, integer) to service_role;
revoke all on function public.rate_limit_record(text, text) from public;
grant execute on function public.rate_limit_record(text, text) to service_role;

-- Старый одноцелевой счётчик сброса больше не нужен — его роль (pwd_reset_email)
-- теперь на общем примитиве. Дропаем таблицу (sequence/index уходят вместе с ней).
drop table if exists public.password_reset_attempts;
