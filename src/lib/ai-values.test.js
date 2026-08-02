// The AI parse trust boundary (TRIP-277) - see lib/ai-values.js for why the
// gate asks about shape instead of matching placeholder prose.
//
// The regression: the parser carried three divergent copies of "is this value
// real?" - the hotel path compared against the literal "N/A", the single-leg
// transfer path checked nothing, the multi-leg path used a bare `|| ''`, so
// transfers were the ones showing garbage. Collapsing them onto one literal was
// not enough either - a real booking came back with `"phone": "Not provided"`.
//
// These tests pin the two halves of the contract: typed fields reject anything
// that could not be one of them, free-text fields pass through untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { aiField } from './ai-values.js';

const SRC = fileURLToPath(new URL('..', import.meta.url));

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.jsx?$/.test(entry) && !/\.test\.js$/.test(entry) ? [full] : [];
  });
}

test('the AI merge surface hardcodes no placeholder string - the gate is shape-based', () => {
  // Scoped to the files that call the gate, so it follows the code if the merge
  // surface grows and does not trip over an unrelated literal elsewhere.
  const sites = [];
  for (const file of sourceFiles(SRC)) {
    const src = readFileSync(file, 'utf8');
    if (!/\baiField\s*\(/.test(src)) continue;
    src.split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // comments may mention them
      if (/['"](N\/A|n\/a|not provided|not available|unknown|не указано)['"]/i.test(line)) {
        sites.push(`${relative(SRC, file)}:${i + 1}`);
      }
    });
  }
  assert.deepEqual(
    sites,
    [],
    'A placeholder literal is back on the AI merge path. Matching prose cannot '
    + 'work - "Not provided" already slipped past a prompt that banned six '
    + 'synonyms. Add a shape in lib/ai-values.js instead.',
  );
});

test('typed fields drop prose the model uses to report absence', () => {
  for (const junk of ['N/A', 'n/a', 'Not provided', 'Not available', 'unknown', 'не указано', '-', '—']) {
    assert.equal(aiField('phone', junk), null, `phone accepted ${junk}`);
    assert.equal(aiField('email', junk), null, `email accepted ${junk}`);
    assert.equal(aiField('booking_url', junk), null, `booking_url accepted ${junk}`);
    assert.equal(aiField('price', junk), null, `price accepted ${junk}`);
    assert.equal(aiField('currency', junk), null, `currency accepted ${junk}`);
  }
});

test('typed fields keep real values', () => {
  assert.equal(aiField('phone', '+7 812 000-00-00'), '+7 812 000-00-00');
  assert.equal(aiField('email', 'stay@astoria.example'), 'stay@astoria.example');
  assert.equal(aiField('booking_url', 'https://airbnb.com/trips/v1/x'), 'https://airbnb.com/trips/v1/x');
  assert.equal(aiField('price', 734.98), '734.98');
  assert.equal(aiField('price', '320,50'), '320,50'); // comma decimal is a number
  assert.equal(aiField('currency', 'EUR'), 'EUR');
  assert.equal(aiField('free_cancellation_until_local', '2026-08-20T15:00'), '2026-08-20T15:00');
});

test('a link must carry a scheme - normalizeExternalUrl would have invented one', () => {
  // That helper prepends "https://" to any string, so routing the parse through
  // it would turn "Not provided" into a clickable link. Hence a real test here.
  assert.equal(aiField('booking_url', 'Not provided'), null);
  assert.equal(aiField('booking_url', 'www.booking.com/x'), null);
  assert.equal(aiField('booking_url', 'ftp://booking.com/x'), null);
});

test('a half-formed datetime is dropped rather than blanking the input', () => {
  // `datetime-local` cannot hold an invalid value: it clears itself, so junk
  // here reads to the user as "the AI wiped my date".
  assert.equal(aiField('free_cancellation_until_local', '2026-08-20'), null);
  assert.equal(aiField('free_cancellation_until_local', 'Not provided'), null);
});

test('free-text fields pass through - they have no shape to check', () => {
  // "N/A" is a legal hotel name. Dropping it here would hide from the user that
  // the model answered at all; it lands tinted, in the review step, editable.
  assert.equal(aiField('name', 'N/A'), 'N/A');
  assert.equal(aiField('carrier', 'Not provided'), 'Not provided');
  assert.equal(aiField('booking_reference', 'HMYDZFDKQT'), 'HMYDZFDKQT');
});

test('absent and blank are always dropped, whatever the field', () => {
  for (const key of ['name', 'phone', 'price', 'carrier']) {
    assert.equal(aiField(key, null), null);
    assert.equal(aiField(key, undefined), null);
    assert.equal(aiField(key, ''), null);
    assert.equal(aiField(key, '   '), null);
  }
});

test('values are trimmed, so whitespace never reaches the form', () => {
  assert.equal(aiField('name', '  Memmo Alfama  '), 'Memmo Alfama');
  assert.equal(aiField('currency', ' EUR '), 'EUR');
});

test('an unknown field name is treated as free text, not silently dropped', () => {
  // A new field added to the parser must not vanish just because nobody
  // registered a shape for it - the fallback has to be "pass through".
  assert.equal(aiField('some_new_field', 'whatever'), 'whatever');
});
