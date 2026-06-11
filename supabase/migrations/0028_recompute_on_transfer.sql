-- 0028_recompute_on_transfer.sql
-- TRIP-126 / Ф2 (TRIP-128): recompute trip dates whenever a transfer write changes
-- day_change or its endpoints — from ANY entry point (UI / AI segments / bot / direct SQL). [R3]
--
-- Why a DB trigger: transfers are written LIVE (EventEditDialog insert/update, AI multi-leg,
-- and the legacy save_trip_edit batch). A trigger guarantees the date cascade fires regardless
-- of the write path, which is exactly the "overnight transfer from anywhere" goal.
--
-- Safety (verified on dev 2026-06-11):
--   * recompute_trip writes ONLY city_visits; city_visits has NO triggers -> this trigger
--     cannot recurse (it never writes transfers).
--   * Independent of the other transfers triggers:
--       - sync_budget_expense (ROW AFTER ins/del/upd): only READS city_visits.city_name and
--         WRITES budget_expenses; never writes transfers/city_visits.
--       - notify_booking_added (STMT AFTER insert): writes notifications only.
--   * trg_recompute_transfer is SECURITY DEFINER so it keeps EXECUTE on recompute_trip
--     (which is revoked from authenticated) when fired by an authenticated writer.
--   * UPDATE fires recompute ONLY when day_change / from_city_visit_id / to_city_visit_id
--     change — editing carrier/price/notes does NOT shift dates. INSERT/DELETE always recompute
--     (a new/removed transfer can add/remove a gap). recompute_trip is idempotent, so even a
--     redundant fire is a no-op on an already-consistent chain.
--
-- NOTE: removing the client tmp-city guards (save_new_city_first / isTmpId in CityPanel,
-- openTransferRow, EventEditDialog) is intentionally part of Ф3, NOT here: under the current
-- draft-model client, unsaved cities still carry tmp- ids with no real uuid, so a transfer
-- cannot reference them yet. The guards drop when cities are created live (Ф3).

create or replace function public.trg_recompute_transfer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_trip uuid;
begin
  v_trip := coalesce(NEW.trip_id, OLD.trip_id);
  if v_trip is not null then
    perform public.recompute_trip(v_trip, null);
  end if;
  return null; -- AFTER trigger: return value is ignored
end;
$$;

drop trigger if exists trg_recompute_on_transfer_ins_del on public.transfers;
create trigger trg_recompute_on_transfer_ins_del
after insert or delete on public.transfers
for each row execute function public.trg_recompute_transfer();

drop trigger if exists trg_recompute_on_transfer_upd on public.transfers;
create trigger trg_recompute_on_transfer_upd
after update on public.transfers
for each row
when (old.day_change        is distinct from new.day_change
   or old.from_city_visit_id is distinct from new.from_city_visit_id
   or old.to_city_visit_id   is distinct from new.to_city_visit_id)
execute function public.trg_recompute_transfer();
