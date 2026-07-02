// TRIP-165 · Canon inspector — public entry.
//
// Dev-only browser tool: pick one of the 10 typography canons for any text and
// preview it live; queued decisions export as a worklist for a PR. Loaded ONLY
// under `import.meta.env.DEV` from src/main.jsx, so it is dead-code-eliminated
// from production builds and never ships to users.
export { initCanonInspector } from './inspector.js';
