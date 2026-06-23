-- 0065_geocode_fair_queue
--
-- Fair FIFO admission in front of the LocationIQ token bucket (TRIP-145 P2
-- follow-up). The bucket (take_geocode_token) is a rate limiter, not a queue:
-- under contention every waiter polls independently and the over-capacity ones
-- each time out and degrade RANDOMLY. This adds a ticket queue so waiters are
-- served in arrival order — interactive (autocomplete / manual search) ahead of
-- background (AI batch, booking-address resolve), FIFO within a priority. A
-- waiter that can't reach the head + a free token before its request deadline
-- still degrades (the 2 req/s ceiling and the edge wall-clock are unchanged) —
-- but deterministically and fairly, not at random.
--
-- Bucket refill math is preserved from take_geocode_token:
--   tokens := least(cap, tokens + elapsed_seconds * rate)   (rate=2, cap=2)

create table if not exists public.geocode_queue (
  id          bigserial primary key,
  priority    int not null,            -- 1 = interactive (served first), 2 = background
  enqueued_at timestamptz not null default now()
);
create index if not exists geocode_queue_order_idx on public.geocode_queue (priority, id);

-- Enqueue: take a ticket. Lower priority number is served first.
create or replace function public.geocode_enqueue(p_priority int)
returns bigint
language sql
security definer
set search_path to 'public'
as $$
  insert into public.geocode_queue (priority)
  values (greatest(1, coalesce(p_priority, 2)))
  returning id;
$$;

-- Dequeue: give up the slot (called when a waiter hits its deadline). Serving
-- deletes the ticket itself, so the success path never needs this.
create or replace function public.geocode_dequeue(p_ticket bigint)
returns void
language sql
security definer
set search_path to 'public'
as $$
  delete from public.geocode_queue where id = p_ticket;
$$;

-- Try to serve one ticket: only the queue head (by priority, then FIFO) may take
-- a token, and only if the refilled bucket has >= p_min. Bucket row FOR UPDATE
-- serializes all serve calls so head selection + token spend are atomic.
create or replace function public.geocode_serve_fair(
  p_ticket bigint,
  p_min    numeric default 1,
  p_rate   numeric default 2,
  p_cap    numeric default 2
) returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tokens  numeric;
  v_updated timestamptz;
  v_now     timestamptz := clock_timestamp();
  v_head    bigint;
begin
  insert into public.geocode_rate_bucket (id, tokens, updated_at)
  values (1, p_cap, v_now)
  on conflict (id) do nothing;

  select tokens, updated_at into v_tokens, v_updated
  from public.geocode_rate_bucket where id = 1 for update;

  -- Drop abandoned waiters (edge isolate died without dequeuing). TTL (60s)
  -- exceeds the longest request budget (20s) so a LIVE waiter is never swept.
  delete from public.geocode_queue where enqueued_at < v_now - interval '60 seconds';

  -- Refill regardless of outcome so tokens accrue while callers wait.
  v_tokens := least(p_cap, v_tokens + extract(epoch from (v_now - v_updated)) * p_rate);

  -- Fair head: interactive (priority 1) outranks background (2); FIFO within.
  select id into v_head from public.geocode_queue order by priority asc, id asc limit 1;

  if v_head is not null and v_head = p_ticket and v_tokens >= p_min then
    v_tokens := v_tokens - 1;
    delete from public.geocode_queue where id = p_ticket;
    update public.geocode_rate_bucket set tokens = v_tokens, updated_at = v_now where id = 1;
    return true;
  end if;

  update public.geocode_rate_bucket set tokens = v_tokens, updated_at = v_now where id = 1;
  return false;
end;
$$;

revoke all on function public.geocode_enqueue(int)            from public, anon;
revoke all on function public.geocode_dequeue(bigint)         from public, anon;
revoke all on function public.geocode_serve_fair(bigint, numeric, numeric, numeric) from public, anon;
grant execute on function public.geocode_enqueue(int)            to service_role;
grant execute on function public.geocode_dequeue(bigint)         to service_role;
grant execute on function public.geocode_serve_fair(bigint, numeric, numeric, numeric) to service_role;
