import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventDeleteConfirm } from './eventDeleteConfirm.js';

const t = (k, p) => (p ? `${k}:${JSON.stringify(p)}` : k);

test('текст один на все оболочки события', () => {
  const a = eventDeleteConfirm(t, 'Отель', () => {});
  const b = eventDeleteConfirm(t, 'Отель', async () => {});
  assert.equal(a.title, b.title);
  assert.equal(a.description, b.description);
  assert.equal(a.confirmLabel, b.confirmLabel);
});

test('имя типа уходит в вопрос строчными', () => {
  const { title } = eventDeleteConfirm(t, 'Трансфер', () => {});
  assert.match(title, /"label":"трансфер"/);
});

test('пустое имя не роняет вызов', () => {
  assert.doesNotThrow(() => eventDeleteConfirm(t, undefined, () => {}));
  assert.match(eventDeleteConfirm(t, undefined, () => {}).title, /"label":""/);
});

test('тон всегда деструктивный — это не решение вызывателя', () => {
  assert.equal(eventDeleteConfirm(t, 'Услуга', () => {}).variant, 'destructive');
});

test('колбэк — единственная точка расхождения: проходит как есть', () => {
  const fn = async () => 'done';
  assert.equal(eventDeleteConfirm(t, 'Отель', fn).onConfirm, fn);
});
