import React, {
  useState,
  useEffect,
  useRef,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { useT, useI18n } from '@/lib/i18n/I18nContext';

/* =========================================================
   Landing page - ported from triplanio_landing static site.
   Dynamically loads/unloads /landing.css to avoid style
   conflicts with the main app.
========================================================= */

const APP_URL = '/login';

/* ── i18n ── (translations live in src/lib/i18n/locales/{en,ru,es}/landing.js)
   All keys are prefixed with “landing.” in the central store.
   useT() and useI18n() are imported from the central I18nContext above.
*/

/* ── Icons ── */
const TRIPLANIO_PATH = "M33.9515 -0.266535C40.7142 -0.445139 48.1271 -0.302259 54.9281 -0.303644L94.514 -0.309503L214.845 -0.305597L278.868 -0.306574L298.193 -0.318292C310.201 -0.32163 319.364 -0.684415 329.217 7.74225C343.125 19.635 341.19 34.942 341.176 51.3067L341.157 86.3829L341.184 195.125L341.181 272.228L341.212 295.303C341.226 308.706 342.006 318.931 332.398 329.72C326.281 336.547 317.675 340.628 308.52 341.05C298.456 341.533 284.325 341.086 274.023 341.083L205.381 341.092L162.115 341.117C141.323 341.131 123.861 343.106 107.208 327.72C102.838 323.62 99.3189 318.699 96.8548 313.236C94.3907 307.774 93.0296 301.878 92.849 295.889C92.529 287.072 93.8616 280.992 96.6224 272.786C101.665 257.797 109.31 248.589 119.725 237.345C125.95 245.136 131.667 253.986 137.971 261.606C140.39 264.528 150.129 252.175 148.683 246.961C146.168 237.892 141.381 229.908 138.15 221.158C142.842 216.992 148.474 212.5 153.326 208.398C163.06 200.169 172.732 191.869 182.345 183.5C189.212 190.011 196.381 197.442 203.098 204.167L248.907 249.981C253.187 244.922 256.537 238.164 256.598 231.434C256.623 228.623 256.007 225.923 254.626 223.456C251.646 218.12 237.029 204.664 231.868 199.467C223.676 191.542 215.284 182.914 207.203 174.842L155.649 123.287L134.288 101.945C132.743 100.406 131.158 98.7783 129.626 97.3106C123.616 91.552 120.034 86.1564 110.778 87.3673C103.826 88.2767 99.8349 91.3194 94.4329 95.3995C110.556 111.824 126.807 128.124 143.183 144.297C148.913 150.046 155.228 156.051 160.75 161.915C157.391 166.37 151.717 172.659 147.998 177.059C139.745 186.812 131.56 196.623 123.442 206.489C118.102 204.22 112.747 201.983 107.379 199.78C101.261 197.23 96.1995 193.797 89.9368 198.428C79.7224 205.983 80.7549 205.52 89.9857 212.164C94.9362 215.725 102.289 220.689 106.734 224.759C102.849 229.003 98.6343 233.317 95.2406 237.848C77.4842 261.564 66.952 294.342 80.972 322.417C84.8667 330.214 88.4217 334.775 94.4671 341.075C74.9177 341.309 55.209 340.956 35.6429 341.125C25.3518 341.214 16.7477 338.183 9.43489 330.636C5.11961 326.154 2.09948 320.587 0.695637 314.525C-0.740455 308.276 -0.261685 293.256 -0.261394 286.203C-0.338339 274.2 -0.331163 262.2 -0.240887 250.2C4.18863 255.291 9.4218 259.623 15.2513 263.023C32.4055 272.939 50.165 274.236 69.1761 269.211C69.6238 268.23 70.0656 266.844 70.4095 265.786C72.6759 258.811 75.6942 252.497 79.2786 246.108C67.5692 251.37 57.4925 254.32 44.432 253.45C20.0121 252.083 0.660326 229.606 -0.104168 205.7C-0.510832 192.989 -0.272964 179.798 -0.270183 166.97L-0.275066 95.5186L-0.277019 53.2891C-0.286758 47.0065 -0.647595 34.579 0.182942 28.8214C1.1558 22.1467 4.06527 15.9035 8.55013 10.8653C15.5012 3.17884 23.8502 0.199571 33.9515 -0.266535ZM137.352 52.7081C134.062 49.9494 128.015 49.4695 123.791 49.9737C116.528 51.2496 110.458 54.6421 104.987 59.5674L279.767 234.294L284.439 238.919C289.858 231.455 294.445 222.683 293.148 213.136C292.014 204.797 284.255 198.958 278.489 193.235L260.278 175.103L196.142 110.966L155.937 70.7413C150.064 64.881 143.662 58.0002 137.352 52.7081ZM256.192 105.029C259.319 96.1169 261.478 84.3761 247.586 85.7911C231.37 88.8299 220.289 99.6272 209.231 111.022L227.431 129.133L233.775 135.479C242.589 125.851 251.686 117.855 256.192 105.029Z";

function TriplanioMark({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 341 341" aria-hidden="true">
      <path d={TRIPLANIO_PATH} fill="#2167e2" />
    </svg>
  );
}

function Icon({ name, size = 20, stroke = 'currentColor', strokeWidth = 1.6, fill = 'none', ...rest }) {
  const paths = {
    compass: <><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5 5-2z" /></>,
    timeline: <><circle cx="6" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><path d="M6 8v8" /><path d="M10 6h10" /><path d="M10 12h7" /><path d="M10 18h10" /></>,
    users: <><circle cx="9" cy="8" r="3.2" /><path d="M3 19c0-3 2.7-5 6-5s6 2 6 5" /><circle cx="17" cy="9" r="2.6" /><path d="M15 14c3 0 6 1.8 6 5" /></>,
    sparkles: <><path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6L12 4z" /><path d="M19 16l.7 1.9L21.6 18.6 19.7 19.3 19 21.2 18.3 19.3 16.4 18.6 18.3 17.9 19 16z" /></>,
    chat: <><path d="M21 12a8 8 0 1 1-3.1-6.3" /><path d="M21 5v4h-4" /><path d="M8 11h.01M12 11h.01M16 11h.01" /></>,
    wallet: <><path d="M3 7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v2H5a2 2 0 0 1-2-2z" /><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7H7a2 2 0 0 1-2-2" /><circle cx="16" cy="14" r="1.4" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
    devices: <><rect x="2" y="5" width="14" height="10" rx="1.5" /><path d="M6 19h6" /><path d="M9 15v4" /><rect x="17" y="9" width="5" height="11" rx="1.2" /></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    gift: <><rect x="3" y="9" width="18" height="5" rx="1.2" /><path d="M4 14v7h16v-7" /><path d="M12 9v12" /><path d="M12 9c-2 0-4-1-4-3a2 2 0 0 1 4 0c0 2-2 3-4 3" /><path d="M12 9c2 0 4-1 4-3a2 2 0 0 0-4 0c0 2 2 3 4 3" /></>,
    map: <><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" /><path d="M9 4v14M15 6v14" /></>,
    calendar: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16" /><path d="M9 3v4M15 3v4" /></>,
    bed: <><path d="M3 18v-7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v7" /><path d="M3 14h18" /><path d="M3 18v3M21 18v3" /><circle cx="8" cy="11.5" r="1.4" /></>,
    plane: <path d="M21 12.5 3 18l4-5-4-5 18 5.5a.5.5 0 0 1 0 1z" />,
    train: <><rect x="6" y="4" width="12" height="13" rx="3" /><path d="M6 11h12" /><path d="M9 17l-2 3M15 17l2 3" /><circle cx="9" cy="14" r=".8" fill="currentColor" stroke="none" /><circle cx="15" cy="14" r=".8" fill="currentColor" stroke="none" /></>,
    cam: <><rect x="3" y="7" width="18" height="13" rx="2" /><circle cx="12" cy="13.5" r="3.5" /><path d="M8 7l1.5-2h5L16 7" /></>,
    check: <path d="m5 12 4 4 10-10" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
    chevron: <path d="m9 6 6 6-6 6" />,
    plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
    menu: <><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></>,
    close: <><path d="m6 6 12 12" /><path d="M18 6 6 18" /></>,
    arrowRight: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
    twitter: <path d="M18.2 4h2.7l-5.9 6.8L22 20h-5.5l-4.3-5.6L7 20H4.2l6.4-7.3L4 4h5.6l3.9 5.1L18.2 4Zm-1 14.4h1.5L7.1 5.5H5.5l11.7 12.9Z" fill="currentColor" stroke="none" />,
    instagram: <><rect x="3.5" y="3.5" width="17" height="17" rx="4.5" /><circle cx="12" cy="12" r="4" /><circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none" /></>,
    telegram: <path d="m4 12 16-7-3 16-5-5-2.5 4-1-5L4 12Zm5.5 1.6 8-6.4-9.5 5.4L9.5 13.6Z" fill="currentColor" stroke="none" />,
    whatsapp: <path d="M12 3a9 9 0 0 0-7.7 13.6L3 21l4.6-1.2A9 9 0 1 0 12 3Zm5.1 12.7c-.2.6-1.2 1.1-1.7 1.2-.5.1-1 .1-1.5 0a7.3 7.3 0 0 1-2.8-1.3 9 9 0 0 1-2.8-3.3c-.3-.5-.5-1-.5-1.5 0-.6.3-1 .5-1.2.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .5.4l.7 1.6c.1.3 0 .5-.1.7l-.4.5c-.1.2-.3.3-.1.6.2.4.7 1.1 1.3 1.6.7.6 1.4.9 1.7 1 .3.1.5.1.7-.1l.6-.7c.2-.2.4-.2.6-.1l1.5.7c.3.2.4.3.4.4.1.1.1.6 0 1.2Z" fill="currentColor" stroke="none" />,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke}
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {paths[name]}
    </svg>
  );
}

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

