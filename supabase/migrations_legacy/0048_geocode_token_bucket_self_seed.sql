-- TRIP-145: make take_geocode_token resilient to a missing bucket row.
-- The limiter lives in a single row (geocode_rate_bucket id=1). If that row ever
-- disappears (manual cleanup, a bad migration), the old function's SELECT found
-- nothing -> v_tokens NULL -> every call returned false -> ALL geocoding silently
-- degraded forever. Self-seed the row (full bucket) before reading it so the
-- limiter can never get stuck in a permanent-deny state. Idempotent: ON CONFLICT
-- DO NOTHING when the row already exists. Original: 0041_geocode_token_bucket.sql.
create or replace function public.take_geocode_token(
  p_min numeric default 1, p_rate numeric default 2, p_cap numeric default 5)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tokens  numeric;
  v_updated timestamptz;
  v_now     timestamptz := clock_timestamp();
  v_ok      boolean := false;
begin
  -- Ensure the singleton bucket exists (full) before locking it.
  insert into public.geocode_rate_bucket (id, tokens, updated_at)
  values (1, p_cap, v_now)
  on conflict (id) do nothing;

  select tokens, updated_at
    into v_tokens, v_updated
  from public.geocode_rate_bucket
  where id = 1
  for update;

  v_tokens := least(p_cap, v_tokens + extract(epoch from (v_now - v_updated)) * p_rate);

  if v_tokens >= p_min then
    v_tokens := v_tokens - 1;
    v_ok := true;
  end if;

  update public.geocode_rate_bucket
  set tokens = v_tokens, updated_at = v_now
  where id = 1;

  return v_ok;
end;
$function$;
