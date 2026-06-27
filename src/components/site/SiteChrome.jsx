import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { useT } from '@/lib/i18n/I18nContext';
import { Icon as BaseIcon } from '@/design/icons';

/* =========================================================
   SiteChrome — shared marketing header/footer + landing-CSS loader.
   Extracted verbatim from Landing/LandingPage.jsx so the public
   shared-trip page reuses the EXACT same chrome (one element, not a
   copy). `navBase` makes the in-page section anchors absolute when the
   chrome is mounted off the landing route (e.g. /public/trip), where
   #features/#how/#faq don't exist locally.
========================================================= */

const APP_URL = '/login';

const TRIPLANIO_PATH = "M33.9515 -0.266535C40.7142 -0.445139 48.1271 -0.302259 54.9281 -0.303644L94.514 -0.309503L214.845 -0.305597L278.868 -0.306574L298.193 -0.318292C310.201 -0.32163 319.364 -0.684415 329.217 7.74225C343.125 19.635 341.19 34.942 341.176 51.3067L341.157 86.3829L341.184 195.125L341.181 272.228L341.212 295.303C341.226 308.706 342.006 318.931 332.398 329.72C326.281 336.547 317.675 340.628 308.52 341.05C298.456 341.533 284.325 341.086 274.023 341.083L205.381 341.092L162.115 341.117C141.323 341.131 123.861 343.106 107.208 327.72C102.838 323.62 99.3189 318.699 96.8548 313.236C94.3907 307.774 93.0296 301.878 92.849 295.889C92.529 287.072 93.8616 280.992 96.6224 272.786C101.665 257.797 109.31 248.589 119.725 237.345C125.95 245.136 131.667 253.986 137.971 261.606C140.39 264.528 150.129 252.175 148.683 246.961C146.168 237.892 141.381 229.908 138.15 221.158C142.842 216.992 148.474 212.5 153.326 208.398C163.06 200.169 172.732 191.869 182.345 183.5C189.212 190.011 196.381 197.442 203.098 204.167L248.907 249.981C253.187 244.922 256.537 238.164 256.598 231.434C256.623 228.623 256.007 225.923 254.626 223.456C251.646 218.12 237.029 204.664 231.868 199.467C223.676 191.542 215.284 182.914 207.203 174.842L155.649 123.287L134.288 101.945C132.743 100.406 131.158 98.7783 129.626 97.3106C123.616 91.552 120.034 86.1564 110.778 87.3673C103.826 88.2767 99.8349 91.3194 94.4329 95.3995C110.556 111.824 126.807 128.124 143.183 144.297C148.913 150.046 155.228 156.051 160.75 161.915C157.391 166.37 151.717 172.659 147.998 177.059C139.745 186.812 131.56 196.623 123.442 206.489C118.102 204.22 112.747 201.983 107.379 199.78C101.261 197.23 96.1995 193.797 89.9368 198.428C79.7224 205.983 80.7549 205.52 89.9857 212.164C94.9362 215.725 102.289 220.689 106.734 224.759C102.849 229.003 98.6343 233.317 95.2406 237.848C77.4842 261.564 66.952 294.342 80.972 322.417C84.8667 330.214 88.4217 334.775 94.4671 341.075C74.9177 341.309 55.209 340.956 35.6429 341.125C25.3518 341.214 16.7477 338.183 9.43489 330.636C5.11961 326.154 2.09948 320.587 0.695637 314.525C-0.740455 308.276 -0.261685 293.256 -0.261394 286.203C-0.338339 274.2 -0.331163 262.2 -0.240887 250.2C4.18863 255.291 9.4218 259.623 15.2513 263.023C32.4055 272.939 50.165 274.236 69.1761 269.211C69.6238 268.23 70.0656 266.844 70.4095 265.786C72.6759 258.811 75.6942 252.497 79.2786 246.108C67.5692 251.37 57.4925 254.32 44.432 253.45C20.0121 252.083 0.660326 229.606 -0.104168 205.7C-0.510832 192.989 -0.272964 179.798 -0.270183 166.97L-0.275066 95.5186L-0.277019 53.2891C-0.286758 47.0065 -0.647595 34.579 0.182942 28.8214C1.1558 22.1467 4.06527 15.9035 8.55013 10.8653C15.5012 3.17884 23.8502 0.199571 33.9515 -0.266535ZM137.352 52.7081C134.062 49.9494 128.015 49.4695 123.791 49.9737C116.528 51.2496 110.458 54.6421 104.987 59.5674L279.767 234.294L284.439 238.919C289.858 231.455 294.445 222.683 293.148 213.136C292.014 204.797 284.255 198.958 278.489 193.235L260.278 175.103L196.142 110.966L155.937 70.7413C150.064 64.881 143.662 58.0002 137.352 52.7081ZM256.192 105.029C259.319 96.1169 261.478 84.3761 247.586 85.7911C231.37 88.8299 220.289 99.6272 209.231 111.022L227.431 129.133L233.775 135.479C242.589 125.851 251.686 117.855 256.192 105.029Z";

