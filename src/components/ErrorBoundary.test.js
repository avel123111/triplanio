import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Аварийный fallback `ErrorBoundary` красит текст/кнопку через `var(--токен, #литерал)`
// (TRIP-475 Ф1.0): цвет берётся из токена — значит адаптируется к теме сам, — а
// литерал это crash-safe ЗАПАС на случай, если `app.css` не приехал. Тест держит
// запас РАВНЫМ токену светлой темы: разойдись он — кнопка «Повторить» уедет в
// другой синий, чем продукт, и узнает об этом только пользователь в момент краха.
// Тот же принцип, что `splash.test.js`. Тёмная тема приходит из `var()` сама,
// дублировать её в литерале незачем (в отличие от заставки, которой var() недоступен).
test('crash-safe литералы ErrorBoundary = токены :root из app.css', () => {
  const app = readFileSync('src/design/app.css', 'utf8');
  const src = readFileSync('src/components/ErrorBoundary.jsx', 'utf8');

  // Токены светлой темы объявлены в первом `:root{…}` (тёмная — в `:root[data-theme="dark"]`).
  const light = app.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
  const token = (name) => light.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`))?.[1];

  for (const name of ['ink', 'ink-2', 'brand']) {
    const value = token(name);
    assert.ok(value, `не найден --${name} в :root app.css — форма файла изменилась, сверка ослепла`);
    assert.ok(
      src.toLowerCase().includes(`var(--${name}, ${value.toLowerCase()})`),
      `литерал-запас для var(--${name}) разошёлся с токеном ${value} — обнови ErrorBoundary.jsx`,
    );
  }
});
