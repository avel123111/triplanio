#!/usr/bin/env node
/**
 * Tests for the two-design-system boundary guard (scripts/ci/check-ds-boundary.mjs,
 * TRIP-447 Ф2).
 *
 * A CI guard is code, so it gets a test (TRIP-282). The guard scans the working
 * tree (not a git diff), so each case builds a throwaway repo layout under the
 * paths the guard walks, runs the guard as a subprocess with cwd at that repo
 * root — exactly how CI will run it in Ф9 — and asserts the exit code. A green
 * test means nothing until the same assertion has been seen RED: the red cases
 * below (`code === 1`) are that proof.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { SITE_ZONE } from './zone-perimeter.mjs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('./check-ds-boundary.mjs', import.meta.url));

function put(dir, path, body) {
  const full = join(dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

/** Build a throwaway tree from { path: contents } and return its root dir. */
function fixture(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'ds-boundary-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [p, body] of Object.entries(files)) put(dir, p, body);
  return dir;
}

function run(dir) {
  // Периметр зоны — общий модуль (`zone-perimeter.mjs`), и в проде он требует
  // ВСЕХ своих путей: гард, смотрящий в пустую комнату, обязан падать, а не
  // отвечать «чисто». Фикстура же — два-три файла, поэтому периметр ей сужается
  // до того, что она РЕАЛЬНО создала; строгость самого предиката пинит отдельный
  // тест (`zone-perimeter.test.mjs`, «исчезнувший путь роняет кодом 2»).
  const here = SITE_ZONE.filter((rel) => existsSync(join(dir, rel)));
  const r = spawnSync(process.execPath, [GUARD], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, ZONE_PERIMETER: here.join(',') },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const SITE = 'src/components/site/Chrome.jsx';

/* ─────────────────────────────── the rule ───────────────────────────────── */

test('the one allowed design import (@/design/icons) → pass', (t) => {
  const dir = fixture(t, { [SITE]: "import { Icon } from '@/design/icons';\n" });
  assert.equal(run(dir).code, 0, run(dir).out);
});

test('an app-DS visual component (@/design/index) → fail', (t) => {
  const dir = fixture(t, { [SITE]: "import { Avatar } from '@/design/index';\n" });
  const r = run(dir);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /@\/design\/index/);
});

test('the bare @/design barrel → fail', (t) => {
  const dir = fixture(t, { [SITE]: "import { Btn } from '@/design';\n" });
  assert.equal(run(dir).code, 1, run(dir).out);
});

test('importing app.css → fail', (t) => {
  const dir = fixture(t, { [SITE]: "import '@/design/app.css';\n" });
  assert.equal(run(dir).code, 1, run(dir).out);
});

test('src/design (non-alias) form → fail', (t) => {
  const dir = fixture(t, { [SITE]: "import { Card } from 'src/design/index';\n" });
  assert.equal(run(dir).code, 1, run(dir).out);
});

/* ────────────── things that are NOT the app design system → pass ─────────── */

test('allowed neighbours (icons, MapView, lib, react) → pass', (t) => {
  const dir = fixture(t, {
    [SITE]: [
      "import React from 'react';",
      "import { Icon } from '@/design/icons';",
      "import MapView from '@/components/views/MapView';",
      "import { withVisitCampaign } from '@/lib/analytics';",
      '',
    ].join('\n'),
  });
  assert.equal(run(dir).code, 0, run(dir).out);
});

test('a lookalike alias (@/redesign) is not the design system → pass', (t) => {
  const dir = fixture(t, { [SITE]: "import { X } from '@/redesign/thing';\n" });
  assert.equal(run(dir).code, 0, run(dir).out);
});

/* ───────────────── scope: only the unauthenticated zone is judged ────────── */

test('the same forbidden import OUTSIDE the zone is not the guard’s business → pass', (t) => {
  // Зона в фикстуре ЕСТЬ и она чиста — иначе периметр вышел бы пустым, а пустой
  // периметр гард обязан считать отказом («смотрю в пустую комнату»), и тест
  // проверял бы не то, что заявлено.
  const dir = fixture(t, {
    [SITE]: "import { Icon } from '@/design/icons';\n",
    'src/pages/Account.jsx': "import { Avatar } from '@/design/index';\n",
  });
  assert.equal(run(dir).code, 0, 'the guard must only walk the site zone');
});

test('all three zone roots are walked (a Landing page violation is caught)', (t) => {
  const dir = fixture(t, { 'src/pages/Landing/LandingPage.jsx': "import { Btn } from '@/design/index';\n" });
  assert.equal(run(dir).code, 1, run(dir).out);
});

test('the PublicTrip.jsx file root is walked', (t) => {
  const dir = fixture(t, { 'src/pages/PublicTrip.jsx': "import { Avatar } from '@/design/index';\n" });
  assert.equal(run(dir).code, 1, run(dir).out);
});
