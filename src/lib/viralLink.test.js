// Pins the marks that viral links carry (TRIP-329).
//
// These four strings are the vocabulary every report is written against, so a
// silent rename is the failure mode worth a test: nothing breaks, the numbers
// just split in two and nobody notices for a month. The round-trip cases go
// further and feed the built link back through campaign.js — the two halves of
// the attribution layer are only useful if they agree on the parameter names.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VIRAL_MARKS, withViralMarks } from './viralLink.js';
import { readSignupAttribution, resolveCampaign } from './campaign.js';

const TRIP = '0f2a1c34-5b6d-4e7f-8a9b-0c1d2e3f4a5b';

test('the public trip link keeps its share token and gains the marks', () => {
  assert.equal(
    withViralMarks(`https://www.triplanio.com/public/trip/${TRIP}?t=tok123`, 'public_link', TRIP),
    `https://www.triplanio.com/public/trip/${TRIP}?t=tok123`
      + `&utm_source=trip_share&utm_medium=viral&utm_campaign=trip_${TRIP}`,
  );
});

test('a link without a query gets the marks behind a question mark', () => {
  assert.equal(
    withViralMarks('https://www.triplanio.com/join/tok', 'invite_link', TRIP),
    `https://www.triplanio.com/join/tok`
      + `?utm_source=trip_invite&utm_medium=viral&utm_campaign=trip_${TRIP}`,
  );
});

test('the mailed invite shares the source of the copied one but not the medium', () => {
  assert.equal(VIRAL_MARKS.invite_email.utm_source, VIRAL_MARKS.invite_link.utm_source);
  assert.equal(VIRAL_MARKS.invite_email.utm_medium, 'viral_email');
});

test('the share card puts its format in utm_content, the trip id in the campaign', () => {
  assert.equal(
    withViralMarks('https://www.triplanio.com/', 'share_card', TRIP, 'story'),
    `https://www.triplanio.com/`
      + `?utm_source=share_card&utm_medium=viral&utm_campaign=trip_${TRIP}&utm_content=story`,
  );
});

test('every kind carries the viral prefix — that filter is how paid stays clean', () => {
  for (const [kind, marks] of Object.entries(VIRAL_MARKS)) {
    assert.ok(marks.utm_medium.startsWith('viral'), `${kind} must be viral*`);
  }
});

// Fail open, never throw: a link that opens without a mark costs a row in a
// report, a link that fails to build costs the invite itself.
test('a missing trip id, an unknown kind or no url leave the address untouched', () => {
  const url = 'https://www.triplanio.com/join/tok';
  assert.equal(withViralMarks(url, 'invite_link', ''), url);
  assert.equal(withViralMarks(url, 'not_a_kind', TRIP), url);
  assert.equal(withViralMarks('', 'invite_link', TRIP), '');
});

test('round trip: what the link writes is what campaign.js reads back', () => {
  const search = withViralMarks('https://x/', 'public_link', TRIP).split('?')[1];

  assert.deepEqual(readSignupAttribution(`?${search}`), {
    signup_utm_source: 'trip_share',
    signup_utm_medium: 'viral',
    signup_utm_campaign: `trip_${TRIP}`,
  });
  assert.deepEqual(resolveCampaign(`?${search}`, null, 0).set, {
    camp_source: 'trip_share',
    camp_medium: 'viral',
    camp_campaign: `trip_${TRIP}`,
    camp_ts: new Date(0).toISOString(),
  });
});

test('trip_<uuid> fits the 300-char cap of the signup_utm_* columns', () => {
  assert.ok(`trip_${TRIP}`.length < 300);
});

// The edge functions build two of the four links and cannot import from src/,
// so the table lives twice. Drift between the copies is invisible everywhere
// else: both halves keep working, they just report under different names.
test('the Deno mirror declares exactly the same table', () => {
  const source = readFileSync(
    new URL('../../supabase/functions/_shared/viralLink.ts', import.meta.url),
    'utf8',
  );
  // Single quotes only, so a copy reformatted with double quotes fails loudly
  // here instead of going unparsed — an entry the regex silently skips would
  // deepEqual clean while the mirror carries a kind this file never saw.
  assert.equal(source.includes('"'), false, 'the mirror must stay single-quoted');

  const mirror = {};
  const entry = /(\w+):\s*\{\s*utm_source:\s*'([^']+)',\s*utm_medium:\s*'([^']+)'\s*\}/g;
  for (const [, kind, utm_source, utm_medium] of source.matchAll(entry)) {
    mirror[kind] = { utm_source, utm_medium };
  }
  assert.deepEqual(mirror, VIRAL_MARKS);
});
