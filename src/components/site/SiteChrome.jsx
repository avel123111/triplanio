import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { useT } from '@/lib/i18n/I18nContext';
import { openConsentBanner } from '@/lib/consent';
import { withVisitCampaign } from '@/lib/analytics';
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

const APP_URL = '/login';

/* Language switcher — prototype's own DOM (.lang/.lang-btn/.lang-menu), NO
   flag (the prototype's markup never carries one — TRIP-460 §5). The repo
   ships a third language (es) beyond the prototype's en/ru demo; added in the
   same list/button shape, not a new pattern. */
const LANGS = [
  { code: 'en', label: 'English', display: 'EN' },
  { code: 'ru', label: 'Русский', display: 'RU' },
  { code: 'es', label: 'Español', display: 'ES' },
];

function LangSwitch({ value, onChange }) {
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
 */
export function SiteHeader({ lang, setLang, variant = 'full', themed = false, navBase = '', brandHref = '#top' }) {
  const t = useT();
  const nav = useNavigate();
  const location = useLocation();
  const { isAuthenticated } = useAuth();
  // Carry this visit's campaign marks onto /login so a gclid/utm survives the
  // click — gtag's url_passthrough reads them off the address (TRIP-407 PR5).
  const ctaTarget = isAuthenticated ? '/trips' : withVisitCampaign(APP_URL);
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [theme, setTheme] = useState('light'); // on-light is the safe default
  const navHref = (hash) => `${navBase}${hash}`;

  const showNav = variant === 'full';
  const showCta = variant === 'full' || variant === 'cta';
  // Only the full header collapses its section nav into the mobile menu; the
  // others have nothing to hide behind a burger, so they keep everything inline.
  const showBurger = variant === 'full';

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

  const goCta = () => { setMobileOpen(false); nav(ctaTarget); };

  return (
    <>
      <LandingSprite />
      <header className={`site-header ${scrolled ? 'scrolled' : ''} on-${theme}`} id="siteHeader">
        <div className="wrap">
          <a href={brandHref} className="brand" aria-label={t('nav.aria_home')}>
            <svg className="logo" viewBox="0 0 342 341" aria-hidden="true"><use href="#tl-logo"/></svg>
            Triplanio
          </a>
          {showNav && (
            <nav className="main-nav" aria-label={t('nav.aria_primary')}>
              {NAV.map((n) => <a key={n.hash} href={navHref(n.hash)}>{t(n.tkey)}</a>)}
            </nav>
          )}
          <div className="header-actions">
            <LangSwitch value={lang} onChange={setLang} />
            {showCta && (
              <button type="button" className="btn btn-primary btn-sm header-cta" onClick={goCta}>
                {t('landing.nav.cta')}
              </button>
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
      {showBurger && (
        <nav className="mobile-menu" id="mobileMenu" aria-label={t('nav.aria_primary')}>
          <button type="button" onClick={goCta}>{t('landing.hero.cta1')}</button>
          <button type="button" onClick={goCta}>{t('landing.hero.cta2')}</button>
          {NAV.map((n) => (
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
  return (
    <footer className="site-footer" data-hdr="light">
      <div className="wrap">
        <div className="footer-min">
          <div className="footer-brandcol">
            <a href={brandHref} className="brand">
              <svg className="logo" viewBox="0 0 342 341" aria-hidden="true"><use href="#tl-logo"/></svg>
              Triplanio
            </a>
            <p className="footer-tag">{t('landing.ft.tag')}</p>
          </div>
          <nav className="footer-links" aria-label={t('nav.aria_footer')}>
            {/* nav-exempt: /terms — статический HTML до Ф6 (vercel.json rewrite), <Link> дал бы 404 */}
            <a href="/terms">{t('landing.ft.terms')}</a>
            {/* nav-exempt: /privacy — статический HTML до Ф6 (vercel.json rewrite), <Link> дал бы 404 */}
            <a href="/privacy">{t('landing.ft.privacy')}</a>
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
export function useSiteCss() {
  const [cssReady, setCssReady] = useState(() => {
    if (typeof document === 'undefined') return false;
    const el = document.getElementById('site-css');
    return !!(el && el.sheet);
  });
  useEffect(() => {
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
  }, []);
  return cssReady;
}

/**
 * Force the always-light zone theme and restore whatever the app had on unmount
 * (TRIP-460 §7.2). The unauthenticated zone is light-only; a dark theme stored
 * by the authed app sets [data-theme=dark] on <html> and leaks dark text onto
 * the light zone. This was copy-pasted three times and only Login restored it —
 * PublicTrip and the landing left `data-theme=light` behind, so a dark-mode
 * user stayed light after leaving until a reload. One hook, next to the CSS
 * lifecycle it already shares.
 */
export function useSiteTheme() {
  useEffect(() => {
    const r = document.documentElement;
    const prev = r.getAttribute('data-theme');
    r.setAttribute('data-theme', 'light');
    return () => {
      if (prev) r.setAttribute('data-theme', prev);
      else r.removeAttribute('data-theme');
    };
  }, []);
}

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
