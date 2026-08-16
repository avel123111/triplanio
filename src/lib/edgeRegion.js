// The region an edge function should EXECUTE in — decided ONCE, here (TRIP-374, Этап 5).
//
// Supabase Edge Functions run in the region nearest the CALLER by default. Our
// functions are DB-heavy: each does several edge→Postgres round-trips behind the
// `mutate` seam, so running far from the database dominates latency. Measured
// (dev, from Node): edge unpinned in us-west-1 986 ms vs edge pinned to the DB
// region eu-central-1 555 ms — the ~431 ms cross-region hop is pure penalty. The
// `x-region` request header pins execution to a chosen region; we pin every edge
// call to the region of the database it will talk to.
//
// The region is derived from the Supabase project ref in VITE_SUPABASE_URL, NOT
// from import.meta.env.PROD: every *.vercel.app preview is built in prod mode yet
// talks to the DEV backend, so a PROD-flag split would pin previews to the wrong
// region. Deriving from the URL means the pin always follows the actual backend.
//
// An unknown ref (self-hosted, localhost, a project that moved) returns null → no
// header → Supabase keeps its default nearest-caller routing. Fail-open on
// purpose: a wrong-but-present region is worse than an absent one.

// Project ref → AWS region of that project's database. The refs are already
// public (embedded in VITE_SUPABASE_URL in the shipped bundle), so listing them
// here leaks nothing. A project that changes region is a one-line edit.
const REGION_BY_REF = {
  nydhzevdizkfaxdlikgc: 'eu-central-1', // Triplanio dev
  tizscxrpuopobgcxbekf: 'eu-west-1',    // Triplanio prod
};

/**
 * The database region for a Supabase project URL, or null when the ref is
 * unknown. Pure (no env / DOM read) so it is unit-testable under `node --test`.
 *
 * @param {string|undefined|null} url  e.g. `https://<ref>.supabase.co`
 * @returns {string|null}
 */
export function regionForSupabaseUrl(url) {
  if (!url) return null;
  const ref = /^https?:\/\/([a-z0-9]+)\.supabase\./i.exec(url)?.[1];
  return (ref && REGION_BY_REF[ref]) || null;
}

// Resolved once at module load from THIS build's backend URL. Optional-chained
// because `import.meta.env` does not exist under `node --test` (same reason as
// reportDataError.js) — there it resolves to null and edgeRegionHeaders() is {}.
export const EDGE_REGION = regionForSupabaseUrl(import.meta.env?.VITE_SUPABASE_URL);

/**
 * Header bag that pins an edge invocation to the DB region, or {} when the region
 * is unknown. Spread into a `functions.invoke` options.headers.
 * @returns {Record<string, string>}
 */
export function edgeRegionHeaders() {
  return EDGE_REGION ? { 'x-region': EDGE_REGION } : {};
}
