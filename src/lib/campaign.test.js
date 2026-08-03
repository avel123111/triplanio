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
import { resolveCampaign, readSignupAttribution, pickSignupAttribution, campaignQuery, toInitialPersonProps, CAMPAIGN_TTL_MS } from './campaign.js';

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

// The signup columns are the only attribution that survives a cookie refusal,
// and the email path carries them through client-owned auth metadata straight
// into the INSERT that creates the user row — so the whitelist below is a trust
// boundary, not tidiness.
test('signup attribution is read from the query, capped, and never empty-string', () => {
  assert.deepEqual(
    readSignupAttribution('?utm_source=google&utm_medium=cpc&utm_campaign=ru_aug&gclid=xyz'),
    {
      signup_utm_source: 'google',
      signup_utm_medium: 'cpc',
      signup_utm_campaign: 'ru_aug',
      signup_gclid: 'xyz',
    },
  );
  assert.equal(readSignupAttribution(''), null);
  assert.equal(readSignupAttribution('?utm_source=%20%20'), null);
  // utm_content is deliberately absent — it has no column.
  assert.deepEqual(readSignupAttribution('?utm_content=stories'), null);
  // A lone medium still counts here, unlike the campaign mark: nothing else carries it.
  assert.deepEqual(readSignupAttribution('?utm_medium=email'), { signup_utm_medium: 'email' });
  assert.equal(readSignupAttribution(`?utm_source=${'x'.repeat(500)}`).signup_utm_source.length, 200);
});

test('attribution from client-owned metadata cannot smuggle other columns', () => {
  assert.deepEqual(
    pickSignupAttribution({ signup_utm_source: 'google', subscription_status: 'active', is_admin: true }),
    { signup_utm_source: 'google' },
  );
  assert.equal(pickSignupAttribution({ subscription_status: 'active' }), null);
  assert.equal(pickSignupAttribution(null), null);
  assert.equal(pickSignupAttribution('signup_utm_source=google'), null);
  assert.equal(pickSignupAttribution({ signup_gclid: { toString: () => 'evil' } }), null);
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

// The account's channel goes to two stores at once: `users.signup_utm_*` for
// everyone, and PostHog's own first-touch fields for whoever consented. A typo
// in a name here is silent — the report just shows an empty column forever, so
// the names are pinned literally rather than derived.
test('signup columns translate into the first-touch fields PostHog reads', () => {
  assert.deepEqual(
    toInitialPersonProps({
      signup_utm_source: 'trip_share',
      signup_utm_medium: 'viral',
      signup_utm_campaign: 'trip_7',
      signup_gclid: 'GC1',
    }),
    {
      $initial_utm_source: 'trip_share',
      $initial_utm_medium: 'viral',
      $initial_utm_campaign: 'trip_7',
      $initial_gclid: 'GC1',
    },
  );

  // A partial mark still says something — a lone medium is a channel we would
  // otherwise file under "direct".
  assert.deepEqual(
    toInitialPersonProps({ signup_utm_medium: 'viral_email' }),
    { $initial_utm_medium: 'viral_email' },
  );

  // Nothing to say → nothing sent, so an unattributed signup does not write
  // empty strings that would then be frozen by set_once.
  assert.equal(toInitialPersonProps(null), null);
  assert.equal(toInitialPersonProps(undefined), null);
  assert.equal(toInitialPersonProps({}), null);
  assert.equal(toInitialPersonProps({ signup_utm_source: '' }), null);
  // Columns we do NOT own must not leak into PostHog under an invented name.
  assert.equal(toInitialPersonProps({ id: 'u1', email: 'a@b.c' }), null);
});
