/**
 * Cover-image storage helper.
 *
 * Covers can be uploaded before a trip exists (create form / AI wizard), in
 * which case TripCoverPicker writes them to `_drafts/<uid>-<file>` in the
 * `trips` bucket. Once the trip is saved, finalizeDraftCover() moves the object
 * under the real `<tripId>/` prefix and re-signs the URL so the cover is keyed
 * to its trip (and swept by deleteTrip).
 */

import { supabase } from '@/api/supabaseClient';
import { TRIP_BUCKET, SIGNED_URL_TTL, DRAFT_PREFIX, parseStorageObjectUrl } from '@/lib/storage';

/**
 * If `coverImageUrl` points at a draft upload (`_drafts/…` in the trips
 * bucket), move the object under `<tripId>/` and return a fresh signed URL.
 * Returns the input unchanged for gradients, empty values, external URLs, or
 * already-final covers. Best-effort: on move/sign failure the original URL is
 * kept (the draft remains under `_drafts/` for the age-based sweep).
 *
 * @param {string} tripId
 * @param {string} coverImageUrl
 * @returns {Promise<string>} the cover URL to persist
 */
export async function finalizeDraftCover(tripId, coverImageUrl) {
  const parsed = parseStorageObjectUrl(coverImageUrl);
  if (!parsed || parsed.bucket !== TRIP_BUCKET) return coverImageUrl;
  if (!parsed.path.startsWith(`${DRAFT_PREFIX}/`)) return coverImageUrl;

  const basename = parsed.path.slice(parsed.path.indexOf('/') + 1); // <uid>-<file>
  const newPath = `${tripId}/${basename}`;

  const { error: moveErr } = await supabase.storage.from(TRIP_BUCKET).move(parsed.path, newPath);
  if (moveErr) { console.error('finalizeDraftCover: move failed', moveErr); return coverImageUrl; }

  const { data, error: signErr } = await supabase.storage.from(TRIP_BUCKET).createSignedUrl(newPath, SIGNED_URL_TTL);
  if (signErr || !data?.signedUrl) { console.error('finalizeDraftCover: sign failed', signErr); return coverImageUrl; }

  return data.signedUrl;
}
