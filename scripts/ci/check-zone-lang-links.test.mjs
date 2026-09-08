#!/usr/bin/env node
/**
 * Тесты гарда 2ah (`scripts/ci/check-zone-lang-links.mjs`).
 *
 * Дефект, который он ловит, НЕВИДИМ в коде: `to="/"` — совершенно нормальная
 * ссылка на главную, и ровно она сбрасывает язык, потому что `/` — это
 * канонический АНГЛИЙСКИЙ адрес, а локаль маршрута перебивает и профиль, и
 * выбор посетителя. Скриншота у «язык сменился на переходе» нет, красного теста
 * тоже — есть только этот гард, значит у него есть тест (CLAUDE.md).
 *
 * Каждый случай строит одноразовую зону и гоняет гард ПОДПРОЦЕССОМ с `cwd` в
 * ней — так же, как его гоняет CI. Список локализованных страниц гард берёт из
 * настоящего `src/lib/routePaths.js` (импорт относительно САМОГО гарда), а не
 * из фикстуры: у теста нет своей копии этого факта, как и у гарда.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_PATH } from '../../src/pages/Demo/demoPath.js';

const GUARD = fileURLToPath(new URL('./check-zone-lang-links.mjs', import.meta.url));

/** Чистая зона: язык едет через `useZonePath`, нелокализованные адреса — как есть. */
const ZONE = {
  'src/components/site/AuthShell.jsx':
    "const home = useZonePath('/');\nexport const A = () => <Link to={home}>home</Link>;\n",
  'src/pages/Landing/LandingPage.jsx': "export const L = () => <Link to=\"/login\">in</Link>;\n",
  'src/pages/Legal.jsx': "export const G = () => <Link to=\"/privacy\">p</Link>;\n",
};

function put(dir, path, body) {
  const full = join(dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

function fixture(t, files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'guard2ah-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [p, body] of Object.entries({ ...ZONE, ...files })) put(dir, p, body);
  return dir;
}

const PERIMETER = Object.keys(ZONE).join(',');
const run = (cwd) => spawnSync(process.execPath, [GUARD], {
  cwd, encoding: 'utf8', env: { ...process.env, ZONE_PERIMETER: PERIMETER },
});

test('зона, где адреса строятся через useZonePath, проходит', (t) => {
  const r = run(fixture(t));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /несут язык/);
});

test('литерал `to="/"` — нарушение (ровно тот баг с логотипом входа)', (t) => {
  const r = run(fixture(t, {
    'src/components/site/AuthShell.jsx': "export const A = () => <Link to=\"/\">home</Link>;\n",
  }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /AuthShell\.jsx:1/);
});

test('литерал в фигурных скобках `to={\'/\'}` прячется от наивного грепа, но не от гарда', (t) => {
  const r = run(fixture(t, {
    'src/pages/Legal.jsx': "export const G = () => <Link to={'/'}>home</Link>;\n",
  }));
  assert.equal(r.status, 1);
});

test('императивный `nav(\'/\')` — то же нарушение', (t) => {
  const r = run(fixture(t, {
    'src/pages/Legal.jsx': "export const G = () => { nav('/'); };\n",
  }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Legal\.jsx:1/);
});

test('голая константа демо-адреса — тоже литерал: адрес верный, язык потерян', (t) => {
  const r = run(fixture(t, {
    'src/pages/Landing/LandingPage.jsx': "export const L = () => <Link to={DEMO_PATH}>demo</Link>;\n",
  }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /DEMO_PATH/);
});

test('литеральный адрес демо тоже флагится — это локализованная страница', (t) => {
  const r = run(fixture(t, {
    'src/pages/Landing/LandingPage.jsx': `export const L = () => { nav('${DEMO_PATH}'); };\n`,
  }));
  assert.equal(r.status, 1);
});

test('НЕлокализованные адреса не флагятся: у них одна версия, язык не в адресе', (t) => {
  const r = run(fixture(t, {
    'src/pages/Legal.jsx':
      "export const G = () => (<>\n" +
      "  <Link to=\"/terms\">t</Link>\n" +
      "  <Link to=\"/privacy\">p</Link>\n" +
      "  <Link to=\"/login\">l</Link>\n" +
      "  <button onClick={() => nav('/trips', { replace: true })} />\n" +
      "</>);\n",
  }));
  assert.equal(r.status, 0, r.stderr);
});

test('выражение — не литерал: санкционированный строитель именно его и даёт', (t) => {
  const r = run(fixture(t, {
    'src/pages/Legal.jsx':
      "const home = useZoneHome();\n" +
      "export const G = () => <Link to={home}>home</Link>;\n",
  }));
  assert.equal(r.status, 0, r.stderr);
});

test('адрес, названный в комментарии, гарда не трогает', (t) => {
  const r = run(fixture(t, {
    'src/pages/Legal.jsx':
      "// раньше здесь стоял to=\"/\" и терял язык\n" +
      "/* nav('/') — так было до TRIP-520 */\n" +
      "export const G = () => <Link to={home}>home</Link>;\n",
  }));
  assert.equal(r.status, 0, r.stderr);
});

test('маркер zone-lang-exempt на этот адрес снимает нарушение', (t) => {
  const r = run(fixture(t, {
    'src/pages/Legal.jsx':
      "/* zone-lang-exempt: / — осознанно английская главная */\n" +
      "export const G = () => <Link to=\"/\">home</Link>;\n",
  }));
  assert.equal(r.status, 0, r.stderr);
});

test('маркер на ДРУГОЙ адрес ссылку не спасает', (t) => {
  const r = run(fixture(t, {
    'src/pages/Legal.jsx':
      `/* zone-lang-exempt: ${DEMO_PATH} — не про эту ссылку */\n` +
      "export const G = () => <Link to=\"/\">home</Link>;\n",
  }));
  assert.equal(r.status, 1);
});

test('исчезнувший путь периметра = код 2, а не «чисто»', (t) => {
  const dir = fixture(t);
  const r = spawnSync(process.execPath, [GUARD], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, ZONE_PERIMETER: 'src/pages/NoSuchFile.jsx' },
  });
  assert.equal(r.status, 2);
});

test('гард видит НАСТОЯЩЕЕ дерево зоны, а не только фикстуры', (t) => {
  // Периметр по умолчанию (без переопределения) на живом репозитории: если
  // список зоны уедет или гард перестанет открывать файлы, здесь будет не 0.
  const repo = fileURLToPath(new URL('../..', import.meta.url));
  const r = spawnSync(process.execPath, [GUARD], { cwd: repo, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /файлов зоны/);
});
