-- Budget fixes round 2:
--  #1 create_trip wrote email into trips.created_by (now uuid) -> use auth.uid()
--  #2 budget_expenses has no notes column (manual-expense save failed)
--  #8 canonical categories: system = accommodation/transport/activities/services;
--     food/shopping/souvenirs/other are CUSTOM. trip_services maps to 'services'.

-- #1 ---------------------------------------------------------------
create or replace function public.create_trip(p_title text, p_description text default '')
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid; v_trip_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Not authenticated'; end if;
  insert into public.trips (title, description, created_by)
  values (p_title, p_description, v_uid)
  returning id into v_trip_id;
  return v_trip_id;
end $$;

-- #2 ---------------------------------------------------------------
alter table public.budget_expenses add column if not exists notes text;

-- #8 category model -----------------------------------------------
-- seeder: 4 system categories (incl services) + custom food/shopping/souvenirs/other
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
      (p_trip_id,'system','Activities','activities','🎭','#10b981',2,v_owner),
      (p_trip_id,'system','Services','services','🧳','#14b8a6',3,v_owner),
      (p_trip_id,'custom','Food',null,'🍽️','#f59e0b',4,v_owner),
      (p_trip_id,'custom','Shopping',null,'🛍️','#ec4899',5,v_owner),
      (p_trip_id,'custom','Souvenirs',null,'🎁','#8b5cf6',6,v_owner),
      (p_trip_id,'custom','Other',null,'💰','#78716c',7,v_owner);
  end if;
end $$;

-- trip_services maps to the 'services' system category (was 'transport')
create or replace function public.sync_budget_expense()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_kind text; v_syskey text; v_trip uuid; v_amount numeric; v_currency text;
  v_title text; v_city text; v_cat uuid; v_owner uuid; v_src uuid;
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

  v_trip := NEW.trip_id; v_amount := NEW.price; v_currency := NEW.currency; v_src := NEW.id;

  if    TG_TABLE_NAME = 'hotel_stays'   then v_title:=NEW.name;  select city_name into v_city from public.city_visits where id = NEW.city_visit_id;
  elsif TG_TABLE_NAME = 'transfers'     then v_title:=coalesce(NEW.carrier,'Transfer'); select city_name into v_city from public.city_visits where id = NEW.to_city_visit_id;
  elsif TG_TABLE_NAME = 'activities'    then v_title:=NEW.title; select city_name into v_city from public.city_visits where id = NEW.city_visit_id;
  elsif TG_TABLE_NAME = 'trip_services' then v_title:=NEW.name;  v_city:=null;
  end if;

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
  raise warning 'sync_budget_expense failed: %', sqlerrm;
  return coalesce(NEW, OLD);
end $$;

-- data: demote any 'food' system category to custom
update public.budget_categories set kind='custom', system_key=null where system_key='food';

-- data: ensure every trip has the 4 system categories (esp. 'services', missing before)
insert into public.budget_categories (trip_id, kind, name, system_key, icon, color, order_index, created_by)
select t.id, 'system', x.nm, x.sk, x.ic, x.cl, x.ord, t.created_by
from public.trips t
cross join (values
  ('accommodation','Accommodation','🏨','#6366f1',0),
  ('transport','Transport','✈️','#0ea5e9',1),
  ('activities','Activities','🎭','#10b981',2),
  ('services','Services','🧳','#14b8a6',3)
) as x(sk,nm,ic,cl,ord)
where t.created_by is not null
  and not exists (select 1 from public.budget_categories c where c.trip_id = t.id and c.system_key = x.sk);
