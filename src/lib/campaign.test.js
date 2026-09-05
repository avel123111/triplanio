// Pins the rules that make ad attribution honest (TRIP-316, TRIP-335).
//
// All of them are invisible in the UI and only show up as wrong numbers months
// later, which is exactly the kind of thing a test has to hold:
//   - LAST touch wins, so the second channel gets its own conversions instead
//     of the first click owning the person forever;
//   - the mark expires, so a click from half a year ago stops claiming today's
//     signups;
//   - the four projections of a mark (super-property, `users` column, PostHog's
//     first-touch name, the pass-through on an outgoing link) stay in step,
//     because they are derived from one table rather than written out by hand.
// Everything else here guards the door: the query string comes from a stranger.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMPAIGN_KEYS, CAMPAIGN_TTL_MS, campaignQuery, pickSignupMarks,
  readMarks, resolveCampaign, resolveSignupMarks,
} from './campaign.js';

const NOW = Date.parse('2026-07-30T12:00:00.000Z');
const iso = (ms) => new Date(ms).toISOString();

// What the app actually does: read the address, then decide.
const campaignFor = (search, stored, now) => resolveCampaign(readMarks(search), stored, now);
// The stored super-properties, as PostHog hands them back. A bare timestamp is
// the common case in these tests: nothing stored but the clock.
const at = (ts) => ({ camp_ts: ts });

test('a campaign link is captured with all eight marks plus a timestamp', () => {
  const r = campaignFor(
    '?utm_source=instagram&utm_medium=influencer&utm_campaign=travel_ru_aug&utm_content=stories_1'
      + '&gclid=abc123&gbraid=gb1&wbraid=wb1&oppref=gAAAA',
    null,
    NOW,
  );
  assert.deepEqual(r, {
    set: {
      camp_ts: iso(NOW),
      camp_source: 'instagram',
      camp_medium: 'influencer',
      camp_campaign: 'travel_ru_aug',
      camp_content: 'stories_1',
      camp_gclid: 'abc123',
      camp_gbraid: 'gb1',
      camp_wbraid: 'wb1',
      camp_oppref: 'gAAAA',
    },
  });
});

test('a gclid alone is a campaign: Google auto-tagging sends no utm at all', () => {
  const r = campaignFor('?gclid=Cj0KCQ', null, NOW);
  assert.equal(r.set.camp_gclid, 'Cj0KCQ');
  assert.equal(r.set.camp_source, undefined);
});

// TRIP-514: a network's click id is the ONLY thing its tag attributes by, and the
// tag reads it from the address of the page it is initialised on — not the landing
// page. So every click id is a mark that rides the address, and a paid click by
// itself, whatever else the URL carries.
test('a click id alone is a campaign, and rides the address on (gbraid / wbraid / oppref)', () => {
  for (const param of ['gbraid', 'wbraid', 'oppref']) {
    const r = campaignFor(`?${param}=x1`, null, NOW);
    assert.equal(r.set[`camp_${param}`], 'x1', param);
    assert.equal(campaignQuery(`?t=share_token&${param}=x1`), `${param}=x1`, param);
  }
});

test('last touch wins: a newer campaign replaces the one already stored', () => {
  const r = campaignFor('?utm_source=google&utm_campaign=ads_aug', at(iso(NOW - 1000)), NOW);
  assert.deepEqual(r, {
    set: { camp_ts: iso(NOW), camp_source: 'google', camp_campaign: 'ads_aug' },
  });
});

test('a plain visit keeps a mark that is still inside the 30-day window', () => {
  assert.equal(campaignFor('', at(iso(NOW - CAMPAIGN_TTL_MS + 60_000)), NOW), null);
});

test('a plain visit clears a mark older than the 30-day window', () => {
  assert.deepEqual(
    campaignFor('?lens=chat', at(iso(NOW - CAMPAIGN_TTL_MS - 60_000)), NOW),
    { clear: true },
  );
});

test('no campaign, no stored mark, nothing to do', () => {
  assert.equal(campaignFor('?t=share-token', null, NOW), null);
});

test('junk from the URL cannot poison the marks', () => {
  // Empty and whitespace-only values are not a campaign...
  assert.equal(campaignFor('?utm_source=%20&utm_campaign=', null, NOW), null);
  // ...an unreadable stored timestamp is ignored instead of clearing the mark...
  assert.equal(campaignFor('', at('not-a-date'), NOW), null);
  // ...and a value long enough to bloat every event is capped.
  const long = campaignFor(`?utm_campaign=${'x'.repeat(500)}`, null, NOW);
  assert.equal(long.set.camp_campaign.length, 200);
});

// ── The same click is one touch (TRIP-493) ──────────────────────────────────────
// `camp_ts` starts the 30-day last-touch window. Since the marks ride the address
// into the app, that address is reloaded all day — and a rewrite on every load
// would push the window's start forward forever, so the click would never expire.
test('the same click seen again writes nothing — the window does not restart', () => {
  const first = campaignFor('?utm_source=google&utm_campaign=ads_aug', null, NOW - 60_000);
  const again = campaignFor('?utm_source=google&utm_campaign=ads_aug', first.set, NOW);
  assert.equal(again, null);
});

