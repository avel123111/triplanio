-- TRIP-314 — city photo column in the cities directory.
--
-- `cities` is a sparse affiliate/reference directory keyed on `geonameid` (the
-- city's geo identity lives in `geo_gazetteer` + the `city_visits.name_i18n`
-- snapshot, NOT here). This adds one flat column holding the URL of the city's
-- photo, mirroring `trips.cover_image_url` — same meaning (the entity's hero
-- image), so the name is reused rather than forked into a second one.
--
-- SCHEMA ONLY: the column ships empty. It is populated out-of-band by an n8n
-- workflow writing with the service-role key, which the tier-D grants on
-- `cities` already allow (write = service_role, `authenticated` reads) — no
-- grant or RLS change is needed here.
--
-- Type is the capped `url_text` domain (TRIP-169 input-integrity layer, ≤ 2048
-- chars) rather than raw text, so the bound is declared by the domain instead of
-- a hand-written CHECK.
--
-- No index: nothing looks a city up BY its photo. (`tripster_slug` / `sp8_slug`
-- carry partial indexes because those columns are lookup keys; this one is not.)
--
-- Read path: `_shared/tripPayload.ts` selects `cities.*`, so the column flows
-- into the bot/n8n payload automatically (NULL until the feed lands).
-- `getTripDetails` enumerates its columns, so the FE will not see the photo
-- until it is added to that select — done when a screen actually renders it.

ALTER TABLE public.cities
  ADD COLUMN IF NOT EXISTS cover_image_url public.url_text;

COMMENT ON COLUMN public.cities.cover_image_url IS
  'URL фото города. Наполняется n8n (service_role). TRIP-314.';
