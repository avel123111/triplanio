-- Free plan: at most 1 active trip, enforced server-side (backstop to the UI).
-- Pro users (active subscription) are unlimited. Both create paths (manual + AI)
-- call this RPC, so this covers all in-app creation.
-- Applied to prod (tizscxrpuopobgcxbekf) and dev (nydhzevdizkfaxdlikgc) on 2026-05-30.
create or replace function public.create_trip(p_title text, p_description text default '')
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid; v_trip_id uuid; v_is_pro boolean; v_active int;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Not authenticated'; end if;

  -- Pro = active subscription (mirrors getUserPlan). Pro users have no trip limit.
  select (u.subscription_status = 'pro'
          and u.subscription_end_date is not null
          and u.subscription_end_date > now())
    into v_is_pro
  from public.users u where u.id = v_uid;
  v_is_pro := coalesce(v_is_pro, false);

  if not v_is_pro then
    -- "Active" = no end_date yet, or end_date today/future. Past trips free the slot.
    select count(*) into v_active
    from public.trips
    where created_by = v_uid
      and (end_date is null or end_date >= current_date);
    if v_active >= 1 then
      raise exception 'TRIP_LIMIT_REACHED' using errcode = 'P0001';
    end if;
  end if;

  insert into public.trips (title, description, created_by)
  values (p_title, p_description, v_uid)
  returning id into v_trip_id;
  return v_trip_id;
end $$;
