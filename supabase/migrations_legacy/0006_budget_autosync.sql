-- Budget auto-sync: mirror bookings
-- (hotels/transfers/activities/services) into budget_expenses, via DB triggers.
-- Also: allow the 'food' system category (seedTripBudget uses it but the old
-- CHECK rejected it), and add city_name to budget_expenses for city grouping.

-- 1) allow 'food' system category
alter table public.budget_categories drop constraint if exists budget_categories_system_key_check;
alter table public.budget_categories add constraint budget_categories_system_key_check
  check (system_key is null or system_key = any (array['accommodation','transport','activities','services','food']));

-- 2) city on expenses
alter table public.budget_expenses add column if not exists city_name text;

-- 3) idempotent budget seeder (used by the sync trigger so budget auto-appears)
create or replace function public.ensure_trip_budget(p_trip_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_currency text;
begin
  select created_by, coalesce(details->>'main_currency','EUR') into v_owner, v_currency
  from public.trips where id = p_trip_id;
  if v_owner is null then return; end if;

  insert into public.trip_budgets (trip_id, currency, fx_overrides, created_by)
  select p_trip_id, coalesce(v_currency,'EUR'), '{}'::jsonb, v_owner
  where not exists (select 1 from public.trip_budgets where trip_id = p_trip_id);

  if not exists (select 1 from public.budget_categories where trip_id = p_trip_id) then
    insert into public.budget_categories (trip_id, kind, name, system_key, icon, color, order_index, created_by) values
      (p_trip_id,'system','Accommodation','accommodation','🏨','#6366f1',0,v_owner),
      (p_trip_id,'system','Transport','transport','✈️','#0ea5e9',1,v_owner),
      (p_trip_id,'system','Food','food','🍽️','#f59e0b',2,v_owner),
      (p_trip_id,'system','Activities','activities','🎭','#10b981',3,v_owner),
      (p_trip_id,'custom','Shopping',null,'🛍️','#ec4899',4,v_owner),
      (p_trip_id,'custom','Entertainment',null,'🎬','#8b5cf6',5,v_owner),
      (p_trip_id,'custom','Fees & Visa',null,'📋','#64748b',6,v_owner),
      (p_trip_id,'custom','Other',null,'💰','#78716c',7,v_owner);
  end if;
end $$;

-- 4) mirror a booking row into budget_expenses (source_kind, source_id linkage)
create or replace function public.sync_budget_expense()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_kind text; v_syskey text; v_trip uuid; v_amount numeric; v_currency text;
  v_title text; v_city text; v_cat uuid; v_owner uuid; v_src uuid;
begin
  if    TG_TABLE_NAME = 'hotel_stays'   then v_kind:='hotel';    v_syskey:='accommodation';
  elsif TG_TABLE_NAME = 'transfers'     then v_kind:='transfer'; v_syskey:='transport';
  elsif TG_TABLE_NAME = 'activities'    then v_kind:='activity'; v_syskey:='activities';
  elsif TG_TABLE_NAME = 'trip_services' then v_kind:='service';  v_syskey:='transport';
  else return coalesce(NEW, OLD);
  end if;

  if TG_OP = 'DELETE' then
    delete from public.budget_expenses where source_kind = v_kind and source_id = OLD.id;
    return OLD;
  end if;

  v_trip := NEW.trip_id; v_amount := NEW.price; v_currency := NEW.currency; v_src := NEW.id;

  if    TG_TABLE_NAME = 'hotel_stays'   then v_title:=NEW.name;  select city_name into v_city from public.city_visits where id = NEW.city_visit_id;
  elsif TG_TABLE_NAME = 'transfers'     then v_title:=coalesce(NEW.carrier,'Transfer'); select city_name into v_city from public.city_visits where id = NEW.to_city_visit_id;
  elsif TG_TABLE_NAME = 'activities'    then v_title:=NEW.title; select city_name into v_city from public.city_visits where id = NEW.city_visit_id;
  elsif TG_TABLE_NAME = 'trip_services' then v_title:=NEW.name;  v_city:=null;
  end if;

  -- no price → make sure no stale expense lingers
  if v_amount is null or v_amount = 0 then
    delete from public.budget_expenses where source_kind = v_kind and source_id = v_src;
    return NEW;
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
         original_currency = coalesce(v_currency,'EUR'), city_name = v_city
   where source_kind = v_kind and source_id = v_src;
  if not found then
    insert into public.budget_expenses
      (trip_id, category_id, title, original_amount, original_currency, source_kind, source_id, city_name, created_by)
    values (v_trip, v_cat, v_title, v_amount, coalesce(v_currency,'EUR'), v_kind, v_src, v_city, v_owner);
  end if;

  return NEW;
exception when others then
  -- never block the primary write (saving a hotel/transfer/...) on a budget-sync error
  raise warning 'sync_budget_expense failed: %', sqlerrm;
  return coalesce(NEW, OLD);
end $$;

drop trigger if exists trg_sync_budget_hotel    on public.hotel_stays;
drop trigger if exists trg_sync_budget_transfer on public.transfers;
drop trigger if exists trg_sync_budget_activity on public.activities;
drop trigger if exists trg_sync_budget_service  on public.trip_services;

create trigger trg_sync_budget_hotel    after insert or update or delete on public.hotel_stays   for each row execute function public.sync_budget_expense();
create trigger trg_sync_budget_transfer after insert or update or delete on public.transfers     for each row execute function public.sync_budget_expense();
create trigger trg_sync_budget_activity after insert or update or delete on public.activities    for each row execute function public.sync_budget_expense();
create trigger trg_sync_budget_service  after insert or update or delete on public.trip_services for each row execute function public.sync_budget_expense();

-- 5) backfill existing bookings into budget_expenses (touch each row to fire the trigger)
update public.hotel_stays   set updated_at = updated_at where price is not null and price <> 0;
update public.transfers     set updated_at = updated_at where price is not null and price <> 0;
update public.activities    set updated_at = updated_at where price is not null and price <> 0;
update public.trip_services set updated_at = updated_at where price is not null and price <> 0;
