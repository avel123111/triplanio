import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { track, withVisitCampaign } from '@/lib/analytics';
import { useAuth } from '@/lib/AuthContext';
import { useT, useI18n } from '@/lib/i18n/I18nContext';
import {
  SiteHeader, SiteFooter, useSiteCss, useSiteTheme, useDocumentMeta,
} from '@/components/site/SiteChrome';

/* =========================================================
   Landing page — ported from the v5.7 prototype (TRIP-460).
   Marketing header/footer + the /site.css lifecycle live in the shared
   @/components/site/SiteChrome module (reused by the public shared-trip page).
   This file owns only the landing's own sections, which are being ported one
   at a time. Section CSS lives in public/site.css under "Landing body".
========================================================= */

const APP_URL = '/login';

/**
 * Hero three-layer photo composite (TRIP-460 §10). The DESKTOP hero is a single
 * flat-lay photo fitted BY HEIGHT so the phone in it holds ~62% of the viewport
 * height on any monitor; a hover over the phone cross-fades to the "screen on"
 * frame. All of that geometry is measured off the fixed desktop frames
 * (desk-flatlay / desk-app, 3400×1914) and lives in the `FRAME` data object —
 * those images do not change. The MOBILE frame (the one Pavel swaps later) is a
 * plain CSS `cover` layer with NO JS geometry, so replacing /site/hero-mobile.webp
 * never touches FRAME. Runs only once the site CSS is in (the .hero nodes exist).
 */
function useHeroFrame(ready) {
  useEffect(() => {
    if (!ready) return undefined;
    const hero = document.querySelector('.hero');
    if (!hero) return undefined;
    const bg = hero.querySelector('.hero-bg');
    const la = hero.querySelector('.hero-layer.hero-la');
    const lb = hero.querySelector('.hero-layer.hero-lb');
    const hot = hero.querySelector('.hero-hot');
    if (!bg || !la || !lb || !hot) return undefined;

    // Phone measured off the 3400×1914 frame (x 1461..1957, y 365..1485):
    // cx/cy = phone centre in frame fractions; box = its extent for the hot zone.
    const FRAME = { ar: 3400 / 1914, zoom: 1.08, cx: 0.5026, cy: 0.4833, box: [0.4297, 0.1907, 0.5756, 0.7759] };
    const A = FRAME, B = FRAME;
    const TX = 0.68, TY = 0.452; // where the phone centre lands inside the viewport
    const mq = window.matchMedia('(max-width:980px)');

    const apply = (el, w, h, l, t) => {
      el.style.backgroundSize = `${w.toFixed(1)}px ${h.toFixed(1)}px`;
      el.style.backgroundPosition = `${l.toFixed(1)}px ${t.toFixed(1)}px`;
      // Dissolve a leftover top/left margin into the blurred fill behind it.
      let m = '';
      if (t > 2) {
        const fv = Math.min(200, Math.max(110, t));
        m = `linear-gradient(180deg,rgba(0,0,0,0) ${t.toFixed(0)}px,rgba(0,0,0,1) ${(t + fv).toFixed(0)}px)`;
      } else if (l > 2) {
        const fh = Math.min(220, Math.max(90, l));
        m = `linear-gradient(90deg,rgba(0,0,0,0) ${l.toFixed(0)}px,rgba(0,0,0,1) ${(l + fh).toFixed(0)}px)`;
      }
      el.style.webkitMaskImage = m;
      el.style.maskImage = m;
    };

    const place = () => {
      const mob = mq.matches;
      hero.classList.toggle('is-mob', mob);
      if (mob) {
        // Mobile: the photo is a plain CSS cover — strip any desktop geometry.
        [la, lb].forEach((el) => {
          el.style.backgroundSize = '';
          el.style.backgroundPosition = '';
          el.style.webkitMaskImage = '';
          el.style.maskImage = '';
        });
        hot.style.display = 'none';
        hero.classList.remove('is-zoom');
        return;
      }
      const cw = bg.clientWidth, ch = bg.clientHeight;
      if (!cw || !ch) return;
      const fit = (el, c) => {
        const h = ch * c.zoom, w = h * c.ar;
        const l = cw * TX - w * c.cx;
        const t = ch * TY - h * c.cy;
        apply(el, w, h, l, t);
        return { w, h, l, t };
      };
      const g = fit(la, A);
      fit(lb, B);
      const b = A.box;
      hot.style.display = 'block';
      hot.style.left = `${(g.l + g.w * b[0]).toFixed(1)}px`;
      hot.style.top = `${(g.t + g.h * b[1]).toFixed(1)}px`;
      hot.style.width = `${(g.w * (b[2] - b[0])).toFixed(1)}px`;
      hot.style.height = `${(g.h * (b[3] - b[1])).toFixed(1)}px`;
    };

    const onEnter = () => { if (!mq.matches) hero.classList.add('is-zoom'); };
    const onLeave = () => hero.classList.remove('is-zoom');
    hot.addEventListener('pointerenter', onEnter);
    hot.addEventListener('pointerleave', onLeave);
    place();
    window.addEventListener('resize', place, { passive: true });
    window.addEventListener('orientationchange', place);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);

    return () => {
      hot.removeEventListener('pointerenter', onEnter);
      hot.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('resize', place);
      window.removeEventListener('orientationchange', place);
    };
  }, [ready]);
}

