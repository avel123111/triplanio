import { supabase } from '@/api/supabaseClient';

/**
 * Resolve IANA timezone for given coordinates via Google TimeZone API.
 * Returns the timezone string (e.g. "Europe/Madrid") or null if it fails.
 *
 * Use after the user picks an address in AddressAutocomplete:
 *   const tz = await resolveTimezoneFromCoords(latitude, longitude);
 */
export async function resolveTimezoneFromCoords(lat, lng) {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  try {
    const res = await supabase.functions.invoke('placesAutocomplete', {
      body: {
        action: 'timezone',
        lat,
        lng,
      },
    });
    return res?.data?.timeZoneId || null;
  } catch {
    return null;
  }
}