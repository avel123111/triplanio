-- TRIP-46: close anon read/write leak on RLS-disabled public tables.
--
-- public.n8n_chat_histories (AI-agent chat memory) and public.geocode_queue
-- (geocoding fair-queue) sit in the PostgREST-exposed `public` schema with
-- `GRANT ALL ... TO anon, authenticated` but RLS OFF -> the bundled anon key
-- can SELECT/INSERT/UPDATE/DELETE every row.
--
-- Fix mirrors the existing geocode_cache / geocode_rate_bucket pattern:
-- enable RLS with NO policies (default-deny). Consumers are unaffected because
-- they connect as bypassrls roles:
--   * n8n  -> direct Postgres user `postgres` (rolbypassrls = true, table owner)
--   * edge -> `service_role` (rolbypassrls = true), incl. SECURITY DEFINER
--             geocode RPCs owned by `postgres`
-- Only anon / authenticated (PostgREST) get denied. We deliberately do NOT add
-- FORCE ROW LEVEL SECURITY, so owner/bypassrls access is preserved.

ALTER TABLE public.n8n_chat_histories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.geocode_queue       ENABLE ROW LEVEL SECURITY;
