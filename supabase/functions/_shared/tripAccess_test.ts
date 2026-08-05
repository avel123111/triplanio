/**
 * TRIP-274 Ф1.4 — инвариант «viewer не меняет план трипа», закреплённый машиной.
 *
 * Правило «кто что может» вынесено из async-функций в чистую `stepFromFacts`
 * ровно затем, чтобы его можно было запинить: правило, живущее только внутри
 * запроса к БД, тестом не проверяется никак. Тот же раскол, что у
 * `_shared/profiles.ts` (TRIP-334).
 *
 * Что здесь ЕСТЬ: сама лестница — кто на какой ступени оказывается и какая
 * ступень какую перекрывает.
 * Чего здесь НЕТ (сознательно, не выдаём за покрытие): какая ДВЕРЬ какую
 * ступень требует. Это свойство каждой edge-функции, и проверяется оно либо
 * запуском функции, либо чтением её исходника; ни того ни другого лань
 * `deno test` сегодня не делает.
 *
 * Запуск: deno test supabase/functions/_shared/tripAccess_test.ts
 */

import { assertEquals } from 'jsr:@std/assert@^1.0.8';
import { clearsStep, EDITOR_ROLES, stepFromFacts, type TripStep } from './tripAccess.ts';

const OWNER = 'owner-uuid';
const OTHER = 'other-uuid';

// ── Ступень по фактам ────────────────────────────────────────────────────────

Deno.test('создатель — owner, даже без строки членства', () => {
  assertEquals(stepFromFacts(OWNER, OWNER, null), 'owner');
});

Deno.test('создатель остаётся owner при ЛЮБОЙ своей строке членства (TRIP-143)', () => {
  // Залётная строка created_by-юзера не должна его понижать.
  for (const role of ['viewer', 'admin', 'owner', 'что-то новое']) {
    assertEquals(stepFromFacts(OWNER, OWNER, role), 'owner', `роль ${role}`);
  }
});

Deno.test('admin и owner-строка дают editor', () => {
  for (const role of EDITOR_ROLES) {
    assertEquals(stepFromFacts(OWNER, OTHER, role), 'editor', `роль ${role}`);
  }
});

Deno.test('viewer — participant, не выше', () => {
  assertEquals(stepFromFacts(OWNER, OTHER, 'viewer'), 'participant');
});

Deno.test('нет активной строки — не на трипе вовсе', () => {
  assertEquals(stepFromFacts(OWNER, OTHER, null), null);
});

Deno.test('нет трипа или нет пользователя — не на трипе вовсе', () => {
  assertEquals(stepFromFacts(null, OTHER, 'admin'), null);
  assertEquals(stepFromFacts(OWNER, null, 'admin'), null);
  assertEquals(stepFromFacts(null, null, 'admin'), null);
});

// ★ Гейт БЕЛЫЙ, а не чёрный. Фронтовый roleCanEdit — чёрный (`!== 'viewer'`), и
// это расхождение чинит Ф2.1; серверная половина обязана оставаться белой:
// незнакомая или пустая роль проваливается в «нельзя», а не в «можно».
Deno.test('незнакомая роль НЕ даёт editor (белый список, TRIP-120)', () => {
  for (const role of ['', 'Admin', 'ADMIN', 'editor', 'guest', 'member', 'null']) {
    assertEquals(stepFromFacts(OWNER, OTHER, role), 'participant', `роль ${role}`);
    assertEquals(clearsStep(stepFromFacts(OWNER, OTHER, role), 'editor'), false, `роль ${role}`);
  }
});

// ── Вложенность лестницы ─────────────────────────────────────────────────────

Deno.test('owner ⊃ editor ⊃ participant', () => {
  assertEquals(clearsStep('owner', 'participant'), true);
  assertEquals(clearsStep('owner', 'editor'), true);
  assertEquals(clearsStep('owner', 'owner'), true);

  assertEquals(clearsStep('editor', 'participant'), true);
  assertEquals(clearsStep('editor', 'editor'), true);
  assertEquals(clearsStep('editor', 'owner'), false);

  assertEquals(clearsStep('participant', 'participant'), true);
  assertEquals(clearsStep('participant', 'editor'), false);
  assertEquals(clearsStep('participant', 'owner'), false);
});

Deno.test('null не перекрывает ничего', () => {
  for (const req of ['participant', 'editor', 'owner'] as const) {
    assertEquals(clearsStep(null, req), false, req);
  }
});

// ── Сам инвариант §1 в терминах ступеней ─────────────────────────────────────

Deno.test('★ viewer не перекрывает editor ни при каком раскладе', () => {
  const asViewer: Array<[string, TripStep]> = [
    ['активный viewer', stepFromFacts(OWNER, OTHER, 'viewer')],
    ['не участник', stepFromFacts(OWNER, OTHER, null)],
    ['нет трипа', stepFromFacts(null, OTHER, 'viewer')],
  ];
  for (const [what, step] of asViewer) {
    assertEquals(clearsStep(step, 'editor'), false, what);
    assertEquals(clearsStep(step, 'owner'), false, what);
  }
});

Deno.test('★ viewer ПРОХОДИТ там, где нужно участие (чат, шеринг, копия)', () => {
  assertEquals(clearsStep(stepFromFacts(OWNER, OTHER, 'viewer'), 'participant'), true);
});

Deno.test('★ editor не становится owner (удаление трипа и биллинг)', () => {
  assertEquals(clearsStep(stepFromFacts(OWNER, OTHER, 'admin'), 'owner'), false);
});

// EDITOR_ROLES — это и есть список из SQL `_can_edit_trip`. Расхождение сделало
// бы серверные половины правила разными, а увидеть это можно было бы только на
// проде: обе двери молчат, просто пускают разных людей.
Deno.test('EDITOR_ROLES совпадает с ролями из _can_edit_trip', () => {
  assertEquals([...EDITOR_ROLES].sort(), ['admin', 'owner']);
});
