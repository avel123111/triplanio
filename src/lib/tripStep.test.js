import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { clearsStep } from './tripStep.js';

// ФРОНТ БОЛЬШЕ НЕ ВЫВОДИТ СТУПЕНЬ — он её читает (см. шапку tripStep.js).
// Поэтому здесь остались ровно две вещи: поведение `clearsStep` и паритет
// ЛЕСТНИЦЫ с сервером. Правило «кто на какой ступени» целиком серверное и
// покрыто `supabase/functions/_shared/tripStep_test.ts` (включая владельца с
// залётной строкой членства — денежный контур, правило #13).

// ── clearsStep — вложенность и fail-closed на null ────────────────────────────

test('clearsStep: owner ⊃ editor ⊃ participant', () => {
  assert.equal(clearsStep('owner', 'participant'), true);
  assert.equal(clearsStep('owner', 'editor'), true);
  assert.equal(clearsStep('owner', 'owner'), true);
  assert.equal(clearsStep('editor', 'participant'), true);
  assert.equal(clearsStep('editor', 'editor'), true);
  assert.equal(clearsStep('editor', 'owner'), false);
  assert.equal(clearsStep('participant', 'participant'), true);
  assert.equal(clearsStep('participant', 'editor'), false);
  assert.equal(clearsStep('participant', 'owner'), false);
});

// null приходит В ДВУХ РАЗНЫХ СИТУАЦИЯХ — «ответ read-двери ещё не приехал» и
// «вызывающий не на трипе» — и обе обязаны вести себя одинаково: прав нет.
// Именно это делает загрузку безопасной: пока ступень неизвестна, ролевые пункты
// меню не рисуются, а не «рисуются на всякий случай».
test('clearsStep: null clears nothing (fail-closed)', () => {
  assert.equal(clearsStep(null, 'participant'), false);
  assert.equal(clearsStep(null, 'editor'), false);
  assert.equal(clearsStep(null, 'owner'), false);
});

test('clearsStep: незнакомая ступень не перекрывает ничего', () => {
  // @ts-expect-error — намеренно невалидное значение: приезжает по сети, а
  // значит теоретически может быть чем угодно; проваливаться обязано в «нельзя».
  assert.equal(clearsStep('superadmin', 'participant'), false);
});

// ── ПАРИТЕТ с сервером — тот же приём, что viralLink.js ↔ _shared/viralLink.ts ─
// Читаем серверный tripStep.ts как ТЕКСТ (импортировать нельзя — другой рантайм).
// Сверяем только ПОРЯДОК ступеней: список ролей фронт больше не держит, сверять
// нечего — ступень приезжает готовой.

const SERVER_SRC = readFileSync(
  fileURLToPath(new URL('../../supabase/functions/_shared/tripStep.ts', import.meta.url)),
  'utf8',
);

test('parity: FE ladder order === server LADDER', () => {
  const m = SERVER_SRC.match(/LADDER[^=]*=\s*\{([^}]*)\}/);
  assert.ok(m, 'server LADDER not found — did tripStep.ts move?');
  const serverLadder = Object.fromEntries(
    [...m[1].matchAll(/(\w+):\s*(\d+)/g)].map((x) => [x[1], Number(x[2])]),
  );
  // FE ступени должны ранжироваться идентично серверным.
  assert.equal(clearsStep('owner', 'editor'), serverLadder.owner >= serverLadder.editor);
  assert.equal(clearsStep('editor', 'participant'), serverLadder.editor >= serverLadder.participant);
  assert.equal(clearsStep('participant', 'editor'), serverLadder.participant >= serverLadder.editor);
});

// Значения ступеней — часть СЕТЕВОГО контракта: сервер кладёт их в `myStep`, а
// фронт сравнивает по имени. Опечатка в любой из половин молча снимала бы права.
test('parity: FE ladder keys === server TripStep union', () => {
  const m = SERVER_SRC.match(/export type TripStep =([^;]*);/);
  assert.ok(m, 'server TripStep type not found — did tripStep.ts move?');
  const serverSteps = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
  for (const step of serverSteps) {
    assert.equal(clearsStep(step, 'participant'), true, `ступень ${step} должна быть известна фронту`);
  }
});