/* ── Header ── */
const NAV = [
  { tkey:'landing.nav.features', href:'#features' },
  { tkey:'landing.nav.how', href:'#how' },
  { tkey:'landing.nav.faq', href:'#faq' },
];

function LandingHeader({ lang, setLang }) {
  const t = useT();
  const nav = useNavigate();
  const { isAuthenticated } = useAuth();
  const ctaTarget = isAuthenticated ? '/trips' : APP_URL;
  const [scrolled, setScrolled] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

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
          <a href="#top" className="brand" aria-label="Triplanio - home">
            <span className="brand__mark"><TriplanioMark /></span>
            <span>Triplanio</span>
          </a>
          <nav className="nav" aria-label="Primary">
            {NAV.map(n => <a key={n.href} href={n.href}>{t(n.tkey)}</a>)}
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
            <li key={n.href}><a href={n.href} onClick={() => setDrawerOpen(false)}>{t(n.tkey)}</a></li>
          ))}
        </ul>
        <div className="drawer__lang"><LangDropdown value={lang} onChange={setLang} /></div>
      </div>
    </>
  );
}

/* ── Hero ── */
function HeroMockup() {
  const t = useT();
  return (
    <div className="app-frame" role="img" aria-label={t('landing.mockup.trip_title')}>
      <div className="app-frame__bar">
        <span className="dot dot--r"/><span className="dot dot--y"/><span className="dot dot--g"/>
        <span className="url">triplanio.com / iberia-summer-26</span>
      </div>
      <div className="app-frame__body">
        <aside className="app-sidebar" aria-hidden="true">
          <div className="app-sidebar__group">{t('landing.mockup.trips')}</div>
          <div className="app-sidebar__item is-active"><span className="swatch swatch--lisbon"/>{t('landing.mockup.trip_title')}</div>
          <div className="app-sidebar__item"><span className="swatch" style={{background:'#8693a8'}}/>{t('landing.mockup.other_trip_1')}</div>
          <div className="app-sidebar__item"><span className="swatch" style={{background:'#8693a8'}}/>{t('landing.mockup.other_trip_2')}</div>
          <div className="app-sidebar__group">{t('landing.mockup.this_trip')}</div>
          <div className="app-sidebar__item"><span className="swatch swatch--lisbon"/>{t('landing.mockup.nights_4')}</div>
          <div className="app-sidebar__item"><span className="swatch swatch--porto"/>{t('landing.mockup.nights_2')}</div>
          <div className="app-sidebar__item"><span className="swatch swatch--bcn"/>{t('landing.mockup.nights_5')}</div>
        </aside>
        <div className="app-main">
          <div className="app-main__head">
            <div>
              <div className="app-main__title">{t('landing.mockup.trip_title')}</div>
              <div className="app-main__subtitle">{t('landing.mockup.subtitle')}</div>
            </div>
            <div className="app-tabs" aria-hidden="true">
              <span className="app-tab is-active">{t('landing.mockup.tab_timeline')}</span>
              <span className="app-tab">{t('landing.mockup.tab_calendar')}</span>
              <span className="app-tab">{t('landing.mockup.tab_map')}</span>
            </div>
          </div>
          <div className="tl">
            <div className="tl__day" data-day={t('landing.mockup.day1')}>
              <div className="tl-card"><span className="icon"><Icon name="plane"/></span><span><strong>LHR → LIS</strong> · British Airways 503</span><span className="tag">{t('landing.mockup.tag_flight')}</span><span className="meta">10:25</span></div>
              <div className="tl-card"><span className="icon"><Icon name="bed"/></span><span><strong>Memmo Alfama</strong> · {t('landing.mockup.checkin')}</span><span className="tag tag--green">{t('landing.mockup.tag_hotel')}</span><span className="meta">15:00</span></div>
            </div>
            <div className="tl__day tl__day--accent" data-day={t('landing.mockup.day2')}>
              <div className="tl-card"><span className="icon"><Icon name="cam"/></span><span><strong>Tram 28</strong> · Alfama loop</span><span className="tag tag--warm">{t('landing.mockup.tag_activity')}</span><span className="meta">10:00</span></div>
              <div className="tl-card"><span className="icon"><Icon name="cam"/></span><span><strong>Pastéis de Belém</strong> · pastry crawl</span><span className="tag tag--warm">{t('landing.mockup.tag_activity')}</span><span className="meta">15:30</span></div>
            </div>
            <div className="tl__day tl__day--green" data-day={t('landing.mockup.day3')}>
              <div className="tl-card"><span className="icon"><Icon name="train"/></span><span><strong>Lisbon → Porto</strong> · Alfa Pendular</span><span className="tag">{t('landing.mockup.tag_transfer')}</span><span className="meta">08:39</span></div>
              <div className="tl-card"><span className="icon"><Icon name="bed"/></span><span><strong>Torel Avantgarde</strong> · {t('landing.mockup.checkin')}</span><span className="tag tag--green">{t('landing.mockup.tag_hotel')}</span><span className="meta">14:00</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Hero() {
  const t = useT();
  const nav = useNavigate();
  const { isAuthenticated } = useAuth();
  const ctaTarget = isAuthenticated ? '/trips' : APP_URL;
  return (
    <section className="hero" id="top">
      <div className="container">
        <div className="hero__grid">
          <div className="hero__copy reveal">
            <h1>{t('landing.hero.h1_a')}<span className="break"><span className="accent">{t('landing.hero.h1_b_accent')}</span> {t('landing.hero.h1_c')}</span></h1>
            <p className="hero__lede">{t('landing.hero.lede')}</p>
            <div className="hero__ctas">
              <button className="btn btn--primary btn--lg" onClick={() => nav(ctaTarget)}>{t('landing.hero.cta_primary')} <Icon name="arrowRight" size={16} className="chev"/></button>
              <a className="btn btn--ghost btn--lg" href="#how">{t('landing.hero.cta_secondary')}</a>
            </div>
            <div className="hero__trust">
              <span>{t('landing.hero.trust_free')}</span><span className="dot"/><span>{t('landing.hero.trust_no_card')}</span><span className="dot"/><span>{t('landing.hero.trust_languages')}</span>
            </div>
          </div>
          <div className="hero__visual reveal" style={{transitionDelay:'120ms'}}>
            <HeroMockup/>
            <div className="float float--budget" aria-hidden="true">
              <div style={{fontSize: 'var(--fs-micro)',color:'var(--muted)',fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase'}}>{t('landing.float.trip_budget')}</div>
              <div style={{display:'flex',alignItems:'baseline',gap:8,marginTop:4}}>
                <strong style={{fontFamily:'var(--font-display)',fontSize: 'var(--fs-h2)',letterSpacing:'-0.02em',fontVariantNumeric:'tabular-nums'}}>€4,820</strong>
                <span style={{fontSize: 'var(--fs-micro)',color:'var(--muted)'}}>· $5,210 · ₽491k</span>
              </div>
            </div>
            <div className="float float--chat" aria-hidden="true">
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <span style={{width:22,height:22,borderRadius:'50%',background:'linear-gradient(135deg, var(--brand), #5b8fff)',color:'#fff',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize: 'var(--fs-micro)',fontWeight:700}}>AI</span>
                <div style={{fontSize: 'var(--fs-meta)',lineHeight:1.3}}>
                  <div style={{fontWeight:600}}>{t('landing.float.leave_at_title')}</div>
                  <div style={{color:'var(--muted)',fontSize: 'var(--fs-micro)'}}>{t('landing.float.leave_at_sub')}</div>
                </div>
              </div>
            </div>
            <div className="float float--pins" aria-hidden="true">
              <div style={{display:'flex',alignItems:'center',gap:6,fontSize: 'var(--fs-micro)',fontWeight:600}}>
                <span style={{width:6,height:6,borderRadius:'50%',background:'var(--brand)'}}/>{t('landing.city.lisbon')}
                <span style={{width:14,height:1,background:'var(--line)'}}/>
                <span style={{width:6,height:6,borderRadius:'50%',background:'var(--warm)'}}/>{t('landing.city.porto')}
                <span style={{width:14,height:1,background:'var(--line)'}}/>
                <span style={{width:6,height:6,borderRadius:'50%',background:'var(--success)'}}/>{t('landing.city.barcelona')}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Problem ── */
function Problem() {
  const t = useT();
  return (
    <section className="section section--wash">
      <div className="container">
        <div className="problem reveal">
          <div>
            <span className="eyebrow">{t('landing.problem.eyebrow')}</span>
            <h2 style={{marginTop:16}}>{t('landing.problem.h2_a')}<br/>{t('landing.problem.h2_b')}</h2>
            <p className="lede" style={{marginTop:18}}>{t('landing.problem.lede')}</p>
          </div>
          <div className="collage" aria-hidden="true">
            <div className="collage__card collage__card--mail">
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
                <span style={{width:8,height:8,borderRadius:2,background:'#ea4335'}}/>
                <span style={{fontSize: 'var(--fs-micro)',fontWeight:700,color:'var(--muted)',letterSpacing:'.06em',textTransform:'uppercase'}}>{t('landing.problem.inbox')}</span>
              </div>
              {[['B',t('landing.problem.mail1_from'),t('landing.problem.mail1_subj')],['BA',t('landing.problem.mail2_from'),t('landing.problem.mail2_subj')],['CP',t('landing.problem.mail3_from'),t('landing.problem.mail3_subj')]].map(([av,from,subj]) => (
                <div className="mailrow" key={from}>
                  <span className="avatar">{av}</span>
                  <div className="lines"><div className="from">{from}</div><div className="subj">{subj}</div></div>
                </div>
              ))}
            </div>
            <div className="collage__card collage__card--notes">
              <div style={{fontWeight:700,marginBottom:8}}>{t('landing.problem.notes_title')}</div>
              <div style={{color:'#7c6b3a',lineHeight:1.6}} dangerouslySetInnerHTML={{__html:t('landing.problem.notes_body_html')}}/>
            </div>
            <div className="collage__card collage__card--tabs">
              <div className="tabstrip">
                {[t('landing.problem.tab1'),t('landing.problem.tab2'),t('landing.problem.tab3'),t('landing.problem.tab4')].map(tab => <span className="t" key={tab}>{tab}</span>)}
              </div>
              <div className="tabsbody">{t('landing.problem.tabs_body')}</div>
            </div>
          </div>
        </div>
        <p className="problem__handoff reveal">{t('landing.problem.handoff')}</p>
      </div>
    </section>
  );
}

/* ── Features ── */
function BudgetMini() {
  const t = useT();
  const rows = [
    {k:'landing.mini.hotels',pct:42,amt:'€2,025',ccy:'$2,190',color:'#2167e2'},
    {k:'landing.mini.flights',pct:28,amt:'€1,350',ccy:'$1,460',color:'#5b8fff'},
    {k:'landing.mini.activities',pct:18,amt:'€868',ccy:'$938',color:'#c9603a'},
    {k:'landing.mini.food',pct:12,amt:'€577',ccy:'$624',color:'#1f8a5b'},
  ];
  return (
    <div className="budget" style={{padding:0}}>
      <div className="budget__total" style={{marginBottom:12}}>
        <span className="big" style={{fontSize: 'var(--fs-h2)'}}>€4,820</span>
        <span className="delta">{t('landing.mini.under')}</span>
      </div>
      <div className="budget__bar" style={{marginBottom:12}}>
        {rows.map(r => <i key={r.k} style={{width:`${r.pct}%`,background:r.color}}/>)}
      </div>
      <div className="budget__rows">
        {rows.map(r => (
          <div className="budget__row" key={r.k}>
            <span className="sw" style={{background:r.color}}/><span>{t(r.k)}</span>
            <span className="amt">{r.amt}</span><span className="ccy">{r.ccy}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Features() {
  const t = useT();
  const FEATURES = [
    {icon:'timeline',titleKey:'landing.f.timeline.title',bodyKey:'landing.f.timeline.body'},
    {icon:'users',titleKey:'landing.f.together.title',bodyKey:'landing.f.together.body'},
    {icon:'sparkles',titleKey:'landing.f.ai.title',bodyKey:'landing.f.ai.body',warm:true},
    {icon:'telegram',titleKey:'landing.f.concierge.title',bodyKey:'landing.f.concierge.body'},
    {icon:'wallet',titleKey:'landing.f.budget.title',bodyKey:'landing.f.budget.body',wide:true},
  ];
  return (
    <section className="section" id="features">
      <div className="container">
        <div className="section__head reveal">
          <span className="eyebrow">{t('landing.features.eyebrow')}</span>
          <h2>{t('landing.features.h2')}</h2>
          <p className="lede" style={{margin:'14px auto 0'}}>{t('landing.features.lede')}</p>
        </div>
        <div className="features">
          {FEATURES.map(f => (
            <article className={`card reveal ${f.wide?'card--wide':''}`} key={f.titleKey}>
              <div>
                <span className={`card__icon ${f.warm?'card__icon--warm':''}`}><Icon name={f.icon} size={22}/></span>
                <h3>{t(f.titleKey)}</h3>
                <p>{t(f.bodyKey)}</p>
              </div>
              {f.wide && <div className="preview" aria-hidden="true"><BudgetMini/></div>}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── How It Works ── */
function StepThumb({ kind }) {
  const t = useT();
  if (kind === 'create') return (
    <div className="step__thumb" aria-hidden="true">
      <div style={{fontSize: 'var(--fs-micro)',color:'var(--muted)',fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',marginBottom:8}}>{t('landing.thumb.new_trip')}</div>
      <div style={{display:'grid',gap:8}}>
        <div style={{height:32,borderRadius:8,border:'1px solid var(--line)',display:'flex',alignItems:'center',padding:'0 10px',fontSize: 'var(--fs-meta)',color:'var(--ink)'}}>
          <span style={{color:'var(--muted)',marginRight:8}}>{t('landing.thumb.where')}</span>{t('landing.city.lisbon')} · {t('landing.city.porto')} · {t('landing.city.barcelona')}
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
          <div style={{height:32,borderRadius:8,border:'1px solid var(--line)',display:'flex',alignItems:'center',padding:'0 10px',fontSize: 'var(--fs-meta)'}}><span style={{color:'var(--muted)',marginRight:6}}>{t('landing.thumb.from')}</span>{t('landing.thumb.from_date')}</div>
          <div style={{height:32,borderRadius:8,border:'1px solid var(--line)',display:'flex',alignItems:'center',padding:'0 10px',fontSize: 'var(--fs-meta)'}}><span style={{color:'var(--muted)',marginRight:6}}>{t('landing.thumb.to')}</span>{t('landing.thumb.to_date')}</div>
        </div>
        <div style={{display:'flex',gap:6,fontSize: 'var(--fs-micro)'}}>
          <span style={{background:'rgba(33,103,226,.08)',color:'var(--brand)',padding:'3px 10px',borderRadius:999,fontWeight:600}}>{t('landing.thumb.organizer')}</span>
          <span style={{background:'var(--wash)',color:'var(--muted)',padding:'3px 10px',borderRadius:999,fontWeight:600}}>{t('landing.thumb.travelers')}</span>
        </div>
      </div>
    </div>
  );
  if (kind === 'ai') return (
    <div className="step__thumb" aria-hidden="true">
      <div style={{fontSize: 'var(--fs-micro)',color:'var(--muted)',fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',marginBottom:8}}>{t('landing.thumb.ai_planner')}</div>
      <div style={{background:'var(--wash)',borderRadius:8,padding:'10px 12px',fontSize: 'var(--fs-meta)',color:'var(--ink-2)',lineHeight:1.5}}>{t('landing.thumb.ai_prompt')}</div>
      <div style={{display:'grid',gap:6,marginTop:10}}>
        {['landing.thumb.ai_result_1','landing.thumb.ai_result_2','landing.thumb.ai_result_3'].map(k => (
          <div key={k} style={{fontSize: 'var(--fs-meta)',padding:'8px 10px',background:'#fff',border:'1px solid var(--line)',borderRadius:8,display:'flex',alignItems:'center',gap:8}}>
            <span style={{width:6,height:6,borderRadius:'50%',background:'var(--brand)'}}/>{t(k)}
          </div>
        ))}
      </div>
    </div>
  );
  return (
    <div className="step__thumb" aria-hidden="true">
      <div style={{fontSize: 'var(--fs-micro)',color:'var(--muted)',fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',marginBottom:8}}>{t('landing.thumb.day_of_travel')}</div>
      <div style={{display:'grid',gap:8}}>
        <div style={{display:'flex',alignItems:'center',gap:8,fontSize: 'var(--fs-meta)'}}>
          <span style={{width:22,height:22,borderRadius:'50%',background:'linear-gradient(135deg, var(--brand), #5b8fff)',color:'#fff',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize: 'var(--fs-micro)',fontWeight:700}}>AI</span>
          <div style={{background:'#eef2f9',padding:'8px 10px',borderRadius:10,borderBottomLeftRadius:4}}>{t('landing.thumb.cancel_msg')}</div>
        </div>
        <div style={{alignSelf:'flex-end',background:'var(--brand)',color:'#fff',padding:'8px 10px',borderRadius:10,borderBottomRightRadius:4,fontSize: 'var(--fs-meta)',maxWidth:'80%'}}>{t('landing.thumb.confirm')}</div>
        <div style={{display:'flex',alignItems:'center',gap:6,fontSize: 'var(--fs-micro)',color:'var(--muted)'}}>
          <span style={{width:6,height:6,borderRadius:50,background:'var(--success)'}}/>{t('landing.thumb.confirmed')}
        </div>
      </div>
    </div>
  );
}

function HowItWorks() {
  const t = useT();
  const steps = [
    {num:'1',kind:'create',titleKey:'landing.how.s1.title',bodyKey:'landing.how.s1.body'},
    {num:'2',kind:'ai',titleKey:'landing.how.s2.title',bodyKey:'landing.how.s2.body'},
    {num:'3',kind:'travel',titleKey:'landing.how.s3.title',bodyKey:'landing.how.s3.body'},
  ];
  return (
    <section className="section" id="how">
      <div className="container">
        <div className="section__head reveal" style={{marginBottom:64}}>
          <span className="eyebrow">{t('landing.how.eyebrow')}</span>
          <h2>{t('landing.how.h2')}</h2>
        </div>
        <div className="steps">
          {steps.map((s,i) => (
            <div className="step reveal" key={s.num} style={{transitionDelay:`${i*80}ms`}}>
              <span className="step__num">{s.num}</span>
              <h3>{t(s.titleKey)}</h3>
              <p>{t(s.bodyKey)}</p>
              <StepThumb kind={s.kind}/>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Deep Dives ── */
function ThreeViewsVisual() {
  const t = useT();
  const [view, setView] = useState('Map');
  const tabs = [{id:'Timeline',labelKey:'landing.mockup.tab_timeline'},{id:'Calendar',labelKey:'landing.mockup.tab_calendar'},{id:'Map',labelKey:'landing.mockup.tab_map'}];
  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'14px 16px',borderBottom:'1px solid var(--line-2)'}}>
        <div style={{fontSize: 'var(--fs-meta)',color:'var(--muted)',fontWeight:600,letterSpacing:'.05em',textTransform:'uppercase'}}>{t('landing.mockup.trip_title')}</div>
        <div className="app-tabs">
          {tabs.map(tab => (
            <button key={tab.id} type="button" className={`app-tab ${view===tab.id?'is-active':''}`}
              onClick={() => setView(tab.id)} style={{cursor:'pointer',border:0}}>{t(tab.labelKey)}</button>
          ))}
        </div>
      </div>
      {view === 'Map' && (
        <div className="mapviz">
          <svg viewBox="0 0 600 320" preserveAspectRatio="none">
            <defs><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" fill="none" stroke="#dde3ee" strokeWidth="0.6"/></pattern></defs>
            <rect width="600" height="320" fill="url(#grid)"/>
            <path d="M40,240 Q90,200 130,210 T220,190 Q260,170 320,180 T440,160 Q500,150 560,170" fill="none" stroke="#cfd6e3" strokeWidth="1.5" strokeDasharray="4 4"/>
            <path d="M120,210 C200,180 240,200 290,170 C360,130 420,150 470,130" fill="none" stroke="#2167e2" strokeWidth="2.4" strokeLinecap="round" strokeDasharray="6 6">
              <animate attributeName="stroke-dashoffset" from="0" to="-12" dur="1.2s" repeatCount="indefinite"/>
            </path>
          </svg>
          <div className="pin" style={{left:'20%',top:'70%'}}><span className="pin__dot"/><span className="pin__lbl">{t('landing.city.lisbon')}</span></div>
          <div className="pin" style={{left:'48%',top:'55%'}}><span className="pin__dot" style={{background:'var(--warm)'}}/><span className="pin__lbl">{t('landing.city.porto')}</span></div>
          <div className="pin" style={{left:'78%',top:'44%'}}><span className="pin__dot" style={{background:'var(--success)'}}/><span className="pin__lbl">{t('landing.city.barcelona')}</span></div>
        </div>
      )}
      {view === 'Calendar' && (
        <div style={{padding:22}}>
          <div style={{display:'grid',gridTemplateColumns:'repeat(7, 1fr)',gap:6,fontSize: 'var(--fs-micro)'}}>
            {['M','T','W','T','F','S','S'].map((d,i) => <div key={i} style={{textAlign:'center',color:'var(--muted)',fontWeight:600,padding:'4px 0'}}>{d}</div>)}
            {Array.from({length:28}).map((_,i) => {
              const day=i+1, inTrip=day>=12&&day<=23;
              const city=day<16?'lis':day<18?'transfer':day<19?'por':'bcn';
              const bg=!inTrip?'transparent':city==='lis'?'rgba(33,103,226,.18)':city==='por'?'rgba(201,96,58,.18)':city==='transfer'?'repeating-linear-gradient(45deg, rgba(33,103,226,.15) 0 4px, rgba(201,96,58,.15) 4px 8px)':'rgba(31,138,91,.18)';
              return <div key={i} style={{height:38,background:bg,borderRadius:8,display:'flex',alignItems:'flex-start',justifyContent:'flex-start',padding:6,fontSize: 'var(--fs-micro)',fontWeight:600,color:inTrip?'var(--ink)':'var(--muted-2)',border:inTrip?0:'1px solid var(--line-2)'}}>{day}</div>;
            })}
          </div>
          <div style={{display:'flex',gap:14,marginTop:12,fontSize: 'var(--fs-micro)',color:'var(--muted)'}}>
            <span><i style={{display:'inline-block',width:10,height:10,background:'rgba(33,103,226,.5)',borderRadius:3,marginRight:6}}/>{t('landing.city.lisbon')}</span>
            <span><i style={{display:'inline-block',width:10,height:10,background:'rgba(201,96,58,.5)',borderRadius:3,marginRight:6}}/>{t('landing.city.porto')}</span>
            <span><i style={{display:'inline-block',width:10,height:10,background:'rgba(31,138,91,.5)',borderRadius:3,marginRight:6}}/>{t('landing.city.barcelona')}</span>
          </div>
        </div>
      )}
      {view === 'Timeline' && (
        <div style={{padding:22}}>
          <div style={{display:'grid',gap:8}}>
            {[
              {d:'Jul 12',title:`${t('landing.mockup.tag_flight')} LHR → LIS`,tagKey:'landing.mockup.tag_flight',color:'var(--brand)'},
              {d:'Jul 13',title:'Tram 28',tagKey:'landing.mockup.tag_activity',color:'var(--warm)'},
              {d:'Jul 16',title:`${t('landing.mockup.tag_transfer')} ${t('landing.city.lisbon')} → ${t('landing.city.porto')}`,tagKey:'landing.mockup.tag_transfer',color:'var(--brand)'},
              {d:'Jul 18',title:`${t('landing.mockup.tag_flight')} ${t('landing.city.porto')} → BCN`,tagKey:'landing.mockup.tag_flight',color:'var(--brand)'},
              {d:'Jul 21',title:'Sagrada Família',tagKey:'landing.mockup.tag_activity',color:'var(--warm)'},
            ].map((r,i) => (
              <div key={i} style={{display:'grid',gridTemplateColumns:'70px 1fr auto',alignItems:'center',gap:10,background:'#fff',border:'1px solid var(--line)',borderRadius:10,padding:'10px 12px',fontSize: 'var(--fs-base)'}}>
                <span style={{color:'var(--muted)',fontWeight:600,fontSize: 'var(--fs-micro)'}}>{r.d}</span>
                <span>{r.title}</span>
                <span style={{fontSize: 'var(--fs-micro)',padding:'2px 8px',borderRadius:999,background:'rgba(33,103,226,.08)',color:r.color,fontWeight:600}}>{t(r.tagKey)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PlannerVisual() {
  const t = useT();
  return (
    <div className="chat" aria-hidden="true">
      <div className="bubble bubble--user">{t('landing.planner.user_msg')}</div>
      <div className="bubble bubble--ai">{t('landing.planner.ai_msg')}<div style={{marginTop:6}}><span className="typing"><span/><span/><span/></span></div></div>
      <div style={{display:'grid',gap:8,marginTop:4}}>
        {[
          {icon:'bed',name:t('landing.planner.res_lisbon'),sub:t('landing.planner.res_lisbon_sub'),badge:t('landing.planner.badge_stay')},
          {icon:'train',name:t('landing.planner.res_train'),sub:t('landing.planner.res_train_sub'),badge:t('landing.planner.badge_transfer')},
          {icon:'bed',name:t('landing.planner.res_porto'),sub:t('landing.planner.res_porto_sub'),badge:t('landing.planner.badge_stay')},
          {icon:'plane',name:t('landing.planner.res_flight'),sub:t('landing.planner.res_flight_sub'),badge:t('landing.planner.badge_flight')},
        ].map((r,i) => (
          <div className="planresult" key={i}>
            <Icon name={r.icon}/><div><strong>{r.name}</strong><div style={{color:'var(--muted)',fontSize: 'var(--fs-micro)'}}>{r.sub}</div></div>
            <span className="badge">{r.badge}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConciergeVisual() {
  const t = useT();
  return (
    <div style={{background:'linear-gradient(180deg, #eef2f9, #f6f8fc)',padding:24}}>
      <div className="phone">
        <div className="phone__head">
          <span className="av">T</span>
          <div><div className="name">Triplanio</div><div className="sub">{t('landing.phone.via')}</div></div>
          <Icon name="telegram" size={16} stroke="none" fill="#2167e2" style={{marginLeft:'auto'}}/>
        </div>
        <div className="phone__body">
          <div className="phone__time">{t('landing.phone.today')}</div>
          <div className="bubble bubble--ai">{t('landing.phone.b1')}</div>
          <div className="bubble bubble--user" style={{alignSelf:'flex-end'}}>{t('landing.phone.u1')}</div>
          <div className="bubble bubble--ai">{t('landing.phone.b2')}</div>
          <div className="bubble bubble--user" style={{alignSelf:'flex-end'}}>{t('landing.phone.u2')}</div>
          <div className="bubble bubble--ai">{t('landing.phone.b3')}</div>
        </div>
      </div>
    </div>
  );
}

function BudgetVisual() {
  const t = useT();
  const rows = [
    {k:'landing.mini.hotels',pct:42,amt:'€2,025',ccy:'$2,190',color:'#2167e2'},
    {k:'landing.mini.flights',pct:28,amt:'€1,350',ccy:'$1,460',color:'#5b8fff'},
    {k:'landing.mini.transfers',pct:9,amt:'€434',ccy:'$469',color:'#9bb6ff'},
    {k:'landing.mini.activities',pct:13,amt:'€627',ccy:'$678',color:'#c9603a'},
    {k:'landing.mini.food_misc',pct:8,amt:'€384',ccy:'$415',color:'#1f8a5b'},
  ];
  return (
    <div className="budget">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
        <span style={{fontSize: 'var(--fs-meta)',color:'var(--muted)',fontWeight:600,letterSpacing:'.05em',textTransform:'uppercase'}}>{t('landing.mini.total')}</span>
        <span style={{fontSize: 'var(--fs-micro)',color:'var(--muted)'}}>{t('landing.mini.home_ccy')}</span>
      </div>
      <div className="budget__total"><span className="big">€4,820</span><span className="delta">{t('landing.mini.under_plan')}</span></div>
      <div className="budget__bar">{rows.map(r => <i key={r.k} style={{width:`${r.pct}%`,background:r.color}}/>)}</div>
      <div className="budget__rows" style={{marginTop:8}}>
        {rows.map(r => <div className="budget__row" key={r.k}><span className="sw" style={{background:r.color}}/><span>{t(r.k)}</span><span className="amt">{r.amt}</span><span className="ccy">{r.ccy}</span></div>)}
      </div>
    </div>
  );
}

function DeepDive({ reverse, eyebrowKey, titleKey, bodyKey, highlightKeys, children }) {
  const t = useT();
  return (
    <div className={`deep ${reverse?'deep--reverse':''} reveal`}>
      <div className="deep__copy">
        <span className="tag-eyebrow"><span className="dot"/>{t(eyebrowKey)}</span>
        <h3>{t(titleKey)}</h3>
        <p>{t(bodyKey)}</p>
        <ul className="deep__highlights">
          {highlightKeys.map(k => (
            <li key={k}><span className="check"><Icon name="check" size={12} strokeWidth={2.4}/></span><span>{t(k)}</span></li>
          ))}
        </ul>
      </div>
      <div className="deep__visual">{children}</div>
    </div>
  );
}

function DeepDives() {
  const t = useT();
  return (
    <section className="section section--wash">
      <div className="container">
        <div className="section__head section__head--left reveal" style={{marginBottom:16}}>
          <span className="eyebrow">{t('landing.dd.eyebrow')}</span>
          <h2 style={{maxWidth:'18ch'}}>{t('landing.dd.h2')}</h2>
        </div>
        <DeepDive eyebrowKey="landing.dd.threeviews.eyebrow" titleKey="landing.dd.threeviews.title" bodyKey="landing.dd.threeviews.body" highlightKeys={['landing.dd.threeviews.h1','landing.dd.threeviews.h2','landing.dd.threeviews.h3']}><ThreeViewsVisual/></DeepDive>
        <DeepDive reverse eyebrowKey="landing.dd.planner.eyebrow" titleKey="landing.dd.planner.title" bodyKey="landing.dd.planner.body" highlightKeys={['landing.dd.planner.h1','landing.dd.planner.h2','landing.dd.planner.h3']}><PlannerVisual/></DeepDive>
        <DeepDive eyebrowKey="landing.dd.concierge.eyebrow" titleKey="landing.dd.concierge.title" bodyKey="landing.dd.concierge.body" highlightKeys={['landing.dd.concierge.h1','landing.dd.concierge.h2','landing.dd.concierge.h3']}><ConciergeVisual/></DeepDive>
        <DeepDive reverse eyebrowKey="landing.dd.budget.eyebrow" titleKey="landing.dd.budget.title" bodyKey="landing.dd.budget.body" highlightKeys={['landing.dd.budget.h1','landing.dd.budget.h2','landing.dd.budget.h3']}><BudgetVisual/></DeepDive>
      </div>
    </section>
  );
}

/* ── Trust ── */
function Trust() {
  const t = useT();
  const items = [{icon:'globe',key:'landing.trust.languages'},{icon:'devices',key:'landing.trust.devices'},{icon:'lock',key:'landing.trust.privacy'},{icon:'gift',key:'landing.trust.free'}];
  return (
    <section className="section section--tight">
      <div className="container">
        <div className="trust reveal" style={{border:'1px solid var(--line)',borderRadius:16}}>
          {items.map(it => (
            <div className="trust__item" key={it.key}>
              <span className="icon"><Icon name={it.icon} size={18}/></span><span>{t(it.key)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── FAQ ── */
const FAQ_KEYS = ['landing.faq.q1','landing.faq.q2','landing.faq.q3','landing.faq.q4','landing.faq.q5','landing.faq.q6','landing.faq.q7'].map((q,i) => ({q,a:`landing.faq.a${i+1}`}));

function FAQ() {
  const t = useT();
  const [open, setOpen] = useState(null);
  return (
    <section className="section" id="faq">
      <div className="container">
        <div className="faq">
          <div className="faq__intro reveal">
            <span className="eyebrow">{t('landing.faq.eyebrow')}</span>
            <h2>{t('landing.faq.h2')}</h2>
            <p>{t('landing.faq.lede')}</p>
          </div>
          <div className="faq__list reveal">
            {FAQ_KEYS.map((f,i) => {
              const isOpen = open === i;
              return (
                <div className={`faq__item ${isOpen?'is-open':''}`} key={f.q}>
                  <button className="faq__q" aria-expanded={isOpen} onClick={() => setOpen(isOpen?null:i)}>
                    <span>{t(f.q)}</span>
                    <span className="plus"><Icon name="plus" size={16} strokeWidth={2.2}/></span>
                  </button>
                  <div className="faq__a"><div className="faq__a-inner">{t(f.a)}</div></div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Final CTA ── */
function FinalCTA() {
  const t = useT();
  const nav = useNavigate();
  const { isAuthenticated } = useAuth();
  const ctaTarget = isAuthenticated ? '/trips' : APP_URL;
  return (
    <section className="banner">
      <div className="reveal" style={{position:'relative',zIndex:1}}>
        <h2>{t('landing.finalcta.h2')}</h2>
        <p>{t('landing.finalcta.lede')}</p>
        <button className="btn btn--white btn--lg" style={{marginTop:32}} onClick={() => nav(ctaTarget)}>
          {t('landing.finalcta.cta')} <Icon name="arrowRight" size={16} className="chev"/>
        </button>
      </div>
    </section>
  );
}

/* ── Footer ── */
function LandingFooter({ lang, setLang }) {
  const t = useT();
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer__top">
          <div className="footer__brand">
            <a href="#top" className="brand" aria-label="Triplanio - home" style={{color:'var(--ink)'}}>
              <span className="brand__mark"><TriplanioMark size={26}/></span>
              <span>Triplanio</span>
            </a>
            <p className="tagline">{t('landing.footer.tagline')}</p>
          </div>
          <div className="footer__cols">
            <div className="footer__col">
              <h4>{t('landing.footer.product')}</h4>
              <a href="#features">{t('landing.footer.features')}</a>
              <a href="#how">{t('landing.footer.how')}</a>
              <a href="#faq">{t('landing.footer.faq')}</a>
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
          <div className="footer__social" aria-label="Social">
            <a href="#" aria-label="Twitter / X"><Icon name="twitter" size={16}/></a>
            <a href="#" aria-label="Instagram"><Icon name="instagram" size={16}/></a>
          </div>
        </div>
      </div>
    </footer>
  );
}

/* ── Scroll reveal ──
   Runs only AFTER cssReady - earlier we kicked the effect off at mount
   with [] deps, which meant LandingPage was still in its `return null`
   path: querySelectorAll('.reveal') found nothing, the IntersectionObserver
   was left observing zero elements, and below-the-fold sections never
   revealed. Gating on `ready` (passed from cssReady) guarantees the DOM
   already contains the .reveal nodes. */
function useScrollReveal(ready) {
  useEffect(() => {
    if (!ready) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (typeof IntersectionObserver === 'undefined') return;
    document.documentElement.classList.add('reveal--ready');
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      }
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.01 });
    document.querySelectorAll('.reveal:not(.is-in)').forEach(el => io.observe(el));
    // Safety net: force-show anything already in the viewport after
    // layout settles (fonts/images), in case IO misses a fast shift.
    const flush = () => {
      const vh = window.innerHeight;
      document.querySelectorAll('.reveal:not(.is-in)').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.top < vh && r.bottom > 0) el.classList.add('is-in');
      });
    };
    const timers = [setTimeout(flush, 50), setTimeout(flush, 300), setTimeout(flush, 1200)];
    return () => {
      timers.forEach(clearTimeout);
      io.disconnect();
      document.documentElement.classList.remove('reveal--ready');
    };
  }, [ready]);
}

/* ── Main LandingPage ── */
export default function LandingPage() {
  const { lang, setLang: setLangCentral } = useI18n();
  const [cssReady, setCssReady] = useState(false);

  // Landing has only a light theme. A dark theme stored from the authed app sets
  // `.dark` / [data-theme=dark] on <html>, which leaked dark TEXT colors onto the
  // always-light landing. Force light here.
  useEffect(() => {
    const r = document.documentElement;
    r.classList.remove('dark');
    r.setAttribute('data-theme', 'light');
  }, []);

  // Update <html lang> attribute whenever central lang changes
  useEffect(() => {
    document.documentElement.setAttribute('lang', lang);
  }, [lang]);

  const setLang = (next) => {
    setLangCentral(next);
  };

  /* Dynamically load landing CSS on mount, remove on unmount */
  useEffect(() => {
    /* If already loaded (e.g. hot reload), mark ready immediately */
    const existing = document.getElementById('landing-css');
    if (existing) {
      setCssReady(true);
    } else {
      const link = document.createElement('link');
      link.id = 'landing-css';
      link.rel = 'stylesheet';
      link.href = '/landing.css';
      link.addEventListener('load', () => setCssReady(true));
      /* Fallback: if load event fires before listener (cached) */
      if (link.sheet) setCssReady(true);
      document.head.appendChild(link);
    }

    /* Set landing theme attrs */
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

  useScrollReveal(cssReady);

  /* Don't render until landing CSS is loaded - prevents flash of unstyled content */
  if (!cssReady) return null;

  return (
    <>
      <LandingHeader lang={lang} setLang={setLang} />
      <main>
        <Hero />
        <Problem />
        <Features />
        <HowItWorks />
        <DeepDives />
        <Trust />
        <FAQ />
        <FinalCTA />
      </main>
      <LandingFooter lang={lang} setLang={setLang} />
    </>
  );
}
