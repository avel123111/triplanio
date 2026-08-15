// The environment analytics runs in — decided ONCE, here (TRIP-407 PR2).
//
// The host split, the "is analytics enabled on this deploy" flag and the
// entry-URL snapshot used to be copied between consent.js and analytics.js. One
// copy is the source, everyone else imports it, so a new host or a changed flag
// is a one-line edit instead of two that drift apart. Nothing here touches
// PostHog or storage — those live in the destinations.
//
// Browser-only: `window` and `import.meta.env` are read at module load, so this
// runs under Vite, not `node --test` (the same reason analytics.js is not
// unit-imported). The node-safe seams the tests use are the dependency-free
// `campaign.js` / `consent-record.js`.

// The production split. One list, shared by every reader.
const PROD_HOSTS = new Set(['triplanio.com', 'www.triplanio.com']);

/** True only on the real production domains (apex + www). */
export const isProdHost = PROD_HOSTS.has(window.location.hostname);

// True local `vite dev` is the ONLY place without the vercel.json /ingest
// rewrite, so ingestion there must go to PostHog EU directly rather than the
// same-origin proxy every deployed host serves.
export const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);

// dev / preview stay silent by default so the single (free-tier) project isn't
// polluted by test traffic; enable with VITE_POSTHOG_ENABLE_DEV=true.
export const analyticsEnabledHere =
  isProdHost || ['1', 'true'].includes(import.meta.env.VITE_POSTHOG_ENABLE_DEV);

// The address this document was ENTERED on, snapshotted at module load. Campaign
// marks are read from this, never a live `window.location.search`: consent — and
// the read that needs the marks — arrives long after landing, by which point the
// address may have navigated away. Taken at the top level ON PURPOSE: inside a
// function it would capture whatever the URL is at call time, i.e. after the
// first client-side navigation (the trap this snapshot exists to avoid).
export const entrySearch = window.location.search;
