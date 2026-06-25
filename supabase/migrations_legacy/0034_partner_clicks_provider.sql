-- Add an affiliate-network attribution column to partner_clicks.
-- `partner` = the brand the user clicked through to (booking, airalo, yesim, ...).
-- `provider` = the affiliate network the click is monetized through, when any:
--   * travelpayouts — eSIM (airalo, yesim) and insurance (ektatraveling) links
--   * stay22        — Booking.com stays rendered in the hotel fork Stay22 list
--   * NULL          — non-affiliate direct search links (Booking search, Airbnb,
--                     Skyscanner, Omio, Kiwi, Rentalcars, DiscoverCars, SafetyWing)
-- Nullable; existing rows stay NULL (no backfill).
ALTER TABLE public.partner_clicks ADD COLUMN IF NOT EXISTS provider text;