export function TriplanioMark({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 341 341" aria-hidden="true">
      <path d={TRIPLANIO_PATH} fill="#2167e2" />
    </svg>
  );
}

const Icon = (props) => <BaseIcon size={20} {...props} />;

/* ── Flag ── */
function Flag({ kind, width = 18, height = 12 }) {
  const common = { width, height, style: { display:'block', borderRadius:2, overflow:'hidden', border:'1px solid rgba(0,0,0,.08)', flex:'0 0 auto' }, 'aria-hidden':true };
  if (kind === 'en') return (
    <svg {...common} viewBox="0 0 60 30">
      <defs><clipPath id="f-en-c"><rect width="60" height="30"/></clipPath><clipPath id="f-en-t"><path d="M30,15 h30 v15 z v-30 h-30 z h-30 v-15 z v30 h30 z"/></clipPath></defs>
      <g clipPath="url(#f-en-c)">
        <rect width="60" height="30" fill="#012169"/>
        <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6"/>
        <path d="M0,0 L60,30 M60,0 L0,30" clipPath="url(#f-en-t)" stroke="#C8102E" strokeWidth="4"/>
        <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10"/>
        <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6"/>
      </g>
    </svg>
  );
  if (kind === 'ru') return <svg {...common} viewBox="0 0 9 6"><rect width="9" height="6" fill="#fff"/><rect width="9" height="4" y="2" fill="#0033A0"/><rect width="9" height="2" y="4" fill="#DA291C"/></svg>;
  if (kind === 'es') return <svg {...common} viewBox="0 0 12 8"><rect width="12" height="8" fill="#AA151B"/><rect width="12" height="4" y="2" fill="#F1BF00"/></svg>;
  return null;
}

const LANGS = [
  { code:'en', label:'English', flag:'en', display:'EN' },
  { code:'ru', label:'Русский', flag:'ru', display:'RU' },
  { code:'es', label:'Español', flag:'es', display:'ES' },
];

