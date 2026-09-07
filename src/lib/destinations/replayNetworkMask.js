// Replay network hook (`session_recording.maskCapturedNetworkRequestFn`) — the
// SDK's own per-request callback, kept as a pure function so `node --test` can
// exercise it: posthog.js itself imports bundler-only entry points and cannot be
// loaded outside Vite.
//
// A request keeps its bodies only when it is one of OUR edge calls — same-origin
// `/api/<fn>` (edgeTransport.js). That is where `{ error, code }` of a refused
// save lives, i.e. the one payload a replay is opened to read. Everything else is
// recorded with URL / status / timing alone: `/auth/v1/token` of Supabase answers
// with access + refresh tokens, `/ingest` is PostHog itself (megabytes of
// snapshots), Mapbox / Storage carry bytes, not meaning.

// Relative names resolve against the document; `..` segments normalise, so
// `/api/../auth/v1/token` lands on `/auth/…` and counts as foreign — as does a
// name the URL parser cannot read at all.
function isEdgeCall(name, origin) {
  try {
    const url = new URL(name, origin);
    return url.origin === origin && url.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

/**
 * @template {{ name: string, requestBody?: string | null, responseBody?: string | null }} T
 * @param {T} data    the captured request, mutated in place (SDK contract)
 * @param {string} origin  `window.location.origin` of the recording document
 * @returns {T}
 */
export function keepEdgeBodiesOnly(data, origin) {
  if (!isEdgeCall(data.name, origin)) {
    data.requestBody = null;
    data.responseBody = null;
  }
  return data;
}
