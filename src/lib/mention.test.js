import test from 'node:test';
import assert from 'node:assert/strict';
import { highlightMentions } from './mention.js';

// The boundary rule is now exercised through the surviving surface: whether the
// text renders a mention. Deciding whether to CALL the assistant left this
// module for the server (public.mentions_assistant, TRIP-296) — a paid call is
// not the client's to make.
const SPAN = /<span/;
function highlights(s) {
  return SPAN.test(highlightMentions(s));
}

test('matches a real mention anywhere in the message', () => {
  assert.ok(highlights('@Triplanio что не забронировано?'));
  assert.ok(highlights('ребят, @Triplanio подскажет'));
  assert.ok(highlights('спроси (@Triplanio) сам'));
  assert.ok(highlights('@triplanio'));
});

test('an address is NOT a mention — it used to fire the paid LLM call', () => {
  assert.equal(highlights('pavel@triplanio'), false);
  assert.equal(highlights('info@triplanio.com'), false);
});

test('a longer word is not a mention', () => {
  assert.equal(highlights('@TriplanioX'), false);
});

test('empty input is not a mention', () => {
  assert.equal(highlights(''), false);
  assert.equal(highlights(null), false);
});

test('repeated calls give the same answer (no shared lastIndex)', () => {
  const s = 'привет @Triplanio';
  assert.equal(highlights(s), true);
  assert.equal(highlights(s), true);
  assert.equal(highlights(s), true);
});

test('highlight wraps the mention and keeps the leading character', () => {
  const out = highlightMentions('да @Triplanio привет');
  assert.ok(out.includes('@Triplanio</span>'));
  assert.ok(out.startsWith('да <span'));
});

test('highlight escapes HTML and leaves non-mentions alone', () => {
  const out = highlightMentions('<b>x</b> pavel@triplanio');
  assert.ok(out.startsWith('&lt;b&gt;x&lt;/b&gt;'));
  assert.equal(out.includes('<span'), false);
});
