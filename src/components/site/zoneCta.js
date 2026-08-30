// ОДНА дверь для всех CTA неавторизованной зоны: куда ведёт кнопка, что она
// сообщает аналитике и как ведёт себя клик (TRIP-445, PR 7).
//
// ── ЧТО БЫЛО ────────────────────────────────────────────────────────────────
// Шесть кнопок одного смысла («иди в продукт»), и каждая своя:
//   • `const APP_URL = '/login'`                             — ЧЕТЫРЕ копии
//   • `isAuthenticated ? '/trips' : withVisitCampaign(…)`    — ТРИ копии
//   • `e.preventDefault(); track(…); nav(target)`            — ЧЕТЫРЕ копии
// с РАЗНЫМ содержимым события: герой слал `{location:'hero'}` без страницы,
// вторая кнопка героя не слала ничего, шапка и оба пункта бургера — тоже
// ничего. То есть верхние ступени воронки не считались вовсе, а нижние не
// различались между лендингом и демо. Это не «забыли дописать»: это следствие
// того, что контракт события заполнялся руками в шести местах.
//
// ── ЧТО СТАЛО ───────────────────────────────────────────────────────────────
// Хук отдаёт готовую пару `{ href, onClick }` — её раскрывают на `<a>`, и
// больше на месте кнопки не остаётся НИ ОДНОГО решения: ни адреса, ни ветки по
// авторизации, ни метки страницы, ни обработки модификаторов. Вызывающий
// сообщает ровно то, чего не знает никто, кроме него, — МЕСТО кнопки.
//
// `surface` не параметр намеренно (см. `zoneSurface.js`): страница выводится из
// адреса, поэтому её нельзя ни забыть, ни перепутать.

import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { track, withVisitCampaign } from '@/lib/analytics';
import { zoneSurface } from '@/lib/zoneSurface';

/** Куда ведёт CTA гостя и куда — уже вошедшего. Одно место на всю зону. */
const LOGIN_PATH = '/login';
const APP_PATH = '/trips';

/**
 * Обычный левый клик — тот, который мы имеем право перехватить.
 *
 * Cmd/Ctrl-клик, средняя кнопка и Shift — это «открой отдельно»: перехват
 * сломал бы «открыть в новой вкладке» на КАЖДОЙ кнопке зоны. Предикат общий у
 * CTA и у клика по лого (`useBrandNav`) — до этого он существовал только у
 * второго, поэтому Cmd-клик по кнопке «Начать бесплатно» не открывал ничего.
 */
export function isPlainLeftClick(e) {
  return !(e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey);
}

/**
 * Адрес главной с меткой кампании этого визита — для ссылки на лого со страниц,
 * которые не лендинг. Был тремя одинаковыми константами (демо, публичка, юр).
 *
 * Ленивая, а не константа модуля: `window` на верхнем уровне закрыл бы файлу
 * дорогу в любой не-браузерный контекст. Значение считается один раз —
 * `withVisitCampaign` читает снимок входного адреса, который за сессию не
 * меняется.
 */
let home;
export function zoneHome() {
  home ??= withVisitCampaign(`${window.location.origin}/`);
  return home;
}

/**
 * @param {string} location МЕСТО кнопки — единственное, чего не знает хук:
 *   `header` · `menu` · `menu_signin` · `hero` · `hero_demo` · `final` ·
 *   `final_demo`. `final` и `final_demo` уже живут в аналитике — не переименовывать.
 * @param {string} [to] Адрес, если кнопка ведёт НЕ в продукт (ссылка на демо в
 *   финальном блоке лендинга). По умолчанию — вход, а для вошедшего «Мои поездки».
 * @returns {{href: string, onClick: (e: MouseEvent) => void}} раскрыть на `<a>`.
 */
export function useZoneCta(location, to) {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const { isAuthenticated } = useAuth();
  // Метка кампании визита едет НА адрес: gtag читает её из строки запроса
  // (TRIP-407 PR5). Вошедшему она не нужна — он уже атрибуцирован.
  const href = to ?? (isAuthenticated ? APP_PATH : withVisitCampaign(LOGIN_PATH));
  const onClick = (e) => {
    if (!isPlainLeftClick(e)) return;
    e.preventDefault();
    track('cta_clicked', { location, surface: zoneSurface(pathname) });
    // Через роутер, а не голым href: полная перезагрузка выбросила бы снимок
    // кампании визита вместе с документом (гард 2ad про то же).
    nav(href);
  };
  return { href, onClick };
}
