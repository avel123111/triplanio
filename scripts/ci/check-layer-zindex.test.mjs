#!/usr/bin/env node
/**
 * Тесты CI-гарда 2af (scripts/ci/check-layer-zindex.mjs).
 *
 * Гард — это код, у него есть тест (TRIP-282). Здесь это не формальность: у
 * предиката 2af ровно два места, где он может молча начать проверять НЕ ТО.
 *
 *   1. КОММЕНТАРИИ. `app.css` на 90% состоит из журнальных блок-комментариев,
 *      которые цитируют селекторы и объявления целыми правилами (`visual-diff-*`,
 *      разборы решений). Сканер без гашения комментариев считал бы цитату
 *      правилом — и число «нарушений» скакало бы от ПРАВКИ ТЕКСТА. Замер на живом
 *      дереве: с гашением 14 слоёв в app.css, без него набор другой. Тест
 *      «правило внутри комментария не считается» пинит именно это.
 *   2. ПРИЗНАК ПОЛНОРАЗМЕРНОСТИ. `inset: 0` и четыре стороны по отдельности —
 *      одно и то же для кадра и разные строки для регулярки. Пропусти вторую
 *      форму — и гард зелёный над половиной репо (`.tc__scrim` написан именно
 *      четырьмя сторонами после автопрефиксера).
 *
 * Каждый тест собирает одноразовый git-репо, коммитит «базу», коммитит «HEAD» и
 * запускает гард подпроцессом с BASE_REF на базовый коммит — то есть гард
 * прогоняется целиком, ровно как в CI.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('./check-layer-zindex.mjs', import.meta.url));

const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function put(dir, path, body) {
  const full = join(dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

function fixture(t, { base = {}, head = {}, renames = [] }) {
  const dir = mkdtempSync(join(tmpdir(), 'guard2af-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'guard@test']);
  git(dir, ['config', 'user.name', 'guard']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['config', 'core.hooksPath', '/dev/null']);

  for (const [p, body] of Object.entries(base)) put(dir, p, body);
  put(dir, '.keep', '');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'base']);
  const baseRef = git(dir, ['rev-parse', 'HEAD']).trim();

  for (const [from, to] of renames) {
    mkdirSync(dirname(join(dir, to)), { recursive: true });
    git(dir, ['mv', from, to]);
  }
  for (const [p, body] of Object.entries(head)) put(dir, p, body);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'head', '--allow-empty']);

  return { dir, baseRef };
}

function run({ dir, baseRef }, { args = [], ref, cwd } = {}) {
  const r = spawnSync(process.execPath, [GUARD, ...args], {
    cwd: cwd ? join(dir, cwd) : dir,
    encoding: 'utf8',
    env: { ...process.env, BASE_REF: ref ?? baseRef },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/** Слой-подложка без объявленного уровня — то, что гард обязан ловить. */
const unnamed = (sel) => `${sel} { position: absolute; inset: 0; object-fit: cover; }\n`;
/** Тот же слой с названным уровнем — правильная форма. */
const named = (sel) => `${sel} { position: absolute; inset: 0; z-index: 0; object-fit: cover; }\n`;

/* ─────────────────────────────── храповик ───────────────────────────────── */

test('новый слой без объявленного уровня → красный', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': named('.x__img') },
    head: { 'src/a.css': named('.x__img') + unnamed('.y__img') },
  });
  const r = run(f);
  assert.equal(r.code, 1);
  assert.match(r.out, /src\/a\.css/);
  assert.match(r.out, /\.y__img/, 'сообщение обязано назвать ИМЕННО добавленный слой');
});

test('тот же слой с z-index → зелёный (важно значение НАЗВАНО, а не какое оно)', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': named('.x__img') },
    head: { 'src/a.css': named('.x__img') + named('.y__img') },
  });
  assert.equal(run(f).code, 0);
});

test('счёт пошёл вниз → зелёный (храповик односторонний)', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': unnamed('.a') + unnamed('.b') },
    head: { 'src/a.css': unnamed('.a') + named('.b') },
  });
  assert.equal(run(f).code, 0);
});

test('новый CSS-файл рождается с базой 0 — грязным родиться нельзя', (t) => {
  const f = fixture(t, { base: {}, head: { 'src/new.css': unnamed('.hero__bg') } });
  const r = run(f);
  assert.equal(r.code, 1);
  assert.match(r.out, /новый файл|база 0/i);
});

test('переименование файла не читается как «новый файл, полный нарушений»', (t) => {
  const f = fixture(t, {
    base: { 'src/old.css': unnamed('.a') + unnamed('.b') },
    head: {},
    renames: [['src/old.css', 'src/new.css']],
  });
  assert.equal(run(f).code, 0, 'чистый git mv обязан быть зелёным');
});

/* ───────────────────────────── предикат ────────────────────────────────── */

test('правило ВНУТРИ комментария не считается правилом', (t) => {
  // Ровно форма журнальных комментариев app.css: разбор цитирует селектор с телом.
  const f = fixture(t, {
    base: { 'src/a.css': named('.x__img') },
    head: {
      'src/a.css':
        '/* разбор: раньше тут стояло .z__img { position: absolute; inset: 0; } — снято */\n' +
        named('.x__img'),
    },
  });
  assert.equal(run(f).code, 0, 'цитата в комментарии не должна краснить гард');
});

