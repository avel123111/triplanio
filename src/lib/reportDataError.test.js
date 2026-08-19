import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTags, reportDataError, report, reportAuthError } from './reportDataError.js';

// supabase-js error shapes reused from the seam's classifier contract.
const pgErr = (code) => Object.assign(new Error('pg'), { code, details: null, hint: null });
const statusErr = (status) => Object.assign(new Error('auth'), { status });

// ── buildTags: surface is the domain, and it is the ONLY surface ────────────────
test('buildTags carries surface as the failing domain', () => {
	for (const surface of ['data', 'auth', 'storage', 'realtime']) {
		const tags = buildTags(new Error('x'), { surface });
		assert.equal(tags.surface, surface);
	}
});

test('buildTags emits no legacy constant tags (no frontend, no layer)', () => {
	const tags = buildTags(new Error('x'), { surface: 'auth' });
	assert.notEqual(tags.surface, 'frontend');
	assert.ok(!('layer' in tags), 'layer tag must be collapsed');
});

test('buildTags omits optional refinements when absent', () => {
	const tags = buildTags(new Error('x'), { surface: 'realtime' });
	assert.deepEqual(Object.keys(tags), ['surface']);
});

test('buildTags adds source, status, db_code and query when present', () => {
	const err = Object.assign(pgErr('42501'), { status: undefined });
	const tags = buildTags(err, { surface: 'data', source: 'write', key: ['events', 'trip-1'] });
	assert.equal(tags.source, 'write');
	assert.equal(tags.db_code, '42501');
	assert.equal(tags.query, 'events'); // only the first key segment, never the id
});

test('buildTags reads a numeric auth/storage status', () => {
	const tags = buildTags(statusErr(503), { surface: 'auth' });
	assert.equal(tags.status, '503');
});

// ── report / reportDataError: safe under node, dedup by __seamHandled ───────────
test('report is a no-op for a falsy error and never throws', () => {
	assert.doesNotThrow(() => report(null, { surface: 'auth' }));
	assert.doesNotThrow(() => report(undefined, { surface: 'data' }));
});

test('report stamps __seamHandled so a re-report is skipped', () => {
	const err = new Error('boom');
	report(err, { surface: 'storage' });
	assert.equal(err.__seamHandled, true);
	// second call short-circuits on the stamp — still no throw under node.
	assert.doesNotThrow(() => report(err, { surface: 'storage' }));
});

test('reportDataError keeps the legacy (error, source, key) signature', () => {
	const err = new Error('legacy');
	assert.doesNotThrow(() => reportDataError(err, 'query', ['home']));
	assert.equal(err.__seamHandled, true);
});

// ── reportAuthError: expected 4xx skipped, real failures reported ───────────────
test('reportAuthError skips an expected 4xx (wrong password) — not stamped', () => {
	const wrongPassword = statusErr(400);
	reportAuthError(wrongPassword, 'signin');
	// Skipped before report() → never stamped, so it stays fully "unhandled".
	assert.ok(!wrongPassword.__seamHandled, 'expected 4xx must not be reported');
});

test('reportAuthError skips 401/422/429 (auth flow outcomes)', () => {
	for (const status of [401, 422, 429]) {
		const e = statusErr(status);
		reportAuthError(e, 'signin');
		assert.ok(!e.__seamHandled, `status ${status} must be treated as expected`);
	}
});

test('reportAuthError reports a 5xx (auth backend down)', () => {
	const down = statusErr(503);
	reportAuthError(down, 'signin');
	assert.equal(down.__seamHandled, true);
});

test('reportAuthError reports a statusless failure (GoTrue unreachable)', () => {
	const offline = new Error('Failed to fetch');
	reportAuthError(offline, 'oauth');
	assert.equal(offline.__seamHandled, true);
});

test('reportAuthError is a no-op for a falsy error', () => {
	assert.doesNotThrow(() => reportAuthError(null, 'signin'));
	assert.doesNotThrow(() => reportAuthError(undefined));
});
