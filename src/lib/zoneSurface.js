// Какая СТРАНИЦА неавторизованной зоны сейчас открыта — по адресу, одной чистой
// функцией (TRIP-445, PR 7).
//
// Зачем отдельный источник. Событие `cta_clicked` несёт два поля: `location` —
// МЕСТО кнопки на странице (шапка / герой / финальный блок), и `surface` — сама
// СТРАНИЦА. Место знает только вызывающий, а страница выводится из адреса, и
// это разница между «полем, которое можно забыть» и «полем, которое не может
// разъехаться»: до этой правки герой лендинга слал событие БЕЗ `surface`,
// вторая кнопка героя не слала событие вовсе, а шапка и бургер — тоже ничего,
// хотя это самые верхние ступени воронки. Каждый вызывающий заполнял контракт
// по-своему, потому что заполнять его приходилось руками.
//
// Теперь `surface` не передаётся НИКЕМ — он берётся отсюда. Забыть его нельзя,
// перепутать нельзя, и он одинаков для всех кнопок одной страницы по
// построению.
//
// ★ Файл держим ЧИСТЫМ: ни React, ни `window`, ни импортов. Это цена того,
// чтобы у него был `node --test` (та же конвенция, что у `trip-cities.js` и
// `errorText.js`) — а тест здесь единственный гейт: перепутанную метку в
// аналитике глазами не видно, она обнаруживается кварталом позже по кривой
// воронке.

import { splitLangPath } from './routePaths.js';

/** Значение поля `surface`, когда адрес не принадлежит зоне. */
const OUTSIDE = 'app';

/**
 * @param {string} pathname `location.pathname`
 * @returns {string} страница зоны: landing · demo · public · legal · auth · join,
 *   либо `app` для любого адреса внутри приложения.
 */
export function zoneSurface(raw) {
  if (typeof raw !== 'string' || !raw) return OUTSIDE;
  // Языковой префикс — не вид страницы, а её язык (TRIP-520). `/es/terms` и
  // `/terms` — одна и та же поверхность `legal`; не сними мы префикс, вся
  // неанглийская зона уехала бы в `app` и воронка молча потеряла бы её.
  const { path: pathname } = splitLangPath(raw);
  if (pathname === '/') return 'landing';
  if (pathname.startsWith('/d/')) return 'demo';
  if (pathname.startsWith('/public/trip/')) return 'public';
  if (pathname === '/terms' || pathname === '/privacy') return 'legal';
  if (pathname === '/login' || pathname === '/reset-password') return 'auth';
  if (pathname.startsWith('/join/')) return 'join';
  return OUTSIDE;
}
