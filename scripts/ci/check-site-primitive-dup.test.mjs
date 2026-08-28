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
          ZONE_PERIMETER: join(dir, 'markup'),
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

/* ─── Третья проверка: app.css ДОБАВИЛ объявление имени, которое носит зона ───
 * Первые две стоят на стороне зоны и смотрят на состояние. Эта — на стороне
 * приложения и смотрит на СОБЫТИЕ: правку пишет тот, кто site.css не открывает,
 * и узнать о зоне ему неоткуда. Ей нужен настоящий git-репозиторий: предмет
 * проверки — диff против базы, а не содержимое файла.                        */

/** Фикстура с двумя коммитами. Пути относительные, cwd = репозиторий: гард
 *  спрашивает git, а git отвечает только про то, что внутри. */
function runGit({ appBase, appHead, site, markup = '', commitHead = true }) {
  const dir = mkdtempSync(join(tmpdir(), 'dupguard-git-'));
  const g = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    mkdirSync(join(dir, 'app'));
    mkdirSync(join(dir, 'site'));
    mkdirSync(join(dir, 'markup'));
    g(['init', '-q', '-b', 'main']);
    g(['config', 'user.email', 'guard@test']);
    g(['config', 'user.name', 'guard']);
    g(['config', 'commit.gpgsign', 'false']);
    g(['config', 'core.hooksPath', '/dev/null']);
    writeFileSync(join(dir, 'app', 'app.css'), appBase);
    writeFileSync(join(dir, 'site', 'site.css'), site);
    writeFileSync(join(dir, 'markup', 'Zone.jsx'), markup);
    g(['add', '-A']);
    g(['commit', '-qm', 'base']);
    const baseRef = g(['rev-parse', 'HEAD']).trim();
    writeFileSync(join(dir, 'app', 'app.css'), appHead);
    if (commitHead) {
      g(['add', '-A']);
      g(['commit', '-qm', 'head', '--allow-empty']);
    }
    try {
      execFileSync('node', [GUARD], {
        cwd: dir,
        env: {
          ...process.env,
          APP_CSS_PATH: 'app/app.css',
          SITE_CSS_PATH: 'site/site.css',
          ZONE_PERIMETER: join(dir, 'markup'),
          BASE_REF: baseRef,
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

const SITE_OK = '/* site-dup-exempt: btn — один объект */\n.btn { border-radius: 4px; }\n';
const MARKUP_BTN = '<a className="btn btn-primary">x</a>';

test('★★★ app.css добавил объявление имени из разметки зоны → КРАСНЫЙ', () => {
  assert.equal(runGit({
    appBase: '.btn { padding: 0 15px; }\n',
    appHead: '.btn { padding: 0 15px; letter-spacing: .04em; }\n',
    site: SITE_OK,
    markup: MARKUP_BTN,
  }), 1);
});

test('★★ то же добавление у имени, которого зона НЕ носит → ЗЕЛЁНЫЙ', () => {
  // Ловит мутацию «сторожить все одиночки app.css, а не общие с зоной»: без
  // пересечения с разметкой гард начнёт краснеть на каждой правке дизайн-системы.
  assert.equal(runGit({
    appBase: '.te-step { padding: 0 15px; }\n',
    appHead: '.te-step { padding: 0 15px; letter-spacing: .04em; }\n',
    site: SITE_OK,
    markup: MARKUP_BTN,
  }), 0);
});

test('★★ общее имя ЕСТЬ, но PR его не трогал → ЗЕЛЁНЫЙ (событие, а не состояние)', () => {
  // Ловит мутацию «проверять состояние»: тогда гард краснел бы на любом PR,
  // пока имя вообще существует, и его бы выключили в первый же день.
  assert.equal(runGit({
    appBase: '.btn { padding: 0 15px; }\n.te-step { gap: 2px; }\n',
    appHead: '.btn { padding: 0 15px; }\n.te-step { gap: 4px; }\n',
    site: SITE_OK,
    markup: MARKUP_BTN,
  }), 0);
});

test('★★ маркер site-shared-ok на ДОБАВЛЕННОЙ строке → ЗЕЛЁНЫЙ', () => {
  assert.equal(runGit({
    appBase: '.btn { padding: 0 15px; }\n',
    appHead: '/* site-shared-ok: btn — трекинг читается зоной из своего токена */\n.btn { padding: 0 15px; letter-spacing: .04em; }\n',
    site: SITE_OK,
    markup: MARKUP_BTN,
  }), 0);
});

test('★★★ маркер, оставшийся от ПРОШЛОГО PR, не гасит новую правку → КРАСНЫЙ', () => {
  // Маркер живёт один PR. Читай его из файла целиком — и разовое «да, знаю»
  // осталось бы навсегда, то есть белый список вернулся бы через заднюю дверь.
  assert.equal(runGit({
    appBase: '/* site-shared-ok: btn — прошлый PR */\n.btn { padding: 0 15px; }\n',
    appHead: '/* site-shared-ok: btn — прошлый PR */\n.btn { padding: 0 15px; letter-spacing: .04em; }\n',
    site: SITE_OK,
    markup: MARKUP_BTN,
  }), 1);
});

test('★★★ НЕЗАКОММИЧЕННАЯ правка видна — диff идёт против рабочего дерева', () => {
  // Номера строк из диффа сверяются с позициями объявлений, разобранными из
  // ФАЙЛА НА ДИСКЕ. Сравнивай гард с `BASE_REF...HEAD` — и незакоммиченная
  // правка была бы не только невидимой: она сдвинула бы строки, и гард сверял
  // бы номера одного файла с содержимым другого. Тот же урок уже записан у 2p.
  assert.equal(runGit({
    appBase: '.btn { padding: 0 15px; }\n',
    appHead: '.btn { padding: 0 15px; letter-spacing: .04em; }\n',
    site: SITE_OK,
    markup: MARKUP_BTN,
    commitHead: false,
  }), 1);
});
