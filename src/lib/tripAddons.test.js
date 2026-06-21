import test from 'node:test';
import assert from 'node:assert/strict';
import { PRO_ONLY_ADDONS } from './tripAddons.js';

// Drift guard: the frontend Pro-addon list must stay identical to the edge
// mirror in supabase/functions/_shared/proAddons.ts (cross-runtime import isn't
// possible — Vite/JS vs Deno). If you change the Pro addon set, change BOTH and
// update this expectation.
test('PRO_ONLY_ADDONS is exactly budget/chat/telegram_assistant', () => {
  assert.deepEqual([...PRO_ONLY_ADDONS].sort(), ['budget', 'chat', 'telegram_assistant']);
});