test('полноразмерность через четыре стороны считается так же, как inset', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': named('.x') },
    head: {
      'src/a.css':
        named('.x') +
        '.scrim { position: absolute; top: 0; right: 0; bottom: 0; left: 0; }\n',
    },
  });
  assert.equal(run(f).code, 1, 'четыре стороны — та же полноразмерная подложка');
});

test('`inset` с `auto` — привязка, а не подложка: гарда не касается', (t) => {
  // `inset: 0 0 auto 0` — полоса сверху, `inset: 50% auto auto 50%` — точка.
  // Считать их подложками значит раздуть базу храповика, то есть ослабить его.
  const f = fixture(t, {
    base: { 'src/a.css': named('.x') },
    head: {
      'src/a.css':
        named('.x') +
        '.band { position: absolute; inset: 0 0 auto 0; }\n' +
        '.dot { position: absolute; inset: 50% auto auto 50%; }\n',
    },
  });
  assert.equal(run(f).code, 0);
});

test('одна из четырёх сторон `auto` — тоже не подложка', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': named('.x') },
    head: {
      'src/a.css':
        named('.x') + '.b { position: absolute; top: 0; right: 0; bottom: auto; left: 0; }\n',
    },
  });
  assert.equal(run(f).code, 0);
});

test('сообщение называет ДОБАВЛЕННЫЙ слой, даже если он в начале файла', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': unnamed('.tail') },
    head: { 'src/a.css': unnamed('.head-layer') + unnamed('.tail') },
  });
  const r = run(f);
  assert.equal(r.code, 1);
  assert.match(r.out, /\.head-layer/, 'разница по селектору, а не «последние N хитов»');
  assert.doesNotMatch(r.out.split('→')[0], /\.tail\b/, 'старый слой не должен выдаваться за новый');
});

test('абсолютный элемент, НЕ растянутый на кадр, гарда не касается', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': named('.x') },
    head: { 'src/a.css': named('.x') + '.tip { position: absolute; top: 8px; right: 8px; }\n' },
  });
  assert.equal(run(f).code, 0, 'тултип/кнопка в углу — не слой-подложка');
});

test('`z-index` в СОСЕДНЕМ правиле не засчитывается слою', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': named('.x') },
    head: { 'src/a.css': named('.x') + '.over { z-index: 4; }\n' + unnamed('.under') },
  });
  assert.equal(run(f).code, 1, 'уровень должен стоять на САМОМ слое');
});

/* ─────────────────────────────── обход ─────────────────────────────────── */

test('маркер layer-exempt на строке правила освобождает слой', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': named('.x') },
    head: {
      'src/a.css':
        named('.x') +
        '.solo { position: absolute; inset: 0; } /* layer-exempt: .solo — единственный слой изолированного кадра */\n',
    },
  });
  assert.equal(run(f).code, 0);
});

test('маркер в блок-комментарии НАД правилом тоже освобождает', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': named('.x') },
    head: {
      'src/a.css':
        named('.x') +
        '/* layer-exempt: .solo — причина */\n' +
        '.solo { position: absolute; inset: 0; }\n',
    },
  });
  assert.equal(run(f).code, 0);
});

/* ──────────────────────────── периметр и среда ─────────────────────────── */

test('public/ входит в периметр наравне с src/', (t) => {
  const f = fixture(t, {
    base: { 'public/site.css': named('.x') },
    head: { 'public/site.css': named('.x') + unnamed('.hero-layer') },
  });
  assert.equal(run(f).code, 1, 'сайтовая зона видима гарду — зона без гарда = зона без правила');
});

test('не-CSS файл гарда не касается', (t) => {
  const f = fixture(t, {
    base: {},
    head: { 'src/a.jsx': 'export const C = () => <i style={{ position: "absolute", inset: 0 }}/>;\n' },
  });
  assert.equal(run(f).code, 0);
});

test('запуск из подкаталога судит весь репо, а не «нечего проверять»', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': named('.x') },
    head: { 'src/a.css': named('.x') + unnamed('.y') },
  });
  const r = run(f, { cwd: 'src' });
  assert.equal(r.code, 1, '«нечего проверять» не должно печататься тем же вердиктом, что «чисто»');
});

test('неразрешимый BASE_REF → пропуск, а не догадка', (t) => {
  const f = fixture(t, { base: {}, head: { 'src/a.css': unnamed('.y') } });
  const r = run(f, { ref: 'origin/does-not-exist' });
  assert.equal(r.code, 0);
  assert.match(r.out, /пропуск/i);
});

test('неизвестный флаг отклоняется, а не молча игнорируется', (t) => {
  const f = fixture(t, { base: {}, head: { 'src/a.css': unnamed('.y') } });
  const r = run(f, { args: ['--write'] });
  assert.equal(r.code, 2);
  assert.match(r.out, /--write|неизвестный флаг/i);
});
