// zoneSurface: адрес → страница зоны.
//
// Тест обязан быть КРАСНЫМ на мутации: убери ветку `/d/` — падает «демо это
// demo»; верни `app` вместо `legal` — падает сверка с маршрутами App.jsx.
//
// ★ ГЛАВНЫЙ ТЕСТ — ПОСЛЕДНИЙ: он читает МАРШРУТЫ ЗОНЫ из App.jsx и требует,
// чтобы у каждого была своя страница. Без него функция и маршрутизация
// расходятся МОЛЧА: добавили в зону новый экран — события с него поедут с
// меткой `app`, то есть смешаются с приложением, и заметит это не разработчик,
// а кривая воронки через квартал.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { zoneSurface } from './zoneSurface.js';
import { DEMO_PATH } from '../pages/Demo/demoPath.js';

test('каждая страница зоны — своя метка', () => {
  assert.equal(zoneSurface('/'), 'landing');
  assert.equal(zoneSurface('/d/europe-may-2027'), 'demo');
  assert.equal(zoneSurface('/public/trip/abc-123'), 'public');
  assert.equal(zoneSurface('/terms'), 'legal');
  assert.equal(zoneSurface('/privacy'), 'legal');
  assert.equal(zoneSurface('/login'), 'auth');
  assert.equal(zoneSurface('/reset-password'), 'auth');
  assert.equal(zoneSurface('/join/tok'), 'join');
});

test('адреса приложения — не зона', () => {
  for (const p of ['/trips', '/stats', '/settings', '/inbox', '/pro', '/trip/abc', '/new-trip']) {
    assert.equal(zoneSurface(p), 'app', p);
  }
});

test('мусор на входе не роняет и не притворяется зоной', () => {
  for (const p of [undefined, null, '', 42, {}, '/dd/not-demo', '/terms-of-war']) {
    assert.equal(zoneSurface(p), 'app', String(p));
  }
});

test('★ каждый маршрут внутри SiteZone в App.jsx имеет свою метку', () => {
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');

  // Все обёртки SiteZone — их сегодня две (ветка зоны и ветка
  // «разлогиненный на чужом адресе»), и обе обязаны быть покрыты.
  const blocks = [...app.matchAll(/<SiteZone>([\s\S]*?)<\/SiteZone>/g)].map((m) => m[1]);
  assert.ok(blocks.length > 0, 'в App.jsx нет ни одной обёртки SiteZone — зона переехала, тест смотрит в пустоту');

  // Адрес маршрута бывает и константой (`path={DEMO_PATH}`) — такие резолвим по
  // имени. Незнакомое имя это ОШИБКА, а не пропуск: молча не посчитанный
  // маршрут — ровно та дыра, ради которой тест написан.
  const CONSTS = { DEMO_PATH };
  const paths = new Set();
  for (const b of blocks) {
    for (const m of b.matchAll(/<Route\s+path=(?:"([^"]+)"|\{(\w+)\})/g)) {
      const [, literal, name] = m;
      if (literal === '*') continue;
      if (literal) { paths.add(literal); continue; }
      assert.ok(name in CONSTS, `маршрут с path={${name}} — тест не знает этой константы, добавь её в CONSTS`);
      paths.add(CONSTS[name]);
    }
  }
  assert.ok(paths.size >= 6, `маршрутов зоны найдено ${paths.size} — ожидалось не меньше шести`);

  for (const p of paths) {
    // `:slug` — любой конкретный слаг: метка не может от него зависеть.
    const concrete = p.replace(/:[A-Za-z]+/g, 'x');
    assert.notEqual(
      zoneSurface(concrete), 'app',
      `${p} — маршрут зоны, а метки у него нет: события уедут в общую кучу с приложением`,
    );
  }
});
