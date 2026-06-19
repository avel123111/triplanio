-- TRIP-145 (P2): shared Postgres token bucket for the single-key LocationIQ
-- rate limit (Free ~2 req/s).
--
-- geoLocationiq is the one gateway all geocoding passes through (manual city
-- search, address autocomplete, AI-planner batch resolve, booking-address
-- resolve, layover resolve). Edge isolates are stateless per invocation, so the
-- limiter must live in Postgres (shared across all invocations + all browsers),
-- not in memory. The edge takes a token ONLY before a real upstream call (cache
-- hits never reach the bucket).
--
-- Priority via p_min: interactive callers (autocomplete, manual search) pass
-- p_min = 1 and may drain the bucket to zero; background callers (AI batch,
-- booking-address resolve) pass p_min = 2 so they only consume a token when
-- there is headroom, leaving tokens for the user-facing path.
--
-- Access path: edge functions only, via the service-role client (the function
-- is SECURITY DEFINER; the table is RLS-on with no policies).

CREATE TABLE IF NOT EXISTS public.geocode_rate_bucket (
  id          integer     PRIMARY KEY DEFAULT 1,
  tokens      numeric     NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT geocode_rate_bucket_singleton CHECK (id = 1)
);

-- Seed the single bucket row.
INSERT INTO public.geocode_rate_bucket (id, tokens, updated_at)
VALUES (1, 0, now())
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.geocode_rate_bucket ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: only the service-role edge client touches this table.

-- Atomically refill the bucket proportional to elapsed time (capped at p_cap)
-- and try to take one token. Returns true if a token was taken (caller may go
-- upstream), false if the bucket is below p_min (caller should wait/retry or
-- degrade). The single-row FOR UPDATE serializes concurrent invocations.
CREATE OR REPLACE FUNCTION public.take_geocode_token(
  p_min  numeric DEFAULT 1,   -- threshold/headroom (interactive=1, background=2)
  p_rate numeric DEFAULT 2,   -- tokens refilled per second (LocationIQ Free ~2 req/s)
  p_cap  numeric DEFAULT 5    -- max burst capacity
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tokens  numeric;
  v_updated timestamptz;
  v_now     timestamptz := clock_timestamp();
  v_ok      boolean := false;
BEGIN
  SELECT tokens, updated_at
    INTO v_tokens, v_updated
  FROM public.geocode_rate_bucket
  WHERE id = 1
  FOR UPDATE;

  -- Time-based refill, capped.
  v_tokens := least(p_cap, v_tokens + EXTRACT(EPOCH FROM (v_now - v_updated)) * p_rate);

  IF v_tokens >= p_min THEN
    v_tokens := v_tokens - 1;  -- always take exactly one; p_min is the threshold, not the amount
    v_ok := true;
  END IF;

  UPDATE public.geocode_rate_bucket
  SET tokens = v_tokens, updated_at = v_now
  WHERE id = 1;

  RETURN v_ok;
END;
$$;
