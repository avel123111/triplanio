import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = join(dirname(fileURLToPath(import.meta.url)), 'check-site-primitive-dup.mjs');

/** Прогнать гард на фикстурах (env-override путей); вернуть код выхода. */
function run(appCss, siteCss) {
  const dir = mkdtempSync(join(tmpdir(), 'dupguard-'));
  try {
    mkdirSync(join(dir, 'app'));
    mkdirSync(join(dir, 'site'));
    const appPath = join(dir, 'app', 'app.css');
    const sitePath = join(dir, 'site', 'site.css');
    writeFileSync(appPath, appCss);
    writeFileSync(sitePath, siteCss);
    try {
      execFileSync('node', [GUARD], {
        env: { ...process.env, APP_CSS_PATH: appPath, SITE_CSS_PATH: sitePath },
        stdio: 'pipe',
      });
      return 0;
    } catch (e) {
      return e.status ?? 1;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('зелёный: нет пересечения правил-одиночек', () => {
  const app = '.card { padding: 1px; }';
  const site = '.section--sheet { border-radius: 4px; }';
  assert.equal(run(app, site), 0);
});

test('★ КРАСНЫЙ: голый .card в site.css при .card-одиночке в app.css (мутация)', () => {
  const app = '.card { padding: 1px; min-height: 40px; }';
  const site = '.card { border-radius: 4px; }';
  assert.equal(run(app, site), 1);
});

test('зелёный: коллизия под маркером site-dup-exempt', () => {
  const app = '.card { padding: 1px; }';
  const site = '/* site-dup-exempt: card — один объект, зона даёт вариант */\n.card { border-radius: 4px; }';
  assert.equal(run(app, site), 0);
});

test('не ловит составные селекторы (только правило-одиночка)', () => {
  // app держит `.card` только в составном co-селекторе — это НЕ правило-одиночка,
  // коллизии нет, маркер не нужен.
  const app = '.t-body, .card .x { font-size: 1rem; }';
  const site = '.card { border-radius: 4px; }';
  assert.equal(run(app, site), 0);
});
