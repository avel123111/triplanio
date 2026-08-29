import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enqueueCapture, drainCaptureQueue, CAPTURE_QUEUE_MAX } from './sentry.js';

// Ф1.4: захват отделён от отправки — до приезда SDK ошибки копятся в очереди и
// проигрываются, когда `@sentry/react` инициализирован. Приёмка #2: ошибка,
// брошенная ДО приезда SDK, обязана дойти до Sentry. Проверяем ядро — очередь —
// на чистых функциях, без DOM и без самого SDK.

test('захват до приезда SDK копится и проигрывается в порядке FIFO', () => {
  const q = [];
  enqueueCapture(q, { error: 'a' });
  enqueueCapture(q, { error: 'b' });
  enqueueCapture(q, { error: 'c' });

  const sent = [];
  drainCaptureQueue(q, (item) => sent.push(item.error));

  assert.deepEqual(sent, ['a', 'b', 'c'], 'проигрались все и по порядку');
  assert.equal(q.length, 0, 'очередь опустошена после дренажа');
});

test('переполнение ДРОПАЕТ НОВЫЙ, а не старый — первопричина сохраняется', () => {
  const q = [];
  for (let i = 0; i < CAPTURE_QUEUE_MAX; i++) {
    assert.equal(enqueueCapture(q, { error: i }), true, `элемент ${i} под потолком — принят`);
  }
  // Очередь полна: следующий отклоняется.
  assert.equal(enqueueCapture(q, { error: 'overflow' }), false, 'новый при полной очереди дропнут');
  assert.equal(q.length, CAPTURE_QUEUE_MAX, 'размер не превысил потолок');
  assert.equal(q[0].error, 0, 'ПЕРВАЯ (диагностически ценная) ошибка на месте');
  assert.ok(!q.some((x) => x.error === 'overflow'), 'дропнут именно НОВЫЙ');
});

test('пустая очередь: дренаж не зовёт sink', () => {
  let calls = 0;
  drainCaptureQueue([], () => { calls++; });
  assert.equal(calls, 0);
});