test('a different mark still wins immediately — that is what last touch means', () => {
  const first = campaignFor('?utm_source=google&utm_campaign=ads_aug', null, NOW - 60_000);
  const second = campaignFor('?utm_source=instagram&utm_campaign=ads_aug', first.set, NOW);
  assert.deepEqual(second, {
    set: { camp_ts: iso(NOW), camp_source: 'instagram', camp_campaign: 'ads_aug' },
  });
});

test('the same source with one mark MORE is a different touch, not the same one', () => {
  // Sameness is judged on every mark, not on the source alone: a gclid arriving
  // where there was none is new information and must be stored.
  const first = campaignFor('?utm_source=google', null, NOW - 60_000);
  const second = campaignFor('?utm_source=google&gclid=Cj0KCQ', first.set, NOW);
  assert.equal(second.set.camp_gclid, 'Cj0KCQ');
});

test('the same marks with no stored timestamp are written, not skipped', () => {
  // Nothing stored means nothing to compare against — an empty jar is not
  // "already up to date", it is the first sight of this click.
  const r = campaignFor('?utm_source=google', { camp_source: 'google' }, NOW);
  assert.equal(r.set.camp_ts, iso(NOW));
});

// The border-crossing case (TRIP-335): by the time consent is given the address
// is long gone, and the marks come from whichever carrier survived the document
// being replaced. The decision must not depend on where they came from.
test('marks recovered after a redirect decide exactly like marks from the address', () => {
  const fromAddress = campaignFor('?utm_source=trip_share&utm_medium=viral', null, NOW);
  const recovered = resolveCampaign({ utm_source: 'trip_share', utm_medium: 'viral' }, null, NOW);
  assert.deepEqual(recovered, fromAddress);
});

test('the trigger is the mark itself, never the door it came through', () => {
  // A lone medium is recorded on the account but is NOT a campaign: without a
  // source, a campaign or a gclid there is no channel to credit.
  assert.equal(resolveCampaign({ utm_medium: 'viral' }, null, NOW), null);
  assert.equal(resolveCampaign(null, null, NOW), null);
  assert.equal(resolveCampaign({}, null, NOW), null);
});

// The signup columns are the only attribution that survives a cookie refusal,
// and the email path carries the marks through client-owned auth metadata
// straight into the INSERT that creates the user row — so the whitelist below is
// a trust boundary, not tidiness.
test('marks are read from the query, capped, and never empty-string', () => {
  assert.deepEqual(
    readMarks('?utm_source=google&utm_medium=cpc&utm_campaign=ru_aug&utm_content=hero&gclid=xyz'),
    {
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'ru_aug',
      utm_content: 'hero',
      gclid: 'xyz',
    },
  );
  assert.equal(readMarks(''), null);
  assert.equal(readMarks('?utm_source=%20%20'), null);
  assert.equal(readMarks('?t=share-token&lens=chat'), null);
  // No trigger rule here — a lone medium is still worth recording.
  assert.deepEqual(readMarks('?utm_medium=email'), { utm_medium: 'email' });
  assert.equal(readMarks(`?utm_source=${'x'.repeat(500)}`).utm_source.length, 200);
});

test('attribution from client-owned metadata cannot smuggle other columns', () => {
  assert.deepEqual(
    pickSignupMarks({ utm_source: 'google', subscription_status: 'active', is_admin: true }),
    { utm_source: 'google' },
  );
  assert.equal(pickSignupMarks({ subscription_status: 'active' }), null);
  assert.equal(pickSignupMarks(null), null);
  assert.equal(pickSignupMarks('utm_source=google'), null);
  assert.equal(pickSignupMarks({ gclid: { toString: () => 'evil' } }), null);
  // An INHERITED name is not a match either: every plain object answers to
  // `toString` and `constructor`, so a lookup table built without a null
  // prototype hands back a function here — truthy, and used as the output key.
  assert.equal(pickSignupMarks({ toString: 'evil', constructor: 'evil' }), null);
  // Same cap as every other reader — metadata is a stranger's input too.
  assert.equal(pickSignupMarks({ utm_source: 'x'.repeat(500) }).utm_source.length, 200);
});

// A confirmation email sent before the carrier changed shape is still sitting in
// someone's inbox. When that link is finally clicked the metadata carry the OLD
// spelling, and the channel must not be lost on the way in.
test('a payload written by the previous client is still understood', () => {
  assert.deepEqual(
    pickSignupMarks({ signup_utm_source: 'trip_share', signup_utm_medium: 'viral', signup_gclid: 'GC1' }),
    { utm_source: 'trip_share', utm_medium: 'viral', gclid: 'GC1' },
  );
  // Mixed spellings resolve to one vocabulary rather than two half-filled ones.
  assert.deepEqual(
    pickSignupMarks({ signup_utm_source: 'trip_share', utm_campaign: 'trip_7' }),
    { utm_source: 'trip_share', utm_campaign: 'trip_7' },
  );
});

