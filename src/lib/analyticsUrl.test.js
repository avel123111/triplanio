// Pins the cut that keeps a share token out of analytics (TRIP-330).
//
// This is a security control, and its failure mode is silent in both
// directions: too little and a working key to someone else's trip sits in an
// external store, too much and campaign reporting quietly reads zero. Neither
// shows up on the screen, so the test is the only thing that notices.
//
// The event below is the SHAPE of a real `public_trip_viewed` that leaked on
// production — the token lived in two properties, not the one the ticket named.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scrubUrlProperties, stripQueryFromUrl } from './analyticsUrl.js';

const TOKEN = 'f8f22b1f00000000000000000000000000000000';
const TRIP = '29feed0f-0000-0000-0000-000000000a07';
const SHARED = `https://www.triplanio.com/public/trip/${TRIP}?t=${TOKEN}`;

test('a leaked event loses the token from every address it carries', () => {
  const event = {
    event: 'public_trip_viewed',
    properties: {
      $current_url: SHARED,
      $session_entry_url: SHARED,
      $referrer: `https://www.triplanio.com/trips?t=${TOKEN}`,
      $session_entry_referrer: '$direct',
      $pathname: `/public/trip/${TRIP}`,
      $host: 'www.triplanio.com',
      $set: { $current_url: SHARED },
      $set_once: { $initial_current_url: SHARED, $initial_referrer: '$direct' },
    },
    $set: { $current_url: SHARED },
    $set_once: { $initial_current_url: SHARED },
  };

  scrubUrlProperties(event);

  assert.equal(JSON.stringify(event).includes(TOKEN), false, 'no bag may keep the token');
  // The path survives — without it the event says nothing about which screen.
  assert.equal(event.properties.$current_url, `https://www.triplanio.com/public/trip/${TRIP}`);
  assert.equal(event.properties.$session_entry_url, `https://www.triplanio.com/public/trip/${TRIP}`);
  assert.equal(event.properties.$set_once.$initial_current_url, `https://www.triplanio.com/public/trip/${TRIP}`);
  assert.equal(event.$set_once.$initial_current_url, `https://www.triplanio.com/public/trip/${TRIP}`);
});

// The other silent failure: campaign reporting reading zero. PostHog collects
// utm_* and gclid in a pass of its own and hands them over as SEPARATE
// properties, so cutting the address must not touch them.
test('campaign properties and non-address values are left alone', () => {
  const event = {
    event: 'landing_viewed',
    properties: {
      $current_url: 'https://www.triplanio.com/?utm_source=trip_share&utm_medium=viral',
      utm_source: 'trip_share',
      utm_medium: 'viral',
      utm_campaign: `trip_${TRIP}`,
      $session_entry_utm_source: 'trip_share',
      gclid: 'Cj0KCQ?not-a-url',
      camp_source: 'trip_share',
      $referrer: '$direct',
      trip_id: TRIP,
      participant_count: 3,
      is_pro: false,
      $unset: ['camp_source'],
    },
  };
  const before = { ...event.properties };

  scrubUrlProperties(event);

  assert.equal(event.properties.$current_url, 'https://www.triplanio.com/');
  for (const key of Object.keys(before)) {
    if (key === '$current_url') continue;
    assert.deepEqual(event.properties[key], before[key], `${key} must survive untouched`);
  }
});

test('the event is edited in place and never dropped', () => {
  const event = { event: 'x', properties: { $current_url: SHARED } };
  assert.equal(scrubUrlProperties(event), event);
  // PostHog calls this hook on shapes we do not control; a throw here would
  // take capture down entirely, because the SDK does not catch.
  assert.doesNotThrow(() => scrubUrlProperties(undefined));
  assert.doesNotThrow(() => scrubUrlProperties({}));
  assert.doesNotThrow(() => scrubUrlProperties({ properties: null, $set: 'not an object' }));
});

test('only absolute addresses are cut', () => {
  assert.equal(stripQueryFromUrl(SHARED), `https://www.triplanio.com/public/trip/${TRIP}`);
  assert.equal(stripQueryFromUrl('http://localhost:5173/trips?lens=chat'), 'http://localhost:5173/trips');
  // A path, a sentence or an id can all contain '?' and none of them is an
  // address — cutting them would corrupt event properties for nothing.
  assert.equal(stripQueryFromUrl('/public/trip/x?t=tok'), '/public/trip/x?t=tok');
  assert.equal(stripQueryFromUrl('why?'), 'why?');
  assert.equal(stripQueryFromUrl(42), 42);
  assert.equal(stripQueryFromUrl(null), null);
  assert.equal(stripQueryFromUrl(undefined), undefined);
});

// TRIP-328, stated here so it cannot be mistaken for covered: an OAuth return
// carries the tokens after '#', with no '?' anywhere, so this cut never sees
// them. That leak needs the SDK's own `disable_capture_url_hashes`.
test('the fragment is NOT covered by this cut', () => {
  const oauth = 'https://www.triplanio.com/trips#access_token=eyJ&refresh_token=rt';
  assert.equal(stripQueryFromUrl(oauth), oauth);
});
