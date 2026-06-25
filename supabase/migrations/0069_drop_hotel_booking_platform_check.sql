-- TRIP-75: drop hotel_stays_booking_platform_check.
--
-- The CHECK only allowed 8 platforms (booking/airbnb/hotels/expedia/agoda/
-- trivago/vrbo/other), but the app's catalog (src/lib/booking-platforms.js,
-- detectPlatformFromUrl) produces ~24 (kayak, skyscanner, sixt, hertz, kiwi…).
-- So a hotel whose booking_url points at e.g. kayak.com already fails this CHECK
-- on save — even without AI. The column is display-only: the logo is a favicon
-- built from booking_url (platformLogoUrl), and booking_platform only drives the
-- brand tint/label. It needs no closed enum. Keep the column, drop the CHECK.
--
-- payment_status CHECK is intentionally kept — it has 3 real states feeding
-- PaymentBadge; AI output is normalized client-side instead (handleHotelExtract).
ALTER TABLE public.hotel_stays
  DROP CONSTRAINT IF EXISTS hotel_stays_booking_platform_check;