// A mark only survives a full page load if it rides the address, and the address
// it is read from is the one place a live share token also sits — so what this
// pins is as much what does NOT get forwarded as what does.
test('a mark passed on to the next document keeps the marks and nothing else', () => {
  assert.equal(
    campaignQuery('?t=live_share_token&utm_source=trip_share&utm_medium=viral&utm_campaign=trip_7&lens=chat'),
    'utm_source=trip_share&utm_medium=viral&utm_campaign=trip_7',
  );
  // utm_content and gclid ride too — camp_content exists, and a paid click can
  // arrive on a public trip page as easily as on the landing.
  assert.equal(
    campaignQuery('?utm_content=stories_1&gclid=abc123'),
    'utm_content=stories_1&gclid=abc123',
  );
  // Empty, not '?': the caller hangs it off an address unchanged.
  assert.equal(campaignQuery('?t=live_share_token'), '');
  assert.equal(campaignQuery(''), '');
  // Same cap and trim as every other read of this query string.
  assert.equal(campaignQuery(`?utm_source=${'x'.repeat(500)}`).length, 'utm_source='.length + 200);
  assert.equal(campaignQuery('?utm_source=a%26b'), 'utm_source=a%26b');
});

// The point of deriving every dictionary from one table: a mark added tomorrow
// gets all its projections, or none — never a subset, the shape a hand-written map
// drifts into and nobody notices. After TRIP-407 the CLIENT projections are the
// persisted super-properties and the pass-through query; the `users.signup_utm_*`
// columns are written server-side (RPC create_user_profile) and first-touch is
// PostHog's own native block — both off the client, so neither is derived here.
test('every mark reaches both client projections, agreeing on the vocabulary', () => {
  const ALL = '?utm_source=a&utm_medium=b&utm_campaign=c&utm_content=d&gclid=e&gbraid=f&wbraid=g&oppref=h';
  const marks = readMarks(ALL);
  const params = Object.keys(marks);

  // Super-properties: one per mark, plus the timestamp that drives the window.
  const camp = resolveCampaign(marks, null, NOW).set;
  assert.deepEqual(Object.keys(camp).sort(), [...CAMPAIGN_KEYS].sort());
  assert.equal(Object.keys(camp).length, params.length + 1);

  // The pass-through carries the same set, under the parameter names.
  assert.deepEqual(new URLSearchParams(campaignQuery(ALL)), new URLSearchParams(marks));
});

// ── Which carrier owns a signup (TRIP-316/TRIP-335 follow-up) ────────────────────
// The rule that lost a real paid signup: the marks have to cross a document
// replacement (login → hard navigation to the app), and the ONLY carrier across
// that border was a sessionStorage stash — which a browser is free to refuse
// without telling anyone. Below is the decision, on a pure function, so the next
// break is a red test and not a quarter of ad spend filed under "organic".
const STASH = JSON.stringify({ utm_source: 'google', utm_campaign: '24192647759', gclid: 'CjwK' });

test('the address wins: a mark in the URL beats the stash it crossed with', () => {
  const r = resolveSignupMarks(readMarks('?utm_source=instagram&utm_campaign=aug'), STASH);
  assert.deepEqual(r.marks, { utm_source: 'instagram', utm_campaign: 'aug' });
});

test('a resolved signup spends the stash even when the ADDRESS won', () => {
  // The regression this pins: skip it and the stash outlives its signup, so the
  // NEXT person to register in the same tab inherits this click.
  const r = resolveSignupMarks(readMarks('?utm_source=instagram'), STASH);
  assert.equal(r.spendStash, true);
});

test('the stash carries the signup when the address lost its marks', () => {
  // Exactly the OAuth/One-Tap border: the app is re-entered on a bare `/trips`.
  const r = resolveSignupMarks(readMarks(''), STASH);
  assert.deepEqual(r.marks, { utm_source: 'google', utm_campaign: '24192647759', gclid: 'CjwK' });
  assert.equal(r.spendStash, true);
});

test('no address marks and no stash is not a signup to attribute', () => {
  const r = resolveSignupMarks(readMarks('?ref=friend'), null);
  assert.equal(r.marks, null);
  assert.equal(r.spendStash, false); // nothing stored → nothing to drop
});

test('a malformed stash is data, not a crash', () => {
  const r = resolveSignupMarks(null, '{not json');
  assert.equal(r.marks, null);
  assert.equal(r.spendStash, true); // it existed, so it is still spent
});

test('a stash cannot smuggle columns the address never could', () => {
  const r = resolveSignupMarks(null, JSON.stringify({ utm_source: 'google', is_pro_trip: true }));
  assert.deepEqual(r.marks, { utm_source: 'google' });
});
