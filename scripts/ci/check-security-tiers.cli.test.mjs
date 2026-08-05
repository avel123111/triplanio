#!/usr/bin/env node
/**
 * CLI-half tests for CI guard 2e (scripts/ci/check-security-tiers.mjs).
 *
 * WHY a second file. TRIP-274 exported `checkBucketPredicates` from the guard so
 * its decision logic could be unit-tested, which meant the guard had to stop
 * running itself on import. That premise cannot be tested from the file that
 * imports it: a module calling process.exit(0) at import time kills the runner
 * before the first test registers, and `node --test` then prints "pass 1,
 * fail 0" for the whole file — measured, not assumed. So the pin lives here,
 * where the guard is only ever a subprocess (the check-inline-styles.test.mjs
 * template: build the situation, run the guard, assert on what comes out).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GUARD = fileURLToPath(new URL('./check-security-tiers.mjs', import.meta.url));

test('импорт модуля ничего не исполняет и не завершает процесс', () => {
  const out = execFileSync(process.execPath, [
    '--input-type=module',
    '-e', `import(${JSON.stringify(pathToFileURL(GUARD).href)}).then((m) => console.log(typeof m.checkBucketPredicates));`,
  ], { encoding: 'utf8' });
  // Любой вывод гарда или его process.exit сюда не дадут дойти.
  assert.equal(out.trim(), 'function', 'гард исполнил себя на импорте');
});

test('прямой запуск без БД выполняет static-проверку манифеста', () => {
  const out = execFileSync(process.execPath, [GUARD], {
    encoding: 'utf8',
    env: { ...process.env, SECURITY_TIERS_DB_URL: '' }, // live-ассерт идёт пост-деплой
  });
  assert.match(out, /\[static\].*OK/);
});
