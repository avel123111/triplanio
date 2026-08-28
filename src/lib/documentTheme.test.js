/**
 * Неавторизованная зона светлая по построению — у неё нет тёмной темы
 * (TRIP-445).
 *
 * ЧТО СТОРОЖИТСЯ И ПОЧЕМУ ЭТОГО НЕ ВИДНО НИ ОДНОМУ ГАРДУ. Тема приложения по
 * умолчанию `system`, поэтому у человека с ТЁМНОЙ ОС `[data-theme=dark]`
 * оказывался на `<html>` и на лендинге, куда он ещё даже не логинился. Своя
 * палитра зоны от этого защищена (токены на `html.site`, отдельный тест), а всё
 * остальное — нет:
 *
 *   · компонент ПРИЛОЖЕНИЯ на странице зоны — баннер cookie смонтирован вне
 *     роутера, чтобы показываться и на анонимных входах, — читал тёмные токены
 *     и вставал тёмным пятном на белом листе;
 *   · и хуже: между моментом, когда провайдер кладёт тему (~115 мс), и
 *     моментом, когда догружается `site.css` (~650 мс), ТЁМНОЙ была вся
 *     страница. Замерено на лендинге: `body` = `rgb(12,14,28)`.
 *
 * Второе — ровно то, что видно как «на секунду при загрузке всё тёмное», и
 * почему чинить это на уровне отдельных элементов бессмысленно: следующий
 * компонент приложения, попавший на страницу зоны, принесёт то же самое.
 *
 * ДВА МЕХАНИЗМА, ОБА ОБЯЗАТЕЛЬНЫ. Владелец факта «это страница зоны» —
 * `useSiteCss()`, его зовут все семь страниц. Но страницы ЛЕНИВЫЕ и монтируются
 * ПОЗЖЕ, чем ложится тема, поэтому начальное значение берётся ПО АДРЕСУ.
 *
 * ⚠️ МУТАЦИИ, КОТОРЫМИ ТЕСТЫ ПРОВЕРЕНЫ КРАСНЫМИ (зелёный тест не значит ничего,
 * пока не увидел его красным — [[triplanio-ci-guard-is-code]]):
 *   · снять `if (lightZone) return false` — падает первая таблица;
 *   · убрать `/terms` из `EXACT` — падает список маршрутов;
 *   · заменить `startsWith('/join/')` на равенство — падает проверка префикса;
 *   · убрать `useLightZone()` из `useSiteCss` — падает связка.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isZoneRoute, resolveDark } from './documentTheme.js';

const ZONE = ['/', '/login', '/reset-password', '/terms', '/privacy', '/d/europe-may-2027',
  '/join/abc', '/public/trip/1fd33a2e?t=tok'];
const APP = ['/trips', '/stats', '/settings', '/inbox', '/new-trip', '/trip/123', '/kit'];

test('★★★ в зоне тема светлая при ЛЮБОМ выборе пользователя и любой ОС', () => {
  for (const stored of ['light', 'dark', 'system']) {
    for (const systemDark of [true, false]) {
      assert.equal(resolveDark({ stored, systemDark, lightZone: true }), false,
        `зона обязана быть светлой: stored=${stored} systemDark=${systemDark}`);
    }
  }
});

test('★★ вне зоны тема остаётся выбором пользователя — починка зоны не отнимает тёмную у приложения', () => {
  const cases = [
    [{ stored: 'dark', systemDark: false }, true],
    [{ stored: 'light', systemDark: true }, false],
    [{ stored: 'system', systemDark: true }, true],
    [{ stored: 'system', systemDark: false }, false],
  ];
  for (const [x, want] of cases) {
    assert.equal(resolveDark({ ...x, lightZone: false }), want,
      `stored=${x.stored} systemDark=${x.systemDark} обязано дать dark=${want}`);
  }
});

test('★★ затравка по адресу: семь страниц зоны — зона, экраны приложения — нет', () => {
  for (const p of ZONE) assert.equal(isZoneRoute(p), true, `${p} — страница зоны`);
  for (const p of APP) assert.equal(isZoneRoute(p), false, `${p} — экран приложения, тема его собственная`);
});

test('★ префикс — это префикс, а не равенство: у join и публичной поездки в адресе токен', () => {
  assert.equal(isZoneRoute('/join/'), true);
  assert.equal(isZoneRoute('/join/very/long/token'), true);
  assert.equal(isZoneRoute('/public/trip/abc/anything'), true);
  assert.equal(isZoneRoute('/joinery'), false);
  assert.equal(isZoneRoute('/publicity'), false);
});

test('★ хвостовой слэш не меняет ответ — иначе /terms/ дал бы тёмный кадр', () => {
  assert.equal(isZoneRoute('/terms/'), true);
  assert.equal(isZoneRoute('/login/'), true);
  assert.equal(isZoneRoute(''), true);
});

test('★★★ СВЯЗКА: useSiteCss выключает тёмную тему — иначе уход из зоны её не вернёт', () => {
  // Затравка по адресу закрывает только ПЕРВЫЙ кадр. Дальше владельцем факта
  // «это страница зоны» обязан быть смонтированный компонент: иначе после
  // перехода зона→приложение документ остался бы светлым навсегда.
  const src = readFileSync(new URL('../components/site/SiteChrome.jsx', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export function useSiteCss()'));
  assert.match(body.slice(0, body.indexOf('\n}')), /useLightZone\(\)/,
    'useSiteCss() больше не зовёт useLightZone() — тема зоны перестала сбрасываться при уходе из неё');
});
