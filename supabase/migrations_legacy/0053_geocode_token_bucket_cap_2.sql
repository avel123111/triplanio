-- TRIP-145 follow-up: align the geocode token bucket's BURST with LocationIQ's
-- own instantaneous limit.
--
-- Symptom: on a cold AI-planner batch (e.g. 6 cities, single user, no other
-- load) the middle 2 cities went red. The bucket caps the SUSTAINED rate at
-- p_rate (=2/s, matching LocationIQ Free), but p_cap=5 let a freshly-idle batch
-- spend up to ~4 tokens instantly (p_min=2 background): 4 upstream calls fired
-- back-to-back at ~3-4 req/s > LocationIQ's ~2 req/s rolling window → LocationIQ
-- itself 429'd the burst tail → those items came back empty and (until the edge
-- retry) silently went red. Proven live: with cap=5, 8 rapid take_geocode_token
-- calls granted 4 then denied.
--
-- Fix: lower p_cap 5 → 2. Now a cold batch spends at most 1 instant token, then
-- paces at p_rate (~2/s) — at/under LocationIQ's limit. Interactive (p_min=1)
-- still works; background (p_min=2) still yields to it. Pairs with the edge
-- batch-item retry (geoLocationiq) which absorbs any residual boundary 429.
-- Trade-off: a cold multi-city batch is ~1-2 s slower (paced from the first
-- request instead of bursting); correctness over a sub-2 s speedup. Original:
-- 0041_geocode_token_bucket.sql / 0048_geocode_token_bucket_self_seed.sql.
create or replace function public.take_geocode_token(
  p_min numeric default 1, p_rate numeric default 2, p_cap numeric default 2)
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
