-- Budget must always exist (like base44, which auto-seeded it on trip creation).
-- Trigger: every new trip gets its default budget + categories, so the manual
-- "Создать бюджет" empty state never appears. Backfill existing trips too.

create or replace function public.seed_budget_on_trip()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.ensure_trip_budget(NEW.id);
  return NEW;
exception when others then
  raise warning 'seed_budget_on_trip failed: %', sqlerrm;
  return NEW;
end $$;

drop trigger if exists trg_seed_budget_on_trip on public.trips;
create trigger trg_seed_budget_on_trip
after insert on public.trips
for each row execute function public.seed_budget_on_trip();

-- backfill: seed budget for every existing trip (ensure_trip_budget is idempotent)
select public.ensure_trip_budget(id) from public.trips;
