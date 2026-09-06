import React, { useState, useEffect, useRef, useContext, createContext, useCallback } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useT, useI18n } from '@/lib/i18n/I18nContext';
import { useLightZone } from '@/lib/ThemeContext';
import { holdSplash } from '@/lib/splash';
import { openConsentBanner } from '@/lib/consent';
import { isProdHost } from '@/lib/analyticsEnv';
import { isZonePage, splitLangPath, withLangPath, PREFIXED_LANGS, LOCALISED_PAGES } from '@/lib/routePaths';
import { useZoneCta, isPlainLeftClick } from './zoneCta';
import { withVisitCampaign } from '@/lib/analytics';
import { zoneSurface } from '@/lib/zoneSurface';
import { DEMO_PATH } from '@/pages/Demo/demoPath';
import LandingSprite from './LandingSprite';

/* =========================================================
   SiteChrome — shared marketing header/footer + site-CSS loader.
   ONE header and ONE footer for every unauthenticated route (landing,
   public shared-trip, and — from Ф6 — auth/join/legal). The composition
   is driven by props, not by six near-identical copies:
     • `variant` — which pieces the header carries (see SiteHeader).
     • `themed`  — whether the header re-tints itself against the section
                   beneath it (landing only).
   `navBase` makes the in-page section anchors absolute when the chrome is
   mounted off the landing route (e.g. /public/trip), where the prototype's
   #together/#stats/#assistant anchors don't exist locally.

   Brand mark and icons (chevron etc.) come from the prototype's OWN sprite
   (LandingSprite, `#tl-logo`/`#i-chev`) — TRIP-460 "CSS/markup as-is": the
   chrome is itself prototype markup, not a paraphrase with the app's Icon
   component and a hand-copied logo path.
========================================================= */


/* Language switcher — prototype's own DOM (.lang/.lang-btn/.lang-menu), NO
   flag (the prototype's markup never carries one — TRIP-460 §5). The repo
   ships a third language (es) beyond the prototype's en/ru demo; added in the
   same list/button shape, not a new pattern. */
const LANGS = [
  { code: 'en', label: 'English', display: 'EN' },
  { code: 'ru', label: 'Русский', display: 'RU' },
  { code: 'es', label: 'Español', display: 'ES' },
];

