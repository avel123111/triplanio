// Pins region derivation for edge pinning (TRIP-374, Этап 5). The rule is
// invisible in the UI and only shows up as latency months later, so it needs a
// test: the region must follow the BACKEND URL (not the PROD flag), and an
// unknown backend must yield NO header rather than a wrong one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regionForSupabaseUrl, edgeRegionHeaders, EDGE_REGION } from './edgeRegion.js';

test('maps the dev project ref to its DB region', () => {
  assert.equal(regionForSupabaseUrl('https://nydhzevdizkfaxdlikgc.supabase.co'), 'eu-central-1');
});

test('maps the prod project ref to its DB region', () => {
  assert.equal(regionForSupabaseUrl('https://tizscxrpuopobgcxbekf.supabase.co'), 'eu-west-1');
});

test('a self-hosted / custom domain host still resolves by ref shape', () => {
  // Only the ref is matched, so a trailing path or a co domain variant is fine.
  assert.equal(regionForSupabaseUrl('https://tizscxrpuopobgcxbekf.supabase.in/rest/v1'), 'eu-west-1');
});

test('unknown ref → null (no header, keep default routing)', () => {
  assert.equal(regionForSupabaseUrl('https://someotherref123.supabase.co'), null);
});

test('missing / localhost URL → null', () => {
  assert.equal(regionForSupabaseUrl(undefined), null);
  assert.equal(regionForSupabaseUrl(''), null);
  assert.equal(regionForSupabaseUrl('http://localhost:54321'), null);
});

test('edgeRegionHeaders is {} under node (no import.meta.env) — fail-open', () => {
  // EDGE_REGION is resolved from import.meta.env?.VITE_SUPABASE_URL, which is
  // undefined under node, so the header bag must be empty, never a bad pin.
  assert.equal(EDGE_REGION, null);
  assert.deepEqual(edgeRegionHeaders(), {});
});