/* ── Hero ── */
function Hero() {
  const t = useT();
  const nav = useNavigate();
  const { isAuthenticated } = useAuth();
  // Carry this visit's campaign marks onto /login (gclid/utm) so gtag's
  // url_passthrough can read them off the address (TRIP-407 PR5).
  const ctaTarget = isAuthenticated ? '/trips' : withVisitCampaign(APP_URL);
  return (
    <section className="hero" id="top" data-hdr="light">
      <div className="hero-bg" aria-hidden="true">
        <div className="hero-fill" />
        <div className="hero-layer hero-la" />
        <div className="hero-layer hero-lb" />
      </div>
      <div className="hero-scrim" aria-hidden="true" />
      <div className="hero-hot" aria-hidden="true" />
      <div className="container hero-grid">
        <div className="hero-copy">
          <h1>
            <span className="hero-line hero-anim">{t('landing.hero.h1a')}</span>
            <span className="hero-line hero-grad hero-anim">{t('landing.hero.h1b')}</span>
          </h1>
          {/* hero.sub carries a <br> line break — rendered as HTML like the prototype. */}
          <p className="hero-sub hero-anim" dangerouslySetInnerHTML={{ __html: t('landing.hero.sub') }} />
          <div className="hero-ctas hero-anim">
            <button className="btn btn--primary" onClick={() => { track('cta_clicked', { location: 'hero' }); nav(ctaTarget); }}>
              {t('landing.hero.cta1')}
            </button>
            <button className="btn btn--ghost" onClick={() => nav(ctaTarget)}>
              {t('landing.hero.cta2')}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Main LandingPage ── */
export default function LandingPage() {
  const { lang, setLang } = useI18n();
  const t = useT();

  // Zone lifecycle: light-only theme (restored on unmount), the shared /site.css
  // link (ref-counted), and per-route <title>/<meta> (TRIP-460 §7).
  useSiteTheme();
  const cssReady = useSiteCss();
  useDocumentMeta(t('landing.meta.title'), t('landing.meta.description'));
  useHeroFrame(cssReady);

  // Keep <html lang> in sync with the active language.
  useEffect(() => { document.documentElement.setAttribute('lang', lang); }, [lang]);

  // Don't render until the site CSS is loaded — prevents a flash of unstyled content.
  if (!cssReady) return null;

  return (
    <>
      <SiteHeader lang={lang} setLang={setLang} variant="full" themed />
      <main>
        <Hero />
      </main>
      <SiteFooter lang={lang} setLang={setLang} />
    </>
  );
}
