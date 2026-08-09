-- TRIP-394 (Ф2 эпика TRIP-374): целостность строки бюджета в БД.
--
-- Бюджет трипа — синглтон: ровно одна строка trip_budgets на трип. Сегодня это
-- держится ТОЛЬКО процедурно — ensure_trip_budget вставляет `where not exists`,
-- а UNIQUE-констрейнта нет. В модели «единой двери» инвариант формы данных живёт
-- в БД (handoff Р4 §0: в БД — целостность), а не в приложении: шов settings
-- становится настоящим upsert по конфликту, а не «проверь-потом-вставь» с окном
-- гонки между двумя параллельными правками курсов.
--
-- Безопасно: дублей нет ни на dev, ни на prod (замер 2026-08-09, оба 0). На
-- всякий случай схлопываем возможные дубли ДЕТЕРМИНИРОВАННО перед констрейнтом —
-- миграция обязана быть самолечащейся на колонке, куда исторически писали в
-- обход (TRIP-281). Дубль мог родиться ТОЛЬКО из клиентского self-heal INSERT
-- (гонка двух правок курсов), а он пишет fx_overrides — поэтому оставляем
-- строку С непустыми курсами, при равенстве — самую раннюю. `ctid` — тай-брейк,
-- чтобы удаление было детерминированным даже при совпадении created_at.

delete from public.trip_budgets a
using public.trip_budgets b
where a.trip_id = b.trip_id
  and (
    (a.fx_overrides = '{}'::jsonb) and (b.fx_overrides <> '{}'::jsonb)
    or (a.fx_overrides = '{}'::jsonb) = (b.fx_overrides = '{}'::jsonb)
       and (a.created_at, a.ctid) > (b.created_at, b.ctid)
  );

alter table public.trip_budgets
  add constraint trip_budgets_trip_id_key unique (trip_id);

-- ★ Сама UNIQUE открывает гонку сидера (ревью Codex): `ensure_trip_budget`
-- вставляла `where not exists`, и два параллельных вызова (напр. курсы правят с
-- двух вкладок) оба проходили проверку и второй ловил unique-violation → 500. С
-- констрейнтом на месте лечение — атомарный `on conflict (trip_id) do nothing`
-- вместо «проверь-потом-вставь». Сигнатура не меняется (тот же (uuid)→void),
-- поэтому типы БД не трогаются. Тело — из живого pg_get_functiondef, изменён
-- ТОЛЬКО insert курсов; посев категорий не трогаем (на нём нет UNIQUE, его
-- гонка даёт лишние строки, а не 500 — отдельный вопрос вне этой правки).
create or replace function public.ensure_trip_budget(p_trip_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_owner uuid; v_currency text;
begin
  select created_by, coalesce(details->>'main_currency','EUR') into v_owner, v_currency
  from public.trips where id = p_trip_id;
  if v_owner is null then return; end if;

  insert into public.trip_budgets (trip_id, currency, fx_overrides, created_by)
  values (p_trip_id, coalesce(v_currency,'EUR'), '{}'::jsonb, v_owner)
  on conflict (trip_id) do nothing;

  if not exists (select 1 from public.budget_categories where trip_id = p_trip_id) then
    -- `name` is an English fallback only; the UI shows t('budget.cat_<system_key>').
    insert into public.budget_categories (trip_id, kind, name, system_key, icon, color, order_index, created_by) values
      (p_trip_id,'system','Accommodation','accommodation','bed',   '#5470E6',0,v_owner),
      (p_trip_id,'system','Transport',    'transport',    'plane', '#15A2B0',1,v_owner),
      (p_trip_id,'system','Activities',   'activities',   'ticket','#E0568F',2,v_owner),
      (p_trip_id,'system','Services',     'services',     'esim',  '#2FA866',3,v_owner),
      (p_trip_id,'custom','Food',         'food',         'cup',   '#E6A21E',4,v_owner),
      (p_trip_id,'custom','Shopping',     'shopping',     'card',  '#8A6BF0',5,v_owner),
      (p_trip_id,'custom','Souvenirs',    'souvenirs',    'gift',  '#E07A4E',6,v_owner),
      (p_trip_id,'custom','Other',        'other',        'wallet','#9AA1AD',7,v_owner);
  end if;
end $function$;

-- ★ TRIP-394 ③ — kept-консистентность-триггер, класс `sync_budget_expense`.
-- «`fx_overrides` валидны только против ТЕКУЩЕЙ `main_currency`» — это ИНВАРИАНТ
-- ДАННЫХ, а не действие экрана: он обязан держаться в БД для ЛЮБОГО писателя и
-- атомарно, а не отдельной клиентской до-записью после смены валюты (которая
-- рвётся между двумя запросами — Codex-③). Курсы заданы против старой валюты →
-- при её смене они обесценены и сбрасываются в ТОЙ ЖЕ транзакции, что правит
-- `trips`. Строго целостность, никакой продуктовой логики.
--
-- `coalesce(...,'EUR')` зеркалит `ensure_trip_budget` и обязателен: `currency`
-- у `trip_budgets` — NOT NULL без дефолта, а будущий писатель может обнулить
-- `main_currency`; без coalesce сброс уронил бы NOT NULL. НЕТ `exception when
-- others` (в отличие от `seed_budget_on_trip`, который best-effort на INSERT):
-- упавший сброс ДОЛЖЕН откатить весь `UPDATE trips`, иначе останется запрещённое
-- промежуточное состояние «новая валюта + старые курсы».
create or replace function public.reset_fx_on_currency_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  update public.trip_budgets
     set fx_overrides = '{}'::jsonb,
         currency = coalesce(new.details->>'main_currency','EUR')
   where trip_id = new.id;
  return new;
end $function$;

-- Срабатывает ТОЛЬКО на реальную смену валюты (WHEN), а не на любую правку трипа
-- (название/аддоны/обложка курсы не трогают).
create trigger trg_reset_fx_on_currency_change
  after update on public.trips
  for each row
  when (old.details->>'main_currency' is distinct from new.details->>'main_currency')
  execute function public.reset_fx_on_currency_change();
