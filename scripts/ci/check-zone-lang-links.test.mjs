#!/usr/bin/env node
/**
 * Тесты гарда 2ah (`scripts/ci/check-zone-lang-links.mjs`).
 *
 * Дефект, который он ловит, НЕВИДИМ в коде: `to="/"` — совершенно нормальная
 * ссылка на главную, и ровно она сбрасывает язык, потому что `/` — канонический
 * АНГЛИЙСКИЙ адрес, а локаль маршрута перебивает и профиль, и выбор посетителя.
 * Скриншота у «язык сменился на переходе» нет, красного теста тоже — есть только
 * этот гард, значит у него есть тест (CLAUDE.md).
 *
 * ★ ЧТО ИМЕННО ПРОВЕРЯЕТСЯ. Не «правильно ли записан адрес» (перечисление форм
 * записи дырявое по построению — см. докблок гарда), а «можно ли записать адрес
 * МИМО ДВЕРИ»: импортирует ли файл зоны навигационный примитив react-router.
 *
 * Каждый случай строит одноразовую зону и гоняет гард ПОДПРОЦЕССОМ с `cwd` в
 * ней — так же, как его гоняет CI.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('./check-zone-lang-links.mjs', import.meta.url));

/** Чистая зона: дверь на месте, страницы ходят через неё. */
const ZONE = {
  'src/components/site/zoneCta.js':
    "import { useNavigate, useLocation } from 'react-router-dom';\nexport const useZoneNav = () => useNavigate();\n",
  'src/components/site/ZoneLink.jsx':
    "import { Link } from 'react-router-dom';\nexport default ({ to, ...r }) => <Link to={to} {...r} />;\n",
  'src/components/site/AuthShell.jsx':
    "import ZoneLink from './ZoneLink';\nexport const A = () => <ZoneLink to=\"/\">home</ZoneLink>;\n",
  'src/pages/Landing/LandingPage.jsx':
    "import { useLocation } from 'react-router-dom';\nexport const L = () => useLocation();\n",
};

/** Периметр = ровно эти пути; дверь обязана в него попадать. */
const PERIMETER = 'src/components/site,src/pages/Landing';

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

const run = (cwd, perimeter = PERIMETER) => spawnSync(process.execPath, [GUARD], {
  cwd, encoding: 'utf8', env: { ...process.env, ZONE_PERIMETER: perimeter },
});

test('зона, которая ходит через дверь, проходит', (t) => {
  const r = run(fixture(t));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /только через дверь/);
});

test('★ сырой Link в странице зоны — нарушение (ровно баг логотипа входа)', (t) => {
  const r = run(fixture(t, {
    'src/components/site/AuthShell.jsx':
      "import { Link } from 'react-router-dom';\nexport const A = () => <Link to=\"/\">home</Link>;\n",
  }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /AuthShell\.jsx:1 — Link/);
});

test('★ сырой useNavigate — нарушение (кнопка «На главную» в приглашении)', (t) => {
  const r = run(fixture(t, {
    'src/pages/Landing/LandingPage.jsx':
      "import { useNavigate } from 'react-router-dom';\nexport const L = () => useNavigate()('/');\n",
  }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /useNavigate/);
});

test('★★ форма записи адреса значения НЕ имеет — ловится сам импорт', (t) => {
  // Именно здесь прежний предикат и был дырявым: шаблонную строку перечисление
  // синтаксиса не видит. Ловим не её, а то, чем её можно написать.
  const r = run(fixture(t, {
    'src/pages/Landing/LandingPage.jsx':
      "import { Link } from 'react-router-dom';\nexport const L = ({ k }) => <Link to={`/${k}`}>x</Link>;\n",
  }));
  assert.equal(r.status, 1);
});

test('NavLink и Navigate — тоже уход на другой адрес', (t) => {
  for (const name of ['NavLink', 'Navigate']) {
    const r = run(fixture(t, {
      'src/pages/Landing/LandingPage.jsx': `import { ${name} } from 'react-router-dom';\nexport const L = ${name};\n`,
    }));
    assert.equal(r.status, 1, name);
  }
});

test('переименованный импорт не прячет нарушение', (t) => {
  const r = run(fixture(t, {
    'src/pages/Landing/LandingPage.jsx':
      "import { Link as RRLink } from 'react-router-dom';\nexport const L = RRLink;\n",
  }));
  assert.equal(r.status, 1);
});

test('ЧТЕНИЕ адреса не флагится: по useLocation/useParams никуда не уйти', (t) => {
  const r = run(fixture(t, {
    'src/pages/Landing/LandingPage.jsx':
      "import { useLocation, useParams, useSearchParams } from 'react-router-dom';\nexport const L = () => [useLocation(), useParams(), useSearchParams()];\n",
  }));
  assert.equal(r.status, 0, r.stderr);
});

test('сама дверь сырой роутер импортировать ОБЯЗАНА — это её работа', (t) => {
  // Фикстура ZONE уже такая: обе двери импортируют Link/useNavigate и зелены.
  const r = run(fixture(t));
  assert.equal(r.status, 0, r.stderr);
});

test('импорт, названный в комментарии, гарда не трогает', (t) => {
  const r = run(fixture(t, {
    'src/pages/Landing/LandingPage.jsx':
      "// раньше здесь было import { Link } from 'react-router-dom'\n" +
      "/* import { useNavigate } from 'react-router-dom' — до TRIP-533 */\n" +
      "import ZoneLink from '@/components/site/ZoneLink';\nexport const L = ZoneLink;\n",
  }));
  assert.equal(r.status, 0, r.stderr);
});

test('маркер zone-nav-exempt снимает нарушение', (t) => {
  const r = run(fixture(t, {
    'src/pages/Landing/LandingPage.jsx':
      "/* zone-nav-exempt: осознанно, причина */\n" +
      "import { Link } from 'react-router-dom';\nexport const L = Link;\n",
  }));
  assert.equal(r.status, 0, r.stderr);
});

test('★ ИСЧЕЗНУВШАЯ ДВЕРЬ = код 2, а не «нарушений нет»', (t) => {
  // Гард без двери судил бы зону, в которой ходить уже некуда, и молчал.
  const dir = mkdtempSync(join(tmpdir(), 'guard2ah-nodoor-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  put(dir, 'src/pages/Landing/LandingPage.jsx', "export const L = 1;\n");
  const r = run(dir, 'src/pages/Landing');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /дверь навигации зоны не найдена/);
});

test('исчезнувший путь периметра = код 2', (t) => {
  const r = run(fixture(t), 'src/pages/NoSuchFile.jsx');
  assert.equal(r.status, 2);
});

test('гард видит НАСТОЯЩЕЕ дерево зоны, а не только фикстуры', (t) => {
  const repo = fileURLToPath(new URL('../..', import.meta.url));
  const r = spawnSync(process.execPath, [GUARD], { cwd: repo, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /файлов зоны/);
});
