-- TRIP-230 #6: seeded budget categories had no usable icon, colours outside the
-- Lumo palette and an English name in every language.
--
-- Root cause: ensure_trip_budget invented all three. It wrote EMOJI into `icon`
-- (the UI resolves design-system icon slugs, so all four fell back to "wallet"),
-- retired Tailwind hexes into `color`, and hard-coded 'Food'/'Shopping'/... into
-- `name` — SQL has no access to the creator's locale, so the name could never be
-- translated.
--
-- Fix: SQL stops inventing NAMES. Every seeded category carries a stable
-- `system_key`, and the frontend renders t('budget.cat_<key>') for it, so the
-- category follows the interface language and its translation lives in Tolgee
-- like every other string. `name` keeps an English value purely as a fallback
-- for any consumer without i18n. Renaming a category in the UI clears
-- `system_key`, which is what turns it into a genuinely user-owned category.
--
-- The design was already half-built: the system_key CHECK allowed 'food'. This
-- finishes it for the other three.

-- 1. Allow the remaining seed keys.
-- ddl-guard: allow-destructive — TRIP-230, widening a CHECK has no other form
-- than drop + re-add; the new predicate is a strict superset of the old one, so
-- no existing row can be invalidated.
alter table public.budget_categories drop constraint if exists budget_categories_system_key_check;
alter table public.budget_categories add constraint budget_categories_system_key_check
  check (system_key is null or system_key = any (array[
    'accommodation','transport','activities','services',
    'food','shopping','souvenirs','other'
  ]));

-- 2. Seed with icon SLUGS (src/design/icons) and the Lumo --cat-1..8 palette
--    (src/lib/budget/category-colors.js), keyed so the UI can localize the name.
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
  select p_trip_id, coalesce(v_currency,'EUR'), '{}'::jsonb, v_owner
  where not exists (select 1 from public.trip_budgets where trip_id = p_trip_id);

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

-- 3. Backfill trips seeded by the old function. Matched by the exact English
--    seed name AND the exact emoji the old seeder wrote, so a category a user
--    renamed or re-iconed is left alone — it is theirs now.
update public.budget_categories set system_key = 'food',      icon = 'cup',    color = '#E6A21E'
  where kind = 'custom' and system_key is null and name = 'Food'      and icon = '🍽️';
update public.budget_categories set system_key = 'shopping',  icon = 'card',   color = '#8A6BF0'
  where kind = 'custom' and system_key is null and name = 'Shopping'  and icon = '🛍️';
update public.budget_categories set system_key = 'souvenirs', icon = 'gift',   color = '#E07A4E'
  where kind = 'custom' and system_key is null and name = 'Souvenirs' and icon = '🎁';
update public.budget_categories set system_key = 'other',     icon = 'wallet', color = '#9AA1AD'
  where kind = 'custom' and system_key is null and name = 'Other'     and icon = '💰';

-- System categories: name/localization already worked (they always had a key);
-- only the emoji icon and the retired palette need correcting.
update public.budget_categories set icon = 'bed',    color = '#5470E6' where system_key = 'accommodation' and icon = '🏨';
update public.budget_categories set icon = 'plane',  color = '#15A2B0' where system_key = 'transport'     and icon = '✈️';
update public.budget_categories set icon = 'ticket', color = '#E0568F' where system_key = 'activities'    and icon = '🎭';
update public.budget_categories set icon = 'esim',   color = '#2FA866' where system_key = 'services'      and icon = '🧳';
