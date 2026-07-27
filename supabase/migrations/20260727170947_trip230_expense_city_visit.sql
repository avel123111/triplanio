-- TRIP-230 #7: city names in the budget stayed untranslated — and worse, one
-- city could split into TWO groups.
--
-- Root cause: budget_expenses.city_name is a plain text column with no link to
-- the visit, written by TWO sources in TWO different languages:
--   * sync_budget_expense (booking-derived expenses) wrote name_i18n->>'en'
--     — always English;
--   * the manual expense form wrote the label from the already-LOCALIZED visit
--     list — i.e. whatever language the UI was in at that moment.
-- Observed in dev: one trip holding both 'Moscow' and 'Moskva', another holding
-- 'Париж' next to a trip holding 'Barcelona'. Since the "by city" tab groups on
-- that string, the same city lands in two groups and the totals drift apart.
--
-- Fix: store the RELATION, derive the label. city_visit_id is the trip's own
-- city row, which already carries name_i18n, so the budget re-localizes with the
-- rest of the app (cityLabel) and groups by identity instead of by spelling.
-- city_name stays as the fallback for expenses that have no visit (a city typed
-- by hand, or a visit later deleted) — dropping it would lose that.

alter table public.budget_expenses
  add column if not exists city_visit_id uuid references public.city_visits(id) on delete set null;

create index if not exists budget_expenses_city_visit_id_idx
  on public.budget_expenses (city_visit_id) where city_visit_id is not null;

-- Booking-derived expenses: take the visit the booking already points at, and
-- stop freezing an English label — the relation now carries the name.
create or replace function public.sync_budget_expense()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_kind text; v_syskey text; v_trip uuid; v_amount numeric; v_currency text;
  v_title text; v_visit uuid; v_city text; v_cat uuid; v_owner uuid; v_src uuid;
begin
  if    TG_TABLE_NAME = 'hotel_stays'   then v_kind:='hotel';    v_syskey:='accommodation';
  elsif TG_TABLE_NAME = 'transfers'     then v_kind:='transfer'; v_syskey:='transport';
  elsif TG_TABLE_NAME = 'activities'    then v_kind:='activity'; v_syskey:='activities';
  elsif TG_TABLE_NAME = 'trip_services' then v_kind:='service';  v_syskey:='services';
  else return coalesce(NEW, OLD);
  end if;

  if TG_OP = 'DELETE' then
    delete from public.budget_expenses where source_kind = v_kind and source_id = OLD.id;
    return OLD;
  end if;

  v_trip := NEW.trip_id; v_amount := coalesce(NEW.price, 0); v_currency := NEW.currency; v_src := NEW.id;

  if    TG_TABLE_NAME = 'hotel_stays'   then v_title:=NEW.name;                          v_visit:=NEW.city_visit_id;
  elsif TG_TABLE_NAME = 'transfers'     then v_title:=coalesce(NEW.carrier,'Transfer');  v_visit:=NEW.to_city_visit_id;
  elsif TG_TABLE_NAME = 'activities'    then v_title:=NEW.title;                         v_visit:=NEW.city_visit_id;
  elsif TG_TABLE_NAME = 'trip_services' then v_title:=NEW.name;                          v_visit:=null;
  end if;

  -- English label kept ONLY as the no-visit fallback; the UI reads the relation.
  if v_visit is not null then
    select coalesce(name_i18n->>'en', city_name_en) into v_city from public.city_visits where id = v_visit;
  end if;

  perform public.ensure_trip_budget(v_trip);
  select created_by into v_owner from public.trips where id = v_trip;
  select id into v_cat from public.budget_categories where trip_id = v_trip and system_key = v_syskey limit 1;
  if v_cat is null then
    select id into v_cat from public.budget_categories where trip_id = v_trip order by order_index limit 1;
  end if;
  if v_cat is null then return NEW; end if;

  update public.budget_expenses
     set category_id = v_cat, title = v_title, original_amount = v_amount,
         original_currency = coalesce(v_currency,'EUR'), city_name = v_city,
         city_visit_id = v_visit
   where source_kind = v_kind and source_id = v_src;
  if not found then
    insert into public.budget_expenses
      (trip_id, category_id, title, original_amount, original_currency, source_kind, source_id, city_name, city_visit_id, created_by)
    values (v_trip, v_cat, v_title, v_amount, coalesce(v_currency,'EUR'), v_kind, v_src, v_city, v_visit, v_owner);
  end if;

  return NEW;
exception when others then
  raise warning 'sync_budget_expense failed: %', sqlerrm;
  return coalesce(NEW, OLD);
end $function$;

-- Backfill: match the stored string against the visit's names IN ANY LOCALE,
-- which is exactly what the two writers disagreed about. Restricted to the
-- expense's own trip, and only where a single visit matches, so an ambiguous
-- row keeps its string instead of being attached to the wrong city.
--
-- `min(v.id::text)::uuid` reads as "the one match": HAVING already guarantees a
-- single distinct v.id, and the ::text detour exists only because Postgres has
-- no min(uuid) aggregate.
update public.budget_expenses e
   set city_visit_id = m.visit_id
  from (
    select e2.id as expense_id, min(v.id::text)::uuid as visit_id
      from public.budget_expenses e2
      join public.city_visits v on v.trip_id = e2.trip_id
     where e2.city_visit_id is null
       and e2.city_name is not null
       and (
         v.city_name_en = e2.city_name
         or exists (
           select 1 from jsonb_each_text(coalesce(v.name_i18n, '{}'::jsonb)) as n(loc, val)
            where val = e2.city_name
         )
       )
     group by e2.id
    having count(distinct v.id) = 1
  ) m
 where e.id = m.expense_id;
