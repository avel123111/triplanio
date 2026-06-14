-- city_visits.city_name_en: canonical English city name (resolved via LocationIQ
-- reverse with accept-language=en). The display `city_name` is localized to the
-- user's language ("Париж"); partner/referral links (Booking, Airbnb) and the
-- Stay22 address search need a stable English name ("Paris") regardless of locale.
-- Nullable; existing rows are backfilled by a one-off LocationIQ reverse pass.

alter table public.city_visits
  add column if not exists city_name_en text;