function LangDropdown({ value, onChange, direction = 'down' }) {
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
    <div className={`langdd ${open ? 'is-open' : ''} ${direction === 'up' ? 'langdd--up' : ''}`} ref={ref}>
      <button type="button" className="langdd__btn" aria-haspopup="listbox" aria-expanded={open}
        aria-label={t('landing.lang.label')} onClick={() => setOpen(v => !v)}>
        <Flag kind={current.flag} width={18} height={12} />
        <span>{current.display}</span>
        <Icon name="chevron" size={12} className="chev" style={{ transform:'rotate(90deg)' }} />
      </button>
      <div className="langdd__menu" role="listbox" aria-label={t('landing.lang.label')}>
        {LANGS.map(l => (
          <button key={l.code} type="button" role="option" aria-checked={l.code === value}
            className="langdd__item" onClick={() => { onChange(l.code); setOpen(false); }}>
            <Flag kind={l.flag} width={22} height={16} />
            <span className="label">{l.label}</span>
            <span className="code">{l.display}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const NAV = [
  { tkey:'landing.nav.features', hash:'#features' },
  { tkey:'landing.nav.how', hash:'#how' },
  { tkey:'landing.nav.faq', hash:'#faq' },
];

/**
 * Shared marketing header.
 * @param navBase  '' on the landing (same-page anchors). On other routes pass
 *                 an absolute origin (e.g. 'https://triplanio.com/') so the
 *                 section anchors resolve to the landing, not the current path.
 * @param brandHref where the logo links (default '#top' for the landing).
 */
export function SiteHeader({ lang, setLang, navBase = '', brandHref = '#top' }) {
  const t = useT();
  const nav = useNavigate();
  const { isAuthenticated } = useAuth();
  const ctaTarget = isAuthenticated ? '/trips' : APP_URL;
  const [scrolled, setScrolled] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navHref = (hash) => `${navBase}${hash}`;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive:true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [drawerOpen]);

  return (
    <>
      <header className={`header ${scrolled ? 'is-scrolled' : ''}`}>
        <div className="container header__inner">
          <a href={brandHref} className="brand" aria-label="Triplanio - home">
            <span className="brand__mark"><TriplanioMark /></span>
            <span>Triplanio</span>
          </a>
          <nav className="nav" aria-label={t('nav.aria_primary')}>
            {NAV.map(n => <a key={n.hash} href={navHref(n.hash)}>{t(n.tkey)}</a>)}
          </nav>
          <div className="header__right">
            <span className="header__lang"><LangDropdown value={lang} onChange={setLang} /></span>
            <button className="btn btn--primary" onClick={() => nav(ctaTarget)}>{t('landing.header.cta')}</button>
            <button className="hamburger" aria-label={t('landing.lang.label')} aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(v => !v)}>
              <Icon name={drawerOpen ? 'close' : 'menu'} />
            </button>
          </div>
        </div>
      </header>
      <div className={`drawer ${drawerOpen ? 'is-open' : ''}`} aria-hidden={!drawerOpen}>
        <ul>
          {NAV.map(n => (
            <li key={n.hash}><a href={navHref(n.hash)} onClick={() => setDrawerOpen(false)}>{t(n.tkey)}</a></li>
          ))}
        </ul>
        <div className="drawer__lang"><LangDropdown value={lang} onChange={setLang} /></div>
      </div>
    </>
  );
}

/**
 * Shared marketing footer. Same `navBase` semantics as SiteHeader for the
 * product-column section anchors.
 */
export function SiteFooter({ lang, setLang, navBase = '', brandHref = '#top' }) {
  const t = useT();
  const navHref = (hash) => `${navBase}${hash}`;
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer__top">
          <div className="footer__brand">
            <a href={brandHref} className="brand" aria-label="Triplanio - home" style={{color:'var(--ink)'}}>
              <span className="brand__mark"><TriplanioMark size={26}/></span>
              <span>Triplanio</span>
            </a>
            <p className="tagline">{t('landing.footer.tagline')}</p>
          </div>
          <div className="footer__cols">
            <div className="footer__col">
              <h4>{t('landing.footer.product')}</h4>
              <a href={navHref('#features')}>{t('landing.footer.features')}</a>
              <a href={navHref('#how')}>{t('landing.footer.how')}</a>
              <a href={navHref('#faq')}>{t('landing.footer.faq')}</a>
            </div>
            <div className="footer__col">
              <h4>{t('landing.footer.company')}</h4>
              <a href="#">{t('landing.footer.about')}</a>
              <a href="#">{t('landing.footer.contact')}</a>
            </div>
            <div className="footer__col">
              <h4>{t('landing.footer.legal')}</h4>
              <a href="/privacy">{t('landing.footer.privacy')}</a>
              <a href="/terms">{t('landing.footer.terms')}</a>
            </div>
          </div>
          <div style={{display:'flex',justifyContent:'flex-end'}}>
            <LangDropdown value={lang} onChange={setLang} direction="up"/>
          </div>
        </div>
        <div className="footer__bottom">
          <span>{t('landing.footer.copy')}</span>
          <div className="footer__social" aria-label={t('nav.aria_social')}>
            <a href="#" aria-label="Twitter / X"><Icon name="twitter" size={16}/></a>
            <a href="#" aria-label="Instagram"><Icon name="instagram" size={16} color="#E4405F"/></a>
          </div>
        </div>
      </div>
    </footer>
  );
}

/**
 * Dynamically load /landing.css on mount and remove it on unmount. Returns
 * `cssReady` once the stylesheet is in. Shared by the landing and any other
 * page that renders the marketing chrome, so the CSS lifecycle lives in one
 * place. Sets the landing palette/type/density data-attrs too.
 */
export function useLandingCss() {
  const [cssReady, setCssReady] = useState(false);
  useEffect(() => {
    const existing = document.getElementById('landing-css');
    if (existing) {
      setCssReady(true);
    } else {
      const link = document.createElement('link');
      link.id = 'landing-css';
      link.rel = 'stylesheet';
      link.href = '/landing.css';
      link.addEventListener('load', () => setCssReady(true));
      if (link.sheet) setCssReady(true);
      document.head.appendChild(link);
    }

    document.documentElement.setAttribute('data-palette', 'atlantic');
    document.documentElement.setAttribute('data-type', 'modern');
    document.documentElement.setAttribute('data-density', 'standard');

    return () => {
      const el = document.getElementById('landing-css');
      if (el) el.parentNode.removeChild(el);
      document.documentElement.removeAttribute('data-palette');
      document.documentElement.removeAttribute('data-type');
      document.documentElement.removeAttribute('data-density');
      document.documentElement.classList.remove('reveal--ready');
      setCssReady(false);
    };
  }, []);
  return cssReady;
}
