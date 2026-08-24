import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = join(dirname(fileURLToPath(import.meta.url)), 'check-site-primitive-dup.mjs');

/** Прогнать гард на фикстурах (env-override путей); вернуть код выхода.
 *  markup — необязательная разметка зоны (JSX-строка) для второй проверки. */
function run(appCss, siteCss, markup = '') {
  const dir = mkdtempSync(join(tmpdir(), 'dupguard-'));
  try {
    mkdirSync(join(dir, 'app'));
    mkdirSync(join(dir, 'site'));
    mkdirSync(join(dir, 'markup'));
    const appPath = join(dir, 'app', 'app.css');
    const sitePath = join(dir, 'site', 'site.css');
    writeFileSync(appPath, appCss);
    writeFileSync(sitePath, siteCss);
    writeFileSync(join(dir, 'markup', 'Zone.jsx'), markup);
    try {
      execFileSync('node', [GUARD], {
        env: {
          ...process.env,
          APP_CSS_PATH: appPath,
          SITE_CSS_PATH: sitePath,
          ZONE_MARKUP_DIRS: join(dir, 'markup'),
        },
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

// ── Вторая проверка: имя разметки, app-база-одиночка, site БЕЗ базы (п.3 ревью) ──

test('★ КРАСНЫЙ: .btn в разметке, база-одиночка в app, а site даёт только состояние (мутация)', () => {
  const app = '.btn { padding: 13px 24px; border-radius: 99px; }';
  const site = '.btn:active { transform: scale(.97); }'; // состояние, не база
  const markup = '<a className="btn btn-primary">x</a>';
  assert.equal(run(app, site, markup), 1);
});

test('зелёный: та же утечка закрыта базой прототипа в site + site-dup-exempt', () => {
  const app = '.btn { padding: 13px 24px; }';
  const site = '/* site-dup-exempt: btn — вариант объекта */\n.btn { padding: 13px 24px; border-radius: 99px; }';
  const markup = '<a className="btn">x</a>';
  assert.equal(run(app, site, markup), 0);
});

test('зелёный: имя покрыто scoped-правилом зоны под site-base-exempt', () => {
  const app = '.num { font-variant-numeric: tabular-nums; }';
  const site = '/* site-base-exempt: num — покрыт scoped .stat-box .num */\n.stat-box .num { font-size: 30px; }';
  const markup = '<div className="stat-box"><div className="num">0</div></div>';
  assert.equal(run(app, site, markup), 0);
});

test('не флагует имя разметки, которого нет базой-одиночкой в app', () => {
  const app = '.section .num { color: red; }'; // app держит .num только scoped — не база
  const site = '.stat-box .num { font-size: 30px; }';
  const markup = '<div className="num">0</div>';
  assert.equal(run(app, site, markup), 0);
});
