// Pins the two rules that make ad attribution honest (TRIP-316).
//
// Both are invisible in the UI and only show up as wrong numbers months later,
// which is exactly the kind of thing a test has to hold:
//   - LAST touch wins, so the second channel gets its own conversions instead
//     of the first click owning the person forever;
//   - the mark expires, so a click from half a year ago stops claiming today's
//     signups.
// Everything else here guards the door: the query string comes from a stranger.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCampaign, CAMPAIGN_TTL_MS } from './campaign.js';

const NOW = Date.parse('2026-07-30T12:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();

test('a campaign link is captured with all five marks plus a timestamp', () => {
  const r = resolveCampaign(
    '?utm_source=instagram&utm_medium=influencer&utm_campaign=travel_ru_aug&utm_content=stories_1&gclid=abc123',
    null,
    NOW,
  );
  assert.deepEqual(r, {
    set: {
      camp_source: 'instagram',
      camp_medium: 'influencer',
      camp_campaign: 'travel_ru_aug',
      camp_content: 'stories_1',
      camp_gclid: 'abc123',
      camp_ts: iso(NOW),
    },
  });
});

test('a gclid alone is a campaign: Google auto-tagging sends no utm at all', () => {
  const r = resolveCampaign('?gclid=Cj0KCQ', null, NOW);
  assert.equal(r.set.camp_gclid, 'Cj0KCQ');
  assert.equal(r.set.camp_source, undefined);
});

test('last touch wins: a newer campaign replaces the one already stored', () => {
  const r = resolveCampaign('?utm_source=google&utm_campaign=ads_aug', iso(NOW - 1000), NOW);
  assert.deepEqual(r, {
    set: { camp_source: 'google', camp_campaign: 'ads_aug', camp_ts: iso(NOW) },
  });
});

test('a plain visit keeps a mark that is still inside the 30-day window', () => {
  assert.equal(resolveCampaign('', iso(NOW - CAMPAIGN_TTL_MS + 60_000), NOW), null);
});

test('a plain visit clears a mark older than the 30-day window', () => {
  assert.deepEqual(
    resolveCampaign('?lens=chat', iso(NOW - CAMPAIGN_TTL_MS - 60_000), NOW),
    { clear: true },
  );
});

test('no campaign, no stored mark, nothing to do', () => {
  assert.equal(resolveCampaign('?t=share-token', null, NOW), null);
});

test('junk from the URL cannot poison the marks', () => {
  // Empty and whitespace-only values are not a campaign...
  assert.equal(resolveCampaign('?utm_source=%20&utm_campaign=', null, NOW), null);
  // ...an unreadable stored timestamp is ignored instead of clearing the mark...
  assert.equal(resolveCampaign('', 'not-a-date', NOW), null);
  // ...and a value long enough to bloat every event is capped.
  const long = resolveCampaign(`?utm_campaign=${'x'.repeat(500)}`, null, NOW);
  assert.equal(long.set.camp_campaign.length, 200);
});
