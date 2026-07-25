import test from 'node:test';
import assert from 'node:assert/strict';
import { mentionsTriplanio, highlightMentions } from './mention.js';

test('matches a real mention anywhere in the message', () => {
  assert.ok(mentionsTriplanio('@Triplanio что не забронировано?'));
  assert.ok(mentionsTriplanio('ребят, @Triplanio подскажет'));
  assert.ok(mentionsTriplanio('спроси (@Triplanio) сам'));
  assert.ok(mentionsTriplanio('@triplanio'));
});

test('an address is NOT a mention — it used to fire the paid LLM call', () => {
  assert.equal(mentionsTriplanio('pavel@triplanio'), false);
  assert.equal(mentionsTriplanio('info@triplanio.com'), false);
});

test('a longer word is not a mention', () => {
  assert.equal(mentionsTriplanio('@TriplanioX'), false);
});

test('empty input is not a mention', () => {
  assert.equal(mentionsTriplanio(''), false);
  assert.equal(mentionsTriplanio(null), false);
});

test('repeated calls give the same answer (no shared lastIndex)', () => {
  const s = 'привет @Triplanio';
  assert.equal(mentionsTriplanio(s), true);
  assert.equal(mentionsTriplanio(s), true);
  assert.equal(mentionsTriplanio(s), true);
});

test('highlight wraps the mention and keeps the leading character', () => {
  const out = highlightMentions('да @Triplanio привет');
  assert.ok(out.includes('>@Triplanio</span>'));
  assert.ok(out.startsWith('да <span'));
});

test('highlight escapes HTML and leaves non-mentions alone', () => {
  const out = highlightMentions('<b>x</b> pavel@triplanio');
  assert.ok(out.startsWith('&lt;b&gt;x&lt;/b&gt;'));
  assert.equal(out.includes('<span'), false);
});
