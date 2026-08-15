// Pins the branches that decide whether we may run analytics at all (TRIP-311).
//
// Every one of them ends in the same place — `null` means "no answer", so the
// app wipes PostHog's keys and asks again. They are invisible in the UI and a
// wrong `true` here is exactly the failure the whole ticket exists to prevent:
// tracking someone who never agreed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConsent, buildConsent, shouldSilenceOnConsentChange, CONSENT_VERSION, CONSENT_MAX_AGE_MS } from './consent-record.js';

const NOW = Date.parse('2026-07-30T12:00:00.000Z');
const stored = (record) => JSON.stringify(record);

test('a fresh answer is returned as given', () => {
  const record = buildConsent(true, NOW);
  assert.deepEqual(parseConsent(stored(record), NOW), {
    v: CONSENT_VERSION,
    ts: '2026-07-30T12:00:00.000Z',
    analytics: true,
    marketing: true,
  });
});

test('a refusal is an answer too — it must not read as "never asked"', () => {
  const record = buildConsent(false, NOW);
  const parsed = parseConsent(stored(record), NOW);
  assert.equal(parsed.analytics, false);
  assert.equal(parsed.marketing, false);
});

test('no record at all means no answer', () => {
  assert.equal(parseConsent(null, NOW), null);
  assert.equal(parseConsent('', NOW), null);
});

test('a record written by another version is re-asked', () => {
  const record = { ...buildConsent(true, NOW), v: CONSENT_VERSION + 1 };
  assert.equal(parseConsent(stored(record), NOW), null);
});

test('an answer older than the window is re-asked', () => {
  const record = buildConsent(true, NOW - CONSENT_MAX_AGE_MS - 1);
  assert.equal(parseConsent(stored(record), NOW), null);
});

test('an answer exactly at the window still counts', () => {
  const record = buildConsent(true, NOW - CONSENT_MAX_AGE_MS);
  assert.equal(parseConsent(stored(record), NOW).analytics, true);
});

test('a broken or hand-edited record is re-asked, never assumed', () => {
  assert.equal(parseConsent('{not json', NOW), null);
  assert.equal(parseConsent('null', NOW), null);
  assert.equal(parseConsent('"yes"', NOW), null);
  assert.equal(parseConsent(stored({ v: CONSENT_VERSION, analytics: true }), NOW), null);
  assert.equal(parseConsent(stored({ v: CONSENT_VERSION, ts: 'whenever', analytics: true }), NOW), null);
});

test('a truthy value that is not `true` does not become consent', () => {
  const record = { ...buildConsent(false, NOW), analytics: 'true', marketing: 1 };
  const parsed = parseConsent(stored(record), NOW);
  assert.equal(parsed.analytics, false);
  assert.equal(parsed.marketing, false);
});

// Variant B (TRIP-407): a cross-tab consent change silences THIS tab only when it
// was persisting to the device. The trap Pavel flagged — under B the client runs
// in every tab from load, so keying on "is analytics ready" would clear/reload a
// memory-only tab that wrote nothing.
test('a memory-only tab (not persisting) is NOT silenced on a foreign refusal', () => {
  const refusal = parseConsent(stored(buildConsent(false, NOW)), NOW);
  assert.equal(shouldSilenceOnConsentChange(false, refusal), false);
});

test('a persisting tab IS silenced when another tab refuses / withdraws', () => {
  const refusal = parseConsent(stored(buildConsent(false, NOW)), NOW);
  assert.equal(shouldSilenceOnConsentChange(true, refusal), true);
  // An unusable/expired new value parses to null — still "no longer a grant".
  assert.equal(shouldSilenceOnConsentChange(true, null), true);
});

test('a foreign GRANT never silences (one-way), whatever this tab is doing', () => {
  const grant = parseConsent(stored(buildConsent(true, NOW)), NOW);
  assert.equal(shouldSilenceOnConsentChange(true, grant), false);
  assert.equal(shouldSilenceOnConsentChange(false, grant), false);
});
