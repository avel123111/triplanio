// Guards the TRIP-277 regression: warnings went missing after an AI parse.
//
// Nothing was wrong with the validation engine - it scored the issues correctly
// the whole time. They were dropped one step later, by the reveal filter: a
// create form only showed issues for fields the user had TOUCHED, and `touched`
// grows through human keystrokes alone. An AI parse writes the whole form in
// one go, so `touched` stayed empty and the form rendered no inline message, no
// field tint and no panel - on exactly the values a machine had just guessed.
//
// So the test pins the FILTER - the layer that zeroed the result - and pins it
// behaviourally ("a parsed create form shows its issues"), not by the shape of
// the expression, which is what silently lost the `aiParsed` term.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issuesToShow } from './validation.js';

const ISSUES = [
  { code: 'TR_DEP_DAY', level: 'warn', field: 'start' },
  { code: 'TR_ARR_DAY', level: 'warn', field: 'end' },
  { code: 'CITY_GAP', level: 'warn' }, // structural: no field to attach to
];

test('a parsed create form reveals its issues without any field being touched', () => {
  const shown = issuesToShow(ISSUES, {
    isEdit: false, submitted: false, aiParsed: true, touched: new Set(),
  });
  assert.deepEqual(
    shown.map((i) => i.code),
    ['TR_DEP_DAY', 'TR_ARR_DAY', 'CITY_GAP'],
    'After a parse the form must speak: the values came from a machine and '
    + '`touched` is empty by construction, so gating the display on it here is '
    + 'what hid warnings on AI-filled bookings.',
  );
});

test('an untouched create form stays quiet - before a parse and after undoing one', () => {
  // Same input covers both: "Undo parsing" restores the pre-parse snapshot and
  // drops aiState out of 'parsed', so the form is back to untouched/unparsed
  // and must fall silent - otherwise it keeps shouting about values it no
  // longer holds.
  const shown = issuesToShow(ISSUES, {
    isEdit: false, submitted: false, aiParsed: false, touched: new Set(),
  });
  assert.deepEqual(shown, [], 'A blank new form must not nag before any input.');
});

test('a touched field reveals only its own issue', () => {
  const shown = issuesToShow(ISSUES, {
    isEdit: false, submitted: false, aiParsed: false, touched: new Set(['start']),
  });
  assert.deepEqual(shown.map((i) => i.code), ['TR_DEP_DAY']);
});

test('edit and save-attempt reveal everything', () => {
  for (const state of [{ isEdit: true }, { submitted: true }]) {
    assert.equal(
      issuesToShow(ISSUES, { touched: new Set(), ...state }).length,
      ISSUES.length,
      `expected full reveal for ${JSON.stringify(state)}`,
    );
  }
});

test('touched accepts a plain array, not just a Set', () => {
  // Both current callers pass a Set, but the helper is shared - a caller
  // handing over an array must not silently show nothing (that failure mode is
  // invisible: no crash, just no warnings).
  const shown = issuesToShow(ISSUES, { touched: ['end'] });
  assert.deepEqual(shown.map((i) => i.code), ['TR_ARR_DAY']);
});

test('omitting touched gives the summary-panel case: all or nothing', () => {
  // The panel has no per-field notion — it is the same predicate with an empty
  // `touched`, which is why both callers get it from here instead of re-testing
  // the condition inline. Losing that is how the panel could have kept its own
  // stale copy of the rule while the fields got the fixed one.
  assert.deepEqual(issuesToShow(ISSUES, { aiParsed: true }), ISSUES);
  assert.deepEqual(issuesToShow(ISSUES, { submitted: true }), ISSUES);
  assert.deepEqual(issuesToShow(ISSUES, { isEdit: true }), ISSUES);
  assert.deepEqual(issuesToShow(ISSUES, {}), []);
});

test('missing options reveal nothing rather than throwing', () => {
  assert.deepEqual(issuesToShow(ISSUES), []);
  assert.deepEqual(issuesToShow(), []);
});
