// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectThemeVars } from './mapTokens.js';

// ЗАЧЕМ ЭТОТ ТЕСТ. Карта share-карточки живёт со своей темой (день/ночь),
// независимой от темы приложения, и красит маршрут с пинами токенами ТОЙ темы.
// Взять их у каскада нельзя (тёмная половина объявлена селектором `:root
// [data-theme="dark"]`, вложенному пробнику он не достанется), поэтому значения
// читаются из самих правил. Дефект такого чтения тихий: промахнулись селектором
// — вернётся ПУСТО, сработает фолбэк на живой токен, и карта просто останется в
// цвете темы приложения. Ровно тот баг, который чинится, и выглядит он как
// «ничего не произошло», а не как ошибка. Поэтому разбор судится тестом.

// Значения фикстур — НЕ хексы намеренно: разбор к содержимому значения
// безразличен (он его просто переносит), а узнаваемое имя в ассерте читается
// лучше цвета — и не оседает сырым цветом в гарде дизайн-токенов.
/** Мини-двойник CSSStyleRule: только то, чем пользуется collectThemeVars. */
const rule = (selectorText, decls) => ({
  selectorText,
  style: { getPropertyValue: (n) => decls[n] || '' },
});

const NAMES = ['--map-route', '--brand'];

test('collectThemeVars: светлая и тёмная половины расходятся по темам', () => {
  const out = collectThemeVars([
    rule(':root', { '--map-route': 'light-route', '--brand': 'light-route' }),
    rule(':root[data-theme="dark"]', { '--map-route': 'dark-route', '--brand': 'dark-route' }),
  ], NAMES);
  assert.equal(out.light['--map-route'], 'light-route');
  assert.equal(out.dark['--map-route'], 'dark-route');
  assert.equal(out.dark['--brand'], 'dark-route');
});

test('collectThemeVars: правила КОМПОНЕНТОВ под data-theme не считаются темой', () => {
  // В app.css тёмная половина отдельных компонентов написана селекторами вроде
  // `[data-theme="dark"] .btn--primary:hover`. Если считать темой всё, где
  // встречается `data-theme`, чужое объявление того же имени перебьёт корневое —
  // и карта поедет цветом кнопки.
  const out = collectThemeVars([
    rule(':root[data-theme="dark"]', { '--brand': 'dark-route' }),
    rule('[data-theme="dark"] .btn--primary:hover', { '--brand': 'btn-hover' }),
    rule(':root[data-theme="dark"] .consent', { '--brand': 'consent' }),
  ], NAMES);
  assert.equal(out.dark['--brand'], 'dark-route');
});

test('collectThemeVars: селектор-список с :root учитывается; кавычки нормализуются', () => {
  const out = collectThemeVars([
    rule(':root, .site', { '--brand': 'light-a' }),
    rule(":root[data-theme='dark']", { '--brand': 'dark-a' }),
  ], NAMES);
  assert.equal(out.light['--brand'], 'light-a');
  assert.equal(out.dark['--brand'], 'dark-a');
});

test('collectThemeVars: позже объявленное побеждает (каскад одинаковой специфичности)', () => {
  const out = collectThemeVars([
    rule(':root', { '--brand': 'light-a' }),
    rule(':root', { '--brand': 'light-b' }),
  ], NAMES);
  assert.equal(out.light['--brand'], 'light-b');
});

test('collectThemeVars: пустой вход и мусорные правила не роняют разбор', () => {
  assert.deepEqual(collectThemeVars([], NAMES), { light: {}, dark: {} });
  const out = collectThemeVars([{}, { selectorText: '.x' }, null], NAMES);
  assert.deepEqual(out, { light: {}, dark: {} });
});
