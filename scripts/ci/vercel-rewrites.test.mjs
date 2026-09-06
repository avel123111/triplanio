// Инвариант маршрутизации Vercel: SPA-фолбэк НЕ распространяется на /assets/*.
//
// ЗДЕСЬ ЖЕ ЖИВЁТ ОБЪЯСНЕНИЕ, потому что в самом `vercel.json` его хранить негде:
// схема Vercel не допускает у правила посторонних ключей и отвергает деплой с
// `//`-комментарием («rewrites[N] should NOT have additional property `//`»).
//
// Что чинится. Общее правило `/(.*) → /index.html` нужно роутеру: сервер не знает
// про /trips и /trip/:id. Но оно ловило и файлы, поэтому пропавший после деплоя
// чанк получал 200 с телом index.html вместо 404. Браузер падал на «Failed to
// fetch dynamically imported module» (HTML вместо модуля), в мониторинге это
// неотличимо от лежащей сети, а заголовок `immutable` для /assets/* разрешал
// кэшировать подмену на год. Замер на dev 31.08: content-type text/html,
// cache-control immutable, x-vercel-cache HIT.
//
// Почему это тест, а не комментарий (TRIP-284). Правило `/(.*) → /index.html`
// выглядит безобидным упрощением, и вернуть его — одна правка. Цена возврата
// невидима: приложение работает, ошибки не появляются, просто пропавший чанк
// снова начинает отдавать 200 с телом index.html — и «файла нет» опять
// становится неотличимо от «сеть лежит», а подмена кэшируется на год под
// заголовком immutable. Такой регресс никто не заметит без теста.
//
// Предикат честный, но узкий: разбирается ИМЕННО та форма, которая записана в
// конфиге (`/:path(<шаблон>)`), а не эмулируется path-to-regexp целиком —
// зависимость ради этого не заводится (правило #6). Смена формы правила уронит
// тест на разборе, и это правильно: значит инвариант надо перечитать.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SHELL_FILE } from '../build/prerenderPaths.mjs';

const { rewrites } = JSON.parse(readFileSync('vercel.json', 'utf8'));
// ★ ФОЛБЭК ВЕДЁТ НА ОБОЛОЧКУ, А НЕ НА `index.html` (TRIP-520): по `index.html`
// теперь лежит ИСПЕЧЁННЫЙ ЛЕНДИНГ. Веди фолбэк туда — и каждый экран приложения
// начинал бы с разметки лендинга в контейнере, которую React тут же стирает:
// лишние 55 КБ на КАЖДЫЙ адрес и чужой кадр в придачу.
const fallback = rewrites.filter((r) => r.destination === `/${SHELL_FILE}`);

test('SPA-фолбэк ровно один — иначе неизвестно, какой из них решает', () => {
  assert.equal(fallback.length, 1);
});

test('/assets/* мимо фолбэка, маршруты приложения — в фолбэк', () => {
  const m = /^\/:[a-z]+\((.*)\)$/.exec(fallback[0].source);
  assert.ok(m, `форма правила изменилась: ${fallback[0].source} — перечитать инвариант`);
  const re = new RegExp(`^${m[1]}$`);

  // Пропавший чанк обязан дойти до файловой системы и получить честный 404.
  assert.equal(re.test('assets/ManualPlanner-Cvl42zcr.js'), false);
  assert.equal(re.test('assets/index-tJL0lE9Q.js'), false);

  // Всё остальное рисует роутер, и это не должно пострадать.
  for (const path of ['', 'trips', 'trip/123', 'login', 'new-trip', 'terms',
    'join/token', 'public/trip/x', 'd/europe-may-2027', 'es', 'ru/d/europe-may-2027']) {
    assert.equal(re.test(path), true, `маршрут ${path || '/'} потерял фолбэк`);
  }
});