export function LangSwitch({ value, onChange }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const current = LANGS.find((l) => l.code === value) || LANGS[0];
  return (
    <div className={`lang ${open ? 'open' : ''}`} ref={ref}>
      <button type="button" className="lang-btn" aria-haspopup="listbox" aria-expanded={open}
        aria-label={t('landing.lang.label')} onClick={() => setOpen((v) => !v)}>
        <span>{current.display}</span>
        <svg width="14" height="14" aria-hidden="true"><use href="#i-chev" /></svg>
      </button>
      <div className="lang-menu" role="listbox" aria-label={t('landing.lang.label')}>
        {LANGS.map((l) => (
          <button key={l.code} type="button" role="option" aria-checked={l.code === value}
            className={l.code === value ? 'active' : ''} data-lang={l.code}
            onClick={() => { onChange(l.code); setOpen(false); }}>
            <span className="code">{l.display}</span>{l.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Язык страницы зоны и способ его сменить. ОДНА реализация на три страницы —
 * лендинг, демо и юр-документы раньше делали одинаковый `useI18n()` каждая.
 *
 * ★ У ИСПЕЧЁННОЙ СТРАНИЦЫ СМЕНА ЯЗЫКА — ЭТО ПЕРЕХОД, А НЕ СМЕНА СОСТОЯНИЯ
 * (TRIP-520). Язык такой страницы назван адресом, и по каждому адресу лежит
 * СВОЙ готовый файл. Останься переключатель сменой состояния — экран стал бы
 * испанским, а адрес и файл под ним английскими: перезагрузка молча вернула бы
 * английский, а поделиться увиденным стало бы нельзя. Поэтому здесь настоящий
 * переход документа: человек получает испанский файл, то есть ровно то, что
 * увидит по этой ссылке любой другой.
 *
 * `setLang` перед переходом зовётся НАМЕРЕННО и целиком: он же пишет язык в
 * профиль вошедшего (единая дверь `account/profile`). Обойди мы его — смена
 * языка на лендинге перестала бы доезжать до аккаунта, и это заметил бы только
 * тот, кто потом откроет приложение.
 *
 * На страницах БЕЗ готового файла (вход, приглашение, публичная поездка) ничего
 * не меняется: там язык решает посетитель, и переключатель остаётся сменой
 * состояния.
 */
export function useZoneLang() {
  const { lang, setLang } = useI18n();
  const { pathname } = useLocation();
  const { path } = splitLangPath(pathname);
  const localised = LOCALISED_PAGES.includes(path);

  const switchLang = useCallback(async (next) => {
    if (!localised || next === lang) return setLang(next);
    await setLang(next);
    // Метка кампании обязана пережить переход документа — она живёт В АДРЕСЕ
    // (TRIP-514), и голый assign потерял бы её на первой же смене языка.
    window.location.assign(withVisitCampaign(withLangPath(next, path)));
    return undefined;
  }, [localised, path, lang, setLang]);

  return { lang, setLang: switchLang };
}

const NAV = [
  { tkey: 'landing.nav.together', hash: '#together' },
  { tkey: 'landing.nav.stats', hash: '#stats' },
  { tkey: 'landing.nav.assistant', hash: '#assistant' },
];

const PROBE = 35; // px from the top where the header samples the section under it
// The only three header tints that have `on-*` rules in site.css. recalc reads
// `data-hdr` straight off the DOM, so a typo (`data-hdr="acent"`) would mint an
// `on-acent` class with no rule and silently leave the header untinted — clamp
// to the known set instead (TRIP-460 §4).
const HDR_THEMES = new Set(['light', 'dark', 'accent']);

/**
 * Клик по логотипу — РОУТЕРОМ, а не перезагрузкой документа.
 *
 * `brandHref` со всех страниц кроме лендинга приходит АБСОЛЮТНЫМ
 * (`withVisitCampaign(window.location.origin + '/')`), и голый `<a href>` на
 * такой адрес браузер отрабатывает полной перезагрузкой: возврат на лендинг с
 * демо, юр-страниц и публички визуально «моргал» и грузился заново.
 *
 * Гард 2ad это не ловил и не мог: он ищет внутренние ссылки вида `href="/x"`, а
 * здесь адрес начинается с `https://` и выглядит внешним — хотя origin НАШ.
 *
 * Ссылку оставляем ссылкой (Cmd-клик, «открыть в новой вкладке», превью
 * адреса — всё работает), но обычный клик уводим в роутер. Метка кампании при
 * этом сохраняется: она в самом адресе, а не в состоянии документа.
 */
function useBrandNav(brandHref) {
  const nav = useNavigate();
  return (e) => {
    // Якорь на этой же странице (`#top` на лендинге) — родное поведение браузера.
    if (!brandHref || brandHref.startsWith('#')) return;
    // Модификаторы и не-левая кнопка — намерение открыть отдельно, не мешаем.
    // Предикат общий с CTA зоны (`zoneCta.js`): «наш клик» — одно понятие.
    if (!isPlainLeftClick(e)) return;
    let url;
    try { url = new URL(brandHref, window.location.href); } catch { return; }
    if (url.origin !== window.location.origin) return; // действительно внешняя — пусть уходит
    e.preventDefault();
    nav(url.pathname + url.search + url.hash);
  };
}

/**
 * Shared marketing header — ONE element, its composition set by `variant`:
 *   'full'    logo + section nav + language + right CTA + mobile drawer
 *             (landing, and from Ф6 the legal pages).
 *   'cta'     logo + language + right CTA, no landing anchors — there is
 *             nowhere to scroll to off the landing (public trip, demo).
 *   'minimal' logo + language only (auth, join).
 *
 * @param themed   Landing only: re-tint the header against the [data-hdr]
 *                 section beneath it (on-light / on-dark / on-accent). Off →
 *                 the header stays light. The theme is recomputed on scroll,
 *                 AND on mount and on route change — neither fires a scroll,
 *                 so a dark cover would otherwise keep dark text (handoff
 *                 §11.14).
 * @param navBase  '' on the landing (same-page anchors). On other routes pass
 *                 an absolute origin so the section anchors resolve to the
 *                 landing, not the current path.
 * @param brandHref where the logo links (default '#top' for the landing).
 * @param navItems  the section links for `variant="full"`. Defaults to the
 *                  landing's own sections; a page with its own in-page sections
 *                  (the demo) passes its list so ONE header serves every zone
 *                  page — its state, not a second header (TRIP-462). Each item
 *                  is { tkey, hash }; hashes stay relative (no navBase) so the
 *                  same-page anchor rules match (handoff §11.28).
 */


export function SiteHeader({ lang, setLang, variant = 'full', themed = false, navBase = '', brandHref = '#top', navItems = NAV }) {
  const t = useT();
  const nav = useNavigate();
  const location = useLocation();
  // Три CTA шапки: кнопка справа и два верхних пункта бургера. Адрес, метку
  // страницы и обработку клика им даёт ОДИН хелпер — здесь остаётся только
  // МЕСТО каждой кнопки (`zoneCta.js`).
  const headerCta = useZoneCta('header');
  const menuCta = useZoneCta('menu');
  // Демо в бургере — та же дверь и тот же адрес, что у кнопки «смотреть демо» в
  // герое и в финальном блоке (`hero_demo` / `final_demo`); отличается только
  // МЕСТО. До этого пункт с текстом «Посмотреть демо» висел на `menu_signin`,
  // то есть вёл на `/login`: одна и та же надпись на одной и той же странице
  // открывала два разных экрана, а демо с мобильного меню было недостижимо.
  const menuDemo = useZoneCta('menu_demo', withVisitCampaign(DEMO_PATH));
  const menuSignin = useZoneCta('menu_signin');
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [theme, setTheme] = useState('light'); // on-light is the safe default
  const navHref = (hash) => `${navBase}${hash}`;

  const showNav = variant === 'full';
  const showCta = variant === 'full' || variant === 'cta';
  // Only the full header collapses its section nav into the mobile menu; the
  // others have nothing to hide behind a burger, so they keep everything inline.
  const showBurger = variant === 'full';
  // На самой демо-странице пункт «Посмотреть демо» вёл бы человека туда, где он
  // уже стоит. Страница выводится из адреса тем же предикатом, что и `surface`
  // в аналитике, — второго источника «где мы» в зоне нет.
  const onDemo = zoneSurface(location.pathname) === 'demo';

  // Scroll state + header theme. `themed` pages sample the section under the
  // header; everyone else is light. Re-runs on route change (location) because
  // navigating between marketing routes does not scroll.
  useEffect(() => {
    const recalc = () => {
      setScrolled(window.scrollY > 24);
      if (!themed) { setTheme('light'); return; }
      const sections = document.querySelectorAll('[data-hdr]');
      let next = 'light';
      // Reverse DOM order so a sheet stacked over the previous section wins.
      for (let i = sections.length - 1; i >= 0; i--) {
        const r = sections[i].getBoundingClientRect();
        if (r.top <= PROBE && r.bottom >= PROBE) {
          const hdr = sections[i].dataset.hdr;
          next = HDR_THEMES.has(hdr) ? hdr : 'light';
          break;
        }
      }
      setTheme(next);
    };
    recalc();
    // A second pass after layout settles (fonts/images) — the first frame can
    // report section rects that shift once the page reflows.
    const raf = requestAnimationFrame(recalc);
    window.addEventListener('scroll', recalc, { passive: true });
    window.addEventListener('resize', recalc);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', recalc);
      window.removeEventListener('resize', recalc);
    };
  }, [themed, location.pathname]);

  // Prototype forces mobile-open on <body> (its CSS keys off `body.mobile-open`
  // to slide the menu in and lock scroll) — ported verbatim rather than a
  // React-local class on the header, since site.css's rule targets body.
  useEffect(() => {
    document.body.classList.toggle('mobile-open', mobileOpen);
    return () => { document.body.classList.remove('mobile-open'); };
  }, [mobileOpen]);

  const onBrand = useBrandNav(brandHref);

  return (
    <>
      <LandingSprite />
      <header className={`site-header ${scrolled ? 'scrolled' : ''} on-${theme}`} id="siteHeader">
        <div className="wrap">
          <a href={brandHref} className="brand" aria-label={t('nav.aria_home')} onClick={onBrand}>
            <svg className="logo" viewBox="0 0 192 192" aria-hidden="true"><use href="#tl-logo"/></svg>
            Triplanio
          </a>
          {showNav && (
            <nav className="main-nav" aria-label={t('nav.aria_primary')}>
              {navItems.map((n) => <a key={n.hash} href={navHref(n.hash)}>{t(n.tkey)}</a>)}
            </nav>
          )}
          <div className="header-actions">
            <LangSwitch value={lang} onChange={setLang} />
            {/* Ссылка, а не кнопка: это навигация, и как ссылка она умеет
                «открыть в новой вкладке» — как остальные пять CTA зоны.
                Оформление не меняется, элементных правил у `.btn` нет. */}
            {showCta && (
              <a className="btn btn-primary btn-sm header-cta" {...headerCta}>
                {t('landing.nav.cta')}
              </a>
            )}
            {showBurger && (
              <button type="button" className="burger" aria-label={t('nav.aria_menu')}
                aria-expanded={mobileOpen} aria-controls="mobileMenu"
                onClick={() => setMobileOpen((v) => !v)}>
                <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
                  <path className="l1" d="M4 6h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path className="l2" d="M4 12h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path className="l3" d="M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </header>
      {/* Все пять пунктов бургер-меню — ССЫЛКИ, как в прототипе: он красит их
          одним правилом `.mobile-menu a` (отступы, вес 500, разделительная
          линия). Первые два были `<button>` БЕЗ класса и не попадали ни под
          него, ни под `.btn` — рисовались голым системным текстом по центру.
          Идут через роутер (preventDefault + nav), а не голым href: полная
          перезагрузка убила бы снимок кампании этого визита — гард 2ad
          сторожит ровно это. */}
      {showBurger && (
        <nav className="mobile-menu" id="mobileMenu" aria-label={t('nav.aria_primary')}>
          {/* ПОРЯДОК ЗДЕСЬ — ЧАСТЬ СМЫСЛА, а не следствие того, кто в каком PR
              появился. Две двери в аккаунт стоят ПАРОЙ (завести / войти) — это
              один вопрос «я новый или я уже ваш», и разорвать его третьей
              ссылкой значит заставить человека читать все пункты, чтобы понять,
              что вариантов входа два. Демо — не дверь в аккаунт, а способ
              посмотреть продукт, ничего не заводя, поэтому стоит ПОСЛЕ пары и
              перед разделами страницы, к которым оно ближе по смыслу. */}
          <a {...menuCta} onClick={(e) => { setMobileOpen(false); menuCta.onClick(e); }}>{t('landing.hero.cta1')}</a>
          {/* Пункт ВХОДА — своей подписью. Он существовал и раньше (`menu_signin`,
              адрес `/login`), но был подписан «Посмотреть демо», поэтому на
              телефоне войти было негде: единственная дверь входа называлась
              чужим именем. Ключ общий с экраном входа — не заводим второй. */}
          <a {...menuSignin} onClick={(e) => { setMobileOpen(false); menuSignin.onClick(e); }}>{t('auth.sign_in')}</a>
          {!onDemo && (
            <a {...menuDemo} onClick={(e) => { setMobileOpen(false); menuDemo.onClick(e); }}>{t('landing.hero.cta2')}</a>
          )}
          {navItems.map((n) => (
            <a key={n.hash} href={navHref(n.hash)} onClick={() => setMobileOpen(false)}>{t(n.tkey)}</a>
          ))}
        </nav>
      )}
    </>
  );
}

/**
 * Shared marketing footer. One footer for every route: brand + tagline, a flat
 * row of product / legal links, the cookie-settings entry, the language switch,
 * and the copyright. Same `navBase` semantics as SiteHeader for the product
 * anchors.
 */
export function SiteFooter({ lang, setLang, brandHref = '#top' }) {
  const t = useT();
  const onBrand = useBrandNav(brandHref);
  return (
    <footer className="site-footer" data-hdr="light">
      <div className="wrap">
        <div className="footer-min">
          <div className="footer-brandcol">
            <a href={brandHref} className="brand" onClick={onBrand}>
              <svg className="logo" viewBox="0 0 192 192" aria-hidden="true"><use href="#tl-logo"/></svg>
              Triplanio
            </a>
            <p className="footer-tag">{t('landing.ft.tag')}</p>
          </div>
          <nav className="footer-links" aria-label={t('nav.aria_footer')}>
            {/* Ф6.6 (TRIP-465): /terms и /privacy — маршруты приложения, статический
                HTML + rewrite'ы удалены. Роутерный переход держит документ (и снимок
                кампании) живым — без перезагрузки. */}
            <Link to="/terms">{t('landing.ft.terms')}</Link>
            <Link to="/privacy">{t('landing.ft.privacy')}</Link>
            {/* Where an anonymous visitor changes their mind — the app itself has no
                footer, so this is the only route for someone who never signed up.
                Reopens the panel; nothing changes until a button in it is pressed. */}
            <button type="button" onClick={openConsentBanner}>{t('landing.ft.cookies')}</button>
            {/* nav-exempt: mailto — внешний протокол, не внутренняя навигация */}
            <a href="mailto:support@triplanio.com">{t('landing.ft.contact')}</a>
          </nav>
        </div>
        {/* В макете подвал несёт ТОЛЬКО копирайт. Переключатель языка стоял здесь
            вторым экземпляром, и его выпадающее меню — абсолютное, но раскрытое
            вниз у самого низа страницы — растягивало документ на 116px пустоты
            под футером. Язык переключается в шапке, на всех ширинах. */}
        <div className="footer-bottom">
          <span>{t('landing.ft.copy')}</span>
        </div>
      </div>
    </footer>
  );
}

/**
 * Dynamically load /site.css on mount and remove it on unmount. Returns
 * `cssReady` once the stylesheet is in. Shared by the landing and any other
 * page that renders the marketing chrome, so the CSS lifecycle lives in one
 * place. Also toggles the `site` class on <html>: that class — not a bare
 * `:root` — is where site.css pins its tokens, so mounting the chrome is the
 * one gate that turns the sitewide tokens on and off (TRIP-446).
 *
 * Ref-counted (TRIP-460 §7.1): the <link> and `html.site` come in on the FIRST
 * consumer and go out only with the LAST. Two consumers alive at once on one
 * page (page + nested block) no longer strip each other's CSS on unmount.
 *
 * Teardown is also deferred to a microtask so a CLIENT navigation between two
 * zone pages (footer → /terms, CTA → demo) stops flashing. React runs the old
 * tree's passive-destroy BEFORE the new tree's passive-create, so a bare
 * counter would still go 1→0 (teardown fires, <link> removed) and only then
 * 0→1. Deferring the check by a microtask lets the incoming consumer bump the
 * count back to 1 first, so the shared <link> stays put and `cssReady` never
 * flips to false mid-hop. The <link> is removed only when the count is still 0
 * after the microtask — i.e. the last consumer really left.
 */
let siteCssRefs = 0;

/**
 * Предзагрузка соседних страниц зоны.
 *
 * Демо и юр-страницы приезжают отдельными чанками (`lazy` в App.jsx) под
 * `Suspense fallback={null}`. Пока чанк едет, экран ПУСТ — это и читалось как
 * «дёрганый переход с перезагрузкой», хотя навигация роутерная.
 *
 * Хуже того, в это же окно проваливался счётчик ссылок `site.css`: старая
 * страница уже размонтирована (1→0), новая ещё висит в Suspense и счётчик не
 * подняла, поэтому микротаск teardown'а видел ноль и снимал `<link>` вместе с
 * классом `site` — к пустому кадру добавлялась вспышка нестилизованной
 * разметки. Микротаск спасает только когда монтирование идёт В ТОМ ЖЕ
 * коммите; загрузка чанка это окно растягивает.
 *
 * Лечим ПРИЧИНУ, а не симптом: как только посетитель оказался в зоне, тихо
 * тянем чанки её соседей. К моменту перехода модуль уже в памяти, Suspense не
 * показывает fallback, счётчик не падает. `requestIdleCallback` — чтобы не
 * соперничать с первой отрисовкой; повторный `import()` дедуплицируется
 * сборщиком, так что вызов идемпотентен.
 */
let zonePrefetched = false;
function prefetchZoneNeighbours() {
  if (zonePrefetched || typeof window === 'undefined') return;
  zonePrefetched = true;
  const run = () => {
    // Ошибку глотаем намеренно: предзагрузка — ускорение, а не функция.
    import('@/pages/Demo/DemoTrip').catch(() => {});
    import('@/pages/Legal').catch(() => {});
  };
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 2000 });
  else setTimeout(run, 800);
}

const ZoneCssCtx = createContext(null);

/**
 * ★ ОДНА ОБОЛОЧКА НА ВСЮ ЗОНУ — владелец `site.css`, класса `html.site` и
 * прокрутки для лендинга, демо, юр-страниц и входа разом.
 *
 * Зачем компонент, а не хук на каждой странице (как было): владелец слоя жил
 * НА СТРАНИЦЕ, поэтому переход лендинг → демо его размонтировал. Порядок React
 * — сначала teardown старого дерева, потом mount нового, — и между ними
 * `<link>` со стилями зоны снимался с документа. А каждая страница зоны стоит
 * на `if (!cssReady) return null`, то есть на это окно из разметки исчезало
 * ВСЁ. Отсюда и «рвано, с перезагрузкой»: это не роутер, это стили,
 * уезжавшие и приезжавшие на каждом переходе.
 *
 * Микротаск и предзагрузка чанков (ниже) окно сужали, но не закрывали: пока
 * страница-сосед висит в `Suspense`, поднять счётчик некому.
 *
 * Здесь владелец ВЫШЕ маршрута: внутри зоны `<SiteZone>` не размонтируется
 * никогда, поэтому снимать и вешать нечего — меняется только содержимое.
 * `cssReady` страницы берут из контекста, а не заводят свой (см. `useSiteCss`).
 *
 * Второе, что уходит вместе с этим: прокрутка. Роутер её не трогает, поэтому
 * переход с середины лендинга на /terms открывал документ с середины.
 */
/** Канонический хост зоны. Тот же, что в `public/sitemap.xml` — карта сайта и
 *  canonical обязаны называть одну страницу одним адресом, иначе они спорят. */
export const CANONICAL_ORIGIN = 'https://www.triplanio.com';

export function SiteZone({ children }) {
  // ★ СВЕТЛУЮ ТЕМУ ДЕРЖИТ ОБОЛОЧКА, А НЕ СТРАНИЦА (TRIP-475).
  //
  // Правило «зона светлая по построению» жило в `useSiteCss()`, то есть у
  // СТРАНИЦЫ. Страницы зоны ленивые, поэтому при переходе внутри зоны старая
  // размонтировалась, снимая удержание, а новая приезжала чанком через десятки
  // миллисекунд — и всё это время `data-theme` возвращался к системному. У
  // человека с тёмной ОС в это окно чернел баннер cookie (он смонтирован ВНЕ
  // роутера и стоит на экране всегда): замерено 17 мс на прогретом чанке и
  // 69 мс на холодном. Оболочка внутри зоны не размонтируется — значит окна
  // между страницами у неё нет по построению, а не «оно короткое».
  useLightZone();
  const cssReady = useSiteCssLink(true);
  const { pathname, hash } = useLocation();
  // ★ ПРОКРУТКА К ЯКОРЮ ВЕДЁМ САМИ, А НЕ ОТДАЁМ БРАУЗЕРУ (TRIP-511).
  //
  // Без хеша — к верху (смену маршрута роутер не прокручивает). С хешем раньше
  // мы делали `return`, полагаясь на нативный скролл. На ХОЛОДНОМ входе по
  // прямой ссылке (`triplanio.com/#together` из объявления/новой вкладки) это
  // промахивалось: секция лендинга ещё не в DOM, когда браузер обрабатывает
  // хеш, — SPA дорисовывает её кадром позже (ленивый чанк + reveal + шрифты и
  // картинки ещё сдвигают лейаут). В шапке те же якоря работали, потому что там
  // клик по `<a href>` идёт уже по отрисованной странице.
  //
  // Поэтому ищем элемент по id и держим его у кромки, пока лейаут не устаканится
  // (несколько кадров без сдвига). Отступ под фикс-шапку берётся даром из
  // `html{scroll-padding-top:86px}` в site.css — `scrollIntoView` его чтит, так
  // что поведение совпадает с меню шапки; плавность/мгновенность — из
  // `scroll-behavior` (reduce-motion уже переключает его на auto).
  useEffect(() => {
    if (!hash) { window.scrollTo(0, 0); return undefined; }
    const id = decodeURIComponent(hash.slice(1));
    // Только «имя-якорь». OAuth-редирект кладёт в хеш токены (`#access_token=…`)
    // — это не наша секция; ведём себя как прежде и прокрутку не трогаем.
    if (!id || /[=&\s]/.test(id)) return undefined;

    let raf = 0;
    let settledFrames = 0;
    let prevTop = NaN;
    const deadline = performance.now() + 3000;
    // Посетитель передумал ждать и сам взялся за прокрутку — уступаем ему.
    let aborted = false;
    const onUserScroll = () => { aborted = true; };
    const opts = { passive: true };
    // Один список — add и remove не могут разъехаться.
    const userScrollEvents = ['wheel', 'touchmove', 'keydown'];
    userScrollEvents.forEach((e) => window.addEventListener(e, onUserScroll, opts));

    const step = () => {
      if (aborted) return;
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView();
        // «Устаканилось» = позиция секции не меняется несколько кадров подряд
        // (скролл доехал, картинки над ней догрузились и перестали её двигать).
        const top = Math.round(el.getBoundingClientRect().top);
        settledFrames = top === prevTop ? settledFrames + 1 : 0;
        prevTop = top;
        if (settledFrames >= 4) return;
      }
      if (performance.now() < deadline) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      userScrollEvents.forEach((e) => window.removeEventListener(e, onUserScroll, opts));
    };
  }, [pathname, hash]);

  // ★ <html lang> ЗДЕСЬ БОЛЬШЕ НЕ ЖИВЁТ (TRIP-515). Владелец атрибута — слой i18n
  // (I18nContext), один на всё приложение и зону. Локальная копия здесь была
  // дефектной: её очистка при уходе с лендинга возвращала атрибут на "en", и в
  // приложении lang всегда оставался английским — повод для автоперевода, который
  // ломал DOM. i18n читает тот же язык, что читала эта копия, поэтому перенос
  // владения атрибут в зоне не меняет (потому же снят импорт useI18n отсюда).

  // ★ CANONICAL — ВЫВОДИТСЯ ИЗ АДРЕСА, а не передаётся страницей (TRIP-445).
  //
  // `index.html` сознательно НЕ кладёт canonical: один абсолютный URL на весь
  // сайт объявил бы каждую страницу дублем главной. Взамен там записано
  // «понадобится — только по-маршрутно из React (Ф6)». Ф6 закончилась шестью
  // страницами, canonical не появился ни на одной.
  //
  // ЗАЧЕМ ОН ЗДЕСЬ ВООБЩЕ. Не ради «просто хорошей практики»: зона — вход
  // рекламной воронки, и метка кампании едет В АДРЕСЕ (`?camp_*`, TRIP-407 PR5).
  // Без canonical каждая рекламная ссылка — отдельный URL для краулера, то есть
  // лендинг размножается на столько страниц, сколько кампаний запущено, и вес
  // между ними делится. Canonical на чистый `pathname` схлопывает их обратно.
  //
  // Строка запроса и якорь отброшены намеренно: они и есть то, что размножает
  // адрес. Хост — константа, а не `location.origin`: на превью-домене canonical
  // указывал бы на превью, то есть превью-деплой начал бы канонизировать сам
  // себя. И ставим ТОЛЬКО на проде — на дев-стенде canonical на прод увёл бы
  // краулера со стенда на живой сайт, что верно по адресу и неверно по смыслу.
  //
  // ★ И ТОЛЬКО ТАМ, ГДЕ СТРАНИЦА ЕСТЬ (TRIP-497). Оболочка зоны монтируется и на
  // адресах, у которых страницы нет: чужой `/d/`-слаг, любой битый адрес у
  // разлогиненного — оба отдают 404 ВНУТРИ зоны. Безусловный canonical объявлял
  // такой адрес каноническим, то есть каждая опечатка в чужой ссылке просила
  // проиндексировать себя как самостоятельную страницу. Сюда же не попадают
  // `/public/trip/*` и `/join/*`: у них в адресе одноразовый токен, индексация
  // запрещена заголовком `X-Robots-Tag` из `vercel.json`, и канонизировать то,
  // что запрещено индексировать, незачем.
  //
  // ★ РЯДОМ С CANONICAL — СПИСОК ЯЗЫКОВЫХ ВЕРСИЙ (TRIP-520). Пока язык жил в
  // состоянии приложения, связывать было нечего, и `hreflang` здесь сознательно
  // отсутствовал. Теперь у каждой испечённой страницы три адреса, и без этого
  // списка поисковик видит три РАЗНЫЕ страницы вместо трёх версий одной: они
  // конкурируют друг с другом, а испанцу в выдаче показывается английская.
  // `x-default` — тот же бесперфиксный адрес: он и есть ответ на «язык
  // посетителя нам неизвестен».
  //
  // Только у испечённых страниц: у входа и восстановления языковых адресов нет
  // (готового файла на язык у них нет и быть не может), и обещать их нельзя.
  useEffect(() => {
    if (!isProdHost || !isZonePage(pathname)) return undefined;
    const { path } = splitLangPath(pathname);
    const links = [];
    const add = (rel, href, hreflang) => {
      const link = document.createElement('link');
      link.rel = rel;
      link.href = CANONICAL_ORIGIN + href;
      if (hreflang) link.hreflang = hreflang;
      document.head.appendChild(link);
      links.push(link);
    };
    add('canonical', pathname);
    if (LOCALISED_PAGES.includes(path)) {
      add('alternate', path, 'en');
      for (const code of PREFIXED_LANGS) add('alternate', withLangPath(code, path), code);
      add('alternate', path, 'x-default');
    }
    return () => links.forEach((link) => link.remove());
  }, [pathname]);

  return <ZoneCssCtx.Provider value={cssReady}>{children}</ZoneCssCtx.Provider>;
}

/**
 * `cssReady` для страницы. Внутри `<SiteZone>` — из контекста (слой уже держит
 * оболочка). Вне её — страница сама себе владелец: так живут /public/trip,
 * /join и лендинг у залогиненного, они приходят не из зоны.
 */
export function useSiteCss() {
  // Тема документа тут БОЛЬШЕ НЕ ТРОГАЕТСЯ: её держит `SiteZone` (см. разбор
  // там и в `ThemeContext`). Владелец обязан быть один — два удержания на
  // булевом флаге гасят друг друга, а страница как владелец оставляет окно
  // между собой и следующей страницей.
  const hosted = useContext(ZoneCssCtx);
  const own = useSiteCssLink(hosted === null);
  return hosted === null ? own : hosted;
}

function useSiteCssLink(enabled) {
  const [cssReady, setCssReady] = useState(() => {
    if (typeof document === 'undefined') return false;
    const el = document.getElementById('site-css');
    return !!(el && el.sheet);
  });

  // Экран запуска (TRIP-478) держится, пока слой стилей зоны не приехал.
  // Это САМОЕ ТИХОЕ ожидание в приложении: страницы зоны стоят на
  // `if (!cssReady) return null`, то есть не рисуют ни кружка, ни разметки —
  // ровно пустоту. Заставка про такое ожидание узнать ниоткуда не может,
  // поэтому без этих строк она уходила по готовности приложения, а человек
  // получал белый кадр между ней и лендингом. Удержание живёт ЗДЕСЬ, в
  // единственном владельце `cssReady`, — значит накрывает все страницы зоны
  // разом и новую тоже.
  useEffect(() => {
    if (!enabled || cssReady) return undefined;
    return holdSplash();
  }, [enabled, cssReady]);

  useEffect(() => {
    if (!enabled) return undefined;
    siteCssRefs += 1;
    const onLoad = () => setCssReady(true);
    let link = document.getElementById('site-css');
    if (link) {
      if (link.sheet) setCssReady(true);
      else link.addEventListener('load', onLoad);
    } else {
      link = document.createElement('link');
      link.id = 'site-css';
      link.rel = 'stylesheet';
      link.href = '/site.css';
      link.addEventListener('load', onLoad);
      document.head.appendChild(link);
      if (link.sheet) setCssReady(true);
    }

    document.documentElement.classList.add('site');
    // Мы в зоне — заранее тянем чанки её соседних страниц (см. докблок выше).
    prefetchZoneNeighbours();

    return () => {
      link.removeEventListener('load', onLoad);
      siteCssRefs = Math.max(0, siteCssRefs - 1);
      queueMicrotask(() => {
        if (siteCssRefs > 0) return; // an incoming consumer already re-claimed it
        const el = document.getElementById('site-css');
        if (el) el.parentNode.removeChild(el);
        document.documentElement.classList.remove('site', 'reveal--ready');
      });
    };
  }, [enabled]);
  return cssReady;
}

/* `useSiteTheme` УДАЛЁН (TRIP-445). Он ставил [data-theme=light] один раз на
   монтировании и не переутверждал, а `ThemeProvider` — живой на всех зонных
   маршрутах — переписывал атрибут на каждое событие prefers-color-scheme. Два
   владельца одного атрибута: зона проигрывала любому позднему событию, и
   заголовки становились белыми на белом. Изоляция зоны от темы теперь чисто
   каскадная — селектор `html.site[data-theme]` в public/site.css, разбор там
   же. Платформа вместо гонки эффектов; удалять этот комментарий вместе с
   последним вызовом hook'а не надо — он объясняет ОТСУТСТВИЕ кода. */

/**
 * Per-route <title>/<meta name="description"> (TRIP-460 §7.3). The app has no
 * such mechanism — every route shows the single <title> from index.html — so
 * this is net-new, kept to ~a dozen lines rather than pulling in a helmet lib.
 * Sets on mount, restores the previous values on unmount so leaving a zone page
 * hands the document meta back untouched.
 */
export function useDocumentMeta(title, description) {
  useEffect(() => {
    const prevTitle = document.title;
    let meta = document.querySelector('meta[name="description"]');
    const hadMeta = !!meta;
    const prevDesc = meta ? meta.getAttribute('content') : null;

    if (title != null) document.title = title;
    if (description != null) {
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('name', 'description');
        document.head.appendChild(meta);
      }
      meta.setAttribute('content', description);
    }

    return () => {
      document.title = prevTitle;
      if (description == null) return;
      if (hadMeta) meta.setAttribute('content', prevDesc ?? '');
      else if (meta && meta.parentNode) meta.parentNode.removeChild(meta);
    };
  }, [title, description]);
}
