import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { track, withVisitCampaign } from '@/lib/analytics';
import { useAuth } from '@/lib/AuthContext';
import { useT, useI18n } from '@/lib/i18n/I18nContext';
import {
  SiteHeader, SiteFooter, useSiteCss, useSiteTheme, useDocumentMeta,
} from '@/components/site/SiteChrome';

/* =========================================================
   Landing page — the v5.7 prototype's markup, PORTED 1:1 (TRIP-460, "CSS and
   markup as-is, not a paraphrase"). Same DOM, same classes, same section
   order as the prototype; React/t()/analytics are the only layer added on
   top. Section CSS is the prototype's own body in public/site.css.
========================================================= */

const APP_URL = '/login';

/**
 * Hero three-layer photo composite (TRIP-460 §10, ported from the prototype's
 * own IIFE). The DESKTOP hero is a single flat-lay photo fitted BY HEIGHT so
 * the phone in it holds a fixed share of the viewport height on any monitor;
 * hovering the phone cross-fades to the "screen on" frame. That geometry is
 * measured off the fixed desktop frames (desk-flatlay / desk-app, 3400×1914)
 * and lives in the `FRAME` data object — those images do not change. The
 * MOBILE frame (the one Pavel swaps later) is a plain CSS `cover` layer with
 * NO JS geometry, so replacing /site/hero-mobile.webp never touches FRAME.
 */
function useHeroFrame(ready) {
  useEffect(() => {
    if (!ready) return undefined;
    const hero = document.querySelector('.hero');
    if (!hero) return undefined;
    const bg = hero.querySelector('.hero-bg');
    const la = hero.querySelector('.hero-layer.la');
    const lb = hero.querySelector('.hero-layer.lb');
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
  const ctaTarget = isAuthenticated ? '/trips' : withVisitCampaign(APP_URL);
  return (
    <section className="hero" data-hdr="light" id="top">
      <div className="hero-bg" aria-hidden="true">
        <div className="hero-fill" />
        <div className="hero-layer la" />
        <div className="hero-layer lb" />
      </div>
      <div className="hero-scrim" aria-hidden="true" />
      <div className="hero-hot" aria-hidden="true" />
      <div className="wrap hero-grid">
        <div className="hero-copy">
          <h1>
            <span className="line hero-anim">{t('landing.hero.h1a')}</span>
            <span className="line grad hero-anim">{t('landing.hero.h1b')}</span>
          </h1>
          <p className="hero-sub hero-anim" dangerouslySetInnerHTML={{ __html: t('landing.hero.sub') }} />
          <div className="hero-ctas hero-anim">
            <a className="btn btn-primary" href={ctaTarget} onClick={(e) => { e.preventDefault(); track('cta_clicked', { location: 'hero' }); nav(ctaTarget); }}>
              <span>{t('landing.hero.cta1')}</span>
            </a>
            <a className="btn btn-ghost" href={ctaTarget} onClick={(e) => { e.preventDefault(); nav(ctaTarget); }}>
              {t('landing.hero.cta2')}
            </a>
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

  useSiteTheme();
  const cssReady = useSiteCss();
  useDocumentMeta(t('landing.meta.title'), t('landing.meta.description'));
  useHeroFrame(cssReady);

  useEffect(() => { document.documentElement.setAttribute('lang', lang); }, [lang]);

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
