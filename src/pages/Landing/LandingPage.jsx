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

/**
 * Scroll-reveal (§11), ported verbatim from the prototype's own IIFE. Fades
 * blocks up as they enter the viewport by toggling `in` on `.rv`/`.rv-l`/
 * `.rv-r` — the CSS is the prototype's own (`.rv.in{opacity:1}` etc, "CSS as
 * is" §1), so the class name matches its selectors exactly, not a repo
 * convention. One IntersectionObserver, bidirectional (re-arms leaving
 * upward). Runs once the site CSS is in (the nodes exist).
 */
function useReveal(ready) {
  useEffect(() => {
    if (!ready) return undefined;
    const targets = [...document.querySelectorAll('.rv,.rv-l,.rv-r')];
    if (!targets.length) return undefined;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) en.target.classList.add('in');
        else if (en.boundingClientRect.top > 0) en.target.classList.remove('in');
      });
    }, { threshold: 0.16, rootMargin: '0px 0px -5% 0px' });
    targets.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [ready]);
}

/**
 * Pain sticky-scroll scrub (§10 — REVERSED from the earlier draft: the pin
 * is now DESKTOP-ONLY, ≥760px. Below that the mobile pile is a static stack —
 * a pinned scrub has no room on a phone). The chat/screenshot pile collapses
 * into the rising app window as the pinned composition scrolls, driven by a
 * `--p` (arrival progress 0→1) CSS var this hook writes on each frame, plus a
 * `.filled` flag past the midpoint. `fit()` sizes the pin band to the
 * viewport once on mount/resize. Ported from the prototype's IIFE; every
 * listener is cleaned up.
 */
function usePainScrub(ready) {
  useEffect(() => {
    if (!ready) return undefined;
    const pin = document.querySelector('.pain-pin');
    const stage = document.getElementById('painStage');
    const sec = document.querySelector('.pain');
    if (!pin || !stage || !sec) return undefined;
    const inner = pin.querySelector('.pain-pin-inner');
    const mq = window.matchMedia('(min-width:760px)');
    const reduce = window.matchMedia('(prefers-reduced-motion:reduce)');
    let active = false;
    let ticking = false;
    let pinH = 0;

    const upd = () => {
      if (!active) return;
      const r = pin.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, -r.top / Math.max(1, pinH - window.innerHeight)));
      stage.style.setProperty('--p', p.toFixed(4));
      sec.classList.toggle('filled', p > 0.5);
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { upd(); ticking = false; });
    };
    const fit = () => {
      // The pin band is tall enough to give the scrub room to run; height is
      // a multiple of the viewport, capped so short viewports don't get an
      // absurdly long pin track.
      pinH = Math.round(window.innerHeight * 2.2);
      inner.style.height = `${pinH}px`;
    };
    const mode = () => {
      const on = mq.matches && !reduce.matches;
      if (on === active) return;
      active = on;
      sec.classList.toggle('scrub', on);
      if (on) { fit(); upd(); } else {
        stage.style.removeProperty('--p');
        sec.classList.remove('filled');
        inner.style.removeProperty('height');
      }
    };
    const onResize = () => { mode(); if (active) fit(); };
    mode();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });
    mq.addEventListener('change', mode);
    reduce.addEventListener('change', mode);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      mq.removeEventListener('change', mode);
      reduce.removeEventListener('change', mode);
      sec.classList.remove('scrub', 'filled');
      stage.style.removeProperty('--p');
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

/* ── Pain ("Right now, a trip lives in five different apps") ── */
function Pain() {
  const t = useT();
  return (
    <section className="pain sheet-pane section-pad" data-hdr="light" id="how">
      <div className="wrap">
        <div className="pain-pin"><div className="pain-pin-inner">
          <div className="section-head rv">
            <span className="brow">{t('landing.pn.eyebrow')}</span>
            <h2>{t('landing.pn.h2')}</h2>
          </div>
          <div className="pain-stage" id="painStage">
            <div className="scrap-strip" aria-hidden="true">
              <div className="scrapv3 msg-row p1" style={{ '--i': 0 }}>{/* inline-style-exempt: scrub-driven stagger index (TRIP-460) */}
                <svg className="mic" viewBox="0 0 24 24" style={{ color: '#2AABEE' }} fill="currentColor">{/* inline-style-exempt: brand icon tint (TRIP-460) */}
                  <circle cx="12" cy="12" r="12" fill="currentColor" opacity=".14" /><use href="#i-tg" />
                </svg>
                <div className="mbody">
                  <div className="mtop"><span>{t('landing.pn.tgName')}</span><time>14:32</time></div>
                  <div className="mprev">{t('landing.pn.tgMsg')}</div>
                </div>
                <span className="badge" style={{ background: '#2AABEE' }}>47</span>{/* inline-style-exempt: brand colour (TRIP-460) */}
              </div>
              <div className="scrapv3 msg-row p2" style={{ '--i': 1 }}>{/* inline-style-exempt: scrub stagger */}
                <svg className="mic" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" /></svg>
                <div className="mbody">
                  <div className="mtop"><span>{t('landing.pn.waName')}</span><time>11:07</time></div>
                  <div className="mprev"><span className="ftag">PDF</span><span>{t('landing.pn.waFile')}</span></div>
                </div>
                <span className="badge" style={{ background: '#25D366' }}>3</span>{/* inline-style-exempt: brand colour */}
              </div>
              <div className="scrapv3 bpass p3" style={{ '--i': 2 }}>{/* inline-style-exempt: scrub stagger */}
                <div className="bp-head">
                  <div className="bp-route">VIE → BCN<span>09:40</span></div>{/* i18n-ignore: decorative mock airport codes */}
                  <div className="bp-meta">SEAT 12A · GATE B7</div>{/* i18n-ignore: decorative mock boarding pass */}
                </div>
                <div className="bp-code" />
                <div className="bp-file">{t('landing.pn.bpFile')}</div>
              </div>
              <div className="scrapv3 snote p4" style={{ '--i': 3 }}>{/* inline-style-exempt: scrub stagger */}
                <b>{t('landing.pn.note')}</b>
                <p dangerouslySetInnerHTML={{ __html: t('landing.pn.noteBody') }} />
              </div>
              <div className="scrapv3 ssheet p5" style={{ '--i': 4 }}>{/* inline-style-exempt: scrub stagger */}
                <div className="sh-row hd"><div /><div>{t('landing.pn.sheetT')}</div><div /><div /></div>
                <div className="sh-row"><div className="idx">2</div><div>{t('landing.pn.shHotel')}</div><div>480 €</div><div className="err">???</div></div>
                <div className="sh-row"><div className="idx">3</div><div>{t('landing.pn.shTrain')}</div><div className="err">#REF!</div><div /></div>
              </div>
            </div>
            <div className="pain-divider rv">
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" d="M12 4v15m-6-6 6 6 6-6" /></svg>
              <span dangerouslySetInnerHTML={{ __html: t('landing.pn.divider') }} />
            </div>
            <div className="appwin device">
              <div className="aw-screen device-screen">
                <div className="aw-browserbar" aria-hidden="true"><span className="wdots"><i /><i /><i /></span><span className="aw-url"><svg width="12" height="12"><use href="#i-lock" /></svg>app.triplanio.com/trip/spain-7-days</span></div>
                <div className="aw-phonebar" aria-hidden="true"><i /></div>
                <div className="aw-head">
                  <svg className="logo" viewBox="0 0 342 341" aria-hidden="true"><use href="#tl-logo" /></svg>
                  <div><b>{t('landing.aw.title')}</b><small>{t('landing.aw.dates')}</small></div>
                  <div className="avs">
                    <span style={{ background: '#2173C8' }}>M</span>{/* inline-style-exempt: mock avatar colour */}
                    <span style={{ background: '#FF9E4A' }}>A</span>{/* inline-style-exempt: mock avatar colour */}
                    <span style={{ background: '#2EC27E' }}>K</span>{/* inline-style-exempt: mock avatar colour */}
                  </div>
                </div>
                <div className="aw-grid">
                  <div className="aw-col">
                    <div data-step="" style={{ '--s': 0 }}>{/* inline-style-exempt: scrub step index */}
                      <div className="aw-row"><span className="aw-label">{t('landing.aw.mapLbl')}</span><span className="aw-more">{t('landing.aw.open')}</span></div>
                      <div className="aw-map" aria-hidden="true">
                        {/* §5: Mapbox static image removed — hand-drawn SVG coastline (no token, no api.mapbox.com). */}
                        <svg viewBox="0 0 608 190" preserveAspectRatio="xMidYMid slice">
                          <path className="aw-coast" d="M608 0 L608 190 L0 190 L0 150 C40 140 70 120 110 118 C150 116 175 132 210 128 C250 123 270 96 310 96 C350 96 372 120 410 110 C450 100 470 66 512 60 C548 55 572 30 590 16 C596 10 602 4 608 0 Z" />
                          <path d="M390.3 58.0 C377.8 70.3 344.3 125.7 315.5 132.0 C286.7 138.3 234.0 101.8 217.7 95.7" fill="none" stroke="#2173C8" strokeWidth="2.4" strokeDasharray="2 7" strokeLinecap="round" className="aw-route" />
                          <g className="aw-pin" style={{ '--p': 0 }}><circle cx="390" cy="58" r="11" fill="#fff" stroke="#2173C8" strokeWidth="2.2" /><text className="npin-t" x="390" y="62" fontSize="12">1</text></g>
                          <g className="aw-pin" style={{ '--p': 1 }}><circle cx="316" cy="132" r="11" fill="#fff" stroke="#2173C8" strokeWidth="2.2" /><text className="npin-t" x="316" y="136" fontSize="12">2</text></g>
                          <g className="aw-pin" style={{ '--p': 2 }}><circle cx="218" cy="96" r="11" fill="#fff" stroke="#2173C8" strokeWidth="2.2" /><text className="npin-t" x="218" y="100" fontSize="12">3</text></g>
                        </svg>
                      </div>
                    </div>
                    <div className="aw-stats" data-step="" style={{ '--s': 1 }}>{/* inline-style-exempt: scrub step index */}
                      <div className="aw-stat"><b>3</b><span>{t('landing.aw.st1')}</span></div>
                      <div className="aw-stat"><b>2</b><span>{t('landing.aw.st2')}</span></div>
                      <div className="aw-stat"><b>7</b><span>{t('landing.aw.st3')}</span></div>
                      <div className="aw-stat"><b>{t('landing.aw.kmN')}</b><span>{t('landing.aw.km')}</span></div>
                    </div>
                  </div>
                  <div className="aw-col">
                    <div data-step="" style={{ '--s': 2 }}>{/* inline-style-exempt: scrub step index */}
                      <div className="aw-row"><span className="aw-label">{t('landing.aw.budLbl')}</span><span className="aw-total">{t('landing.aw.total')}</span></div>
                      <div className="aw-bbar">
                        <span style={{ width: '41%', background: '#7B68E4' }} />{/* inline-style-exempt: data-driven budget split */}
                        <span style={{ width: '24%', background: '#2EC27E' }} />{/* inline-style-exempt: data-driven budget split */}
                        <span style={{ width: '21%', background: '#FF9E4A' }} />{/* inline-style-exempt: data-driven budget split */}
                        <span style={{ width: '14%', background: '#6FB4F4' }} />{/* inline-style-exempt: data-driven budget split */}
                      </div>
                      <div className="aw-brows">
                        <div className="aw-brow"><i style={{ background: '#7B68E4' }} /><span>{t('landing.aw.b1')}</span><em>€480</em></div>{/* inline-style-exempt: category colour */}
                        <div className="aw-brow"><i style={{ background: '#2EC27E' }} /><span>{t('landing.aw.b2')}</span><em>€322</em></div>{/* inline-style-exempt: category colour */}
                        <div className="aw-brow"><i style={{ background: '#FF9E4A' }} /><span>{t('landing.aw.b3')}</span><em>€284</em></div>{/* inline-style-exempt: category colour */}
                      </div>
                    </div>
                    <div className="aw-ready">
                      <div className="aw-row" data-step="" style={{ '--s': 3 }}>{/* inline-style-exempt: scrub step index */}
                        <span className="aw-label">{t('landing.aw.readyLbl')}</span>
                        <span className="aw-ready-n"><b>2</b>/5</span>
                      </div>
                      <div className="stat-rows">
                        <div className="stat-row" data-step="" style={{ '--s': 3.6 }}>{/* inline-style-exempt: scrub step index */}<svg className="ok-ic" width="15" height="15"><use href="#i-check" /></svg><s>{t('landing.aw.rd1')}</s><span className="pill done">{t('landing.pill.done')}</span></div>
                        <div className="stat-row" data-step="" style={{ '--s': 4.2 }}>{/* inline-style-exempt: scrub step index */}<svg className="ok-ic" width="15" height="15"><use href="#i-check" /></svg><s dangerouslySetInnerHTML={{ __html: t('landing.aw.rd2') }} /><span className="pill done">{t('landing.pill.done')}</span></div>
                        <div className="stat-row" data-step="" style={{ '--s': 4.8 }}>{/* inline-style-exempt: scrub step index */}<svg className="todo-ic" width="15" height="15"><use href="#i-bed" /></svg><span>{t('landing.aw.rd3')}</span><span className="pill todo" dangerouslySetInnerHTML={{ __html: t('landing.pill.todo') }} /></div>
                        <div className="stat-row" data-step="" style={{ '--s': 5.4 }}>{/* inline-style-exempt: scrub step index */}<svg className="todo-ic" width="15" height="15"><use href="#i-train" /></svg><span dangerouslySetInnerHTML={{ __html: t('landing.aw.rd4') }} /><span className="pill todo" dangerouslySetInnerHTML={{ __html: t('landing.pill.todo') }} /></div>
                        <div className="stat-row" data-step="" style={{ '--s': 6 }}>{/* inline-style-exempt: scrub step index */}<svg className="todo-ic" width="15" height="15"><use href="#i-bed" /></svg><span>{t('landing.aw.rd5')}</span><span className="pill todo" dangerouslySetInnerHTML={{ __html: t('landing.pill.todo') }} /></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div></div>
      </div>
    </section>
  );
}

/* ── Bento ("The whole trip, in one clear picture") ── */
function Bento() {
  const t = useT();
  return (
    <section className="bento-sec section-pad" data-hdr="light" id="product">
      <div className="wrap">
        <div className="section-head rv">
          <span className="brow">{t('landing.bento.eyebrow')}</span>
          <h2 dangerouslySetInnerHTML={{ __html: t('landing.bento.h2') }} />
          <p>{t('landing.bento.sub')}</p>
        </div>
        <div className="bento" data-stagger="">
          <article className="bcard b-map rv" style={{ '--i': 0 }}>{/* inline-style-exempt: stagger reveal index (TRIP-460) */}
            <div className="bic"><svg width="21" height="21"><use href="#i-map" /></svg></div>
            <h3>{t('landing.bento.mapT')}</h3>
            <p>{t('landing.bento.mapD')}</p>
            <div className="mapviz" aria-hidden="true">
              {/* §5: Mapbox static image removed — hand-drawn SVG coastline (no token, no api.mapbox.com). */}
              <svg viewBox="0 0 640 230" preserveAspectRatio="xMidYMid slice">
                <path className="aw-coast" d="M640 0 L640 230 L0 230 L0 180 C60 168 100 140 150 136 C210 130 250 158 310 150 C370 142 400 96 470 84 C520 76 560 40 600 20 C614 12 628 4 640 0 Z" />
                <path d="M160.5 140.2 C175.3 148.2 223.9 198.3 249.5 188.0 C275.1 177.7 275.5 102.5 313.8 78.2 C352.2 53.9 451.9 48.0 479.5 42.0" fill="none" stroke="#2173C8" strokeWidth="2.4" strokeDasharray="2 7" strokeLinecap="round" />
                <g><circle cx="160" cy="140" r="12" fill="#fff" stroke="#2173C8" strokeWidth="2.2" /><text className="npin-t" x="160" y="144" fontSize="12">1</text></g>
                <g><circle cx="250" cy="188" r="12" fill="#fff" stroke="#2173C8" strokeWidth="2.2" /><text className="npin-t" x="250" y="192" fontSize="12">2</text></g>
                <g><circle cx="314" cy="78" r="12" fill="#fff" stroke="#2173C8" strokeWidth="2.2" /><text className="npin-t" x="314" y="82" fontSize="12">3</text></g>
                <g><circle cx="480" cy="42" r="12" fill="#fff" stroke="#2173C8" strokeWidth="2.2" /><text className="npin-t" x="480" y="46" fontSize="12">4</text></g>
              </svg>
            </div>
          </article>

          <article className="bcard b-status rv" style={{ '--i': 1 }}>{/* inline-style-exempt: stagger reveal index */}
            <div className="bic mint"><svg width="21" height="21"><use href="#i-check" /></svg></div>
            <h3 dangerouslySetInnerHTML={{ __html: t('landing.bento.stT') }} />
            <p dangerouslySetInnerHTML={{ __html: t('landing.bento.stD') }} />
            <div className="stat-rows">
              <div className="stat-row"><svg className="ok-ic" width="15" height="15"><use href="#i-check" /></svg><s>{t('landing.bento.st1')}</s><span className="pill done">{t('landing.pill.done')}</span></div>
              <div className="stat-row"><svg className="ok-ic" width="15" height="15"><use href="#i-check" /></svg><s>{t('landing.bento.st2')}</s><span className="pill done">{t('landing.pill.done2')}</span></div>
              <div className="stat-row"><svg className="todo-ic" width="15" height="15"><use href="#i-plane" /></svg><span>{t('landing.bento.st3')}</span><span className="pill todo" dangerouslySetInnerHTML={{ __html: t('landing.pill.todo') }} /></div>
              <div className="stat-row"><svg className="todo-ic" width="15" height="15"><use href="#i-shield" /></svg><span>{t('landing.bento.st4')}</span><span className="pill todo" dangerouslySetInnerHTML={{ __html: t('landing.pill.todo2') }} /></div>
            </div>
          </article>

          <article className="bcard b-budget rv" style={{ '--i': 2 }}>{/* inline-style-exempt: stagger reveal index */}
            <div className="bic warm"><svg width="21" height="21"><use href="#i-wallet" /></svg></div>
            <h3>{t('landing.bento.budT')}</h3>
            <p>{t('landing.bento.budD')}</p>
            <div className="bud-sum">€2,140 <small>{t('landing.bento.budOf')}</small></div>
            <div className="bud-bars">
              <div className="bud-bar"><div className="lbl"><span>{t('landing.bud.flights')}</span><span>€860</span></div><div className="track"><div className="fill" style={{ '--w': '86%' }} /></div></div>{/* inline-style-exempt: data-driven bar fill */}
              <div className="bud-bar"><div className="lbl"><span>{t('landing.bud.stays')}</span><span>€720</span></div><div className="track"><div className="fill" style={{ '--w': '64%' }} /></div></div>{/* inline-style-exempt: data-driven bar fill */}
              <div className="bud-bar"><div className="lbl"><span dangerouslySetInnerHTML={{ __html: t('landing.bud.food') }} /><span>€390</span></div><div className="track"><div className="fill" style={{ '--w': '42%' }} /></div></div>{/* inline-style-exempt: data-driven bar fill */}
              <div className="bud-bar"><div className="lbl"><span>{t('landing.bud.transport')}</span><span>€170</span></div><div className="track"><div className="fill" style={{ '--w': '24%' }} /></div></div>{/* inline-style-exempt: data-driven bar fill */}
            </div>
          </article>

          <article className="bcard b-timeline rv" style={{ '--i': 3 }}>{/* inline-style-exempt: stagger reveal index */}
            <div className="bic"><svg width="21" height="21"><use href="#i-cal" /></svg></div>
            <h3>{t('landing.bento.tlT')}</h3>
            <p>{t('landing.bento.tlD')}</p>
            <div className="tl">
              <div className="tl-item"><span className="nd" /><div><b>09:40</b> <span>{t('landing.tl.1')}</span></div></div>
              <div className="tl-item"><span className="nd" style={{ borderColor: 'var(--sunset)' }} /><div><b>13:00</b> <span>{t('landing.tl.2')}</span></div></div>{/* inline-style-exempt: category colour */}
              <div className="tl-item"><span className="nd" style={{ borderColor: 'var(--mint)' }} /><div><b>16:30</b> <span dangerouslySetInnerHTML={{ __html: t('landing.tl.3') }} /></div></div>{/* inline-style-exempt: category colour */}
            </div>
          </article>

          <article className="bcard b-docs rv" style={{ '--i': 4 }}>{/* inline-style-exempt: stagger reveal index */}
            <div className="bic"><svg width="21" height="21"><use href="#i-doc" /></svg></div>
            <h3>{t('landing.bento.docT')}</h3>
            <p>{t('landing.bento.docD')}</p>
            <div className="doc-chips">
              <span className="doc-chip"><svg width="13" height="13"><use href="#i-plane" /></svg>e-tickets.pdf</span>
              <span className="doc-chip"><svg width="13" height="13"><use href="#i-shield" /></svg>insurance.pdf</span>
              <span className="doc-chip"><svg width="13" height="13"><use href="#i-doc" /></svg>visa-scan.jpg</span>
              <span className="doc-chip"><svg width="13" height="13"><use href="#i-pin" /></svg>hotel-voucher.pdf</span>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

/* ── Recognize ("The AI reads bookings so you don't have to") ── */
function Recognize() {
  const t = useT();
  return (
    <section className="recognize section-pad" data-hdr="light">
      <div className="wrap rec-grid">
        <div className="rec-demo rv-l">
          <div className="rec-flow">
            <div className="email-card"><span className="scan" aria-hidden="true" />
              <div className="eh"><span className="av">VY</span><div><b>Vueling</b><small>{t('landing.rec.mailMeta')}</small></div></div>
              <div className="subject">{t('landing.rec.mailSubj')}</div>
              <span dangerouslySetInnerHTML={{ __html: t('landing.rec.mailBody') }} />
            </div>
            <div className="ai-node" aria-hidden="true">
              <span className="beam up" />
              <span className="ai-chip"><svg width="15" height="15"><use href="#i-spark" /></svg><span>{t('landing.rec.chip')}</span><span className="th"><i /><i /><i /></span></span>
              <span className="beam" />
            </div>
            <div className="parsed-card">
              <div className="ph">
                <span className="pic"><svg width="18" height="18"><use href="#i-plane" /></svg></span>
                <div><b>{t('landing.rec.cardT')}</b><small>{t('landing.rec.cardS')}</small></div>
              </div>
              <div className="pfields">
                <div className="pfield"><small><i className="cdot" style={{ background: 'var(--sunset)' }} /><span>{t('landing.rec.f1')}</span></small><b>{t('landing.rec.f1v')}</b></div>{/* inline-style-exempt: category colour */}
                <div className="pfield"><small><i className="cdot" style={{ background: 'var(--brand)' }} />PNR</small><b>X9K2LM</b></div>{/* inline-style-exempt: category colour */}
                <div className="pfield"><small>{t('landing.rec.f3')}</small><b>{t('landing.rec.f3v')}</b></div>
                <div className="pfield"><small><i className="cdot" style={{ background: 'var(--mint)' }} /><span>{t('landing.rec.f4')}</span></small><b>€860</b></div>{/* inline-style-exempt: category colour */}
                <div className="pfield full"><small>{t('landing.rec.f5')}</small><b>{t('landing.rec.f5v')}</b></div>
              </div>
              <div className="pcheck"><svg width="16" height="16"><use href="#i-check" /></svg><span>{t('landing.rec.saved')}</span></div>
            </div>
          </div>
        </div>
        <div className="rv-r">
          <span className="brow">{t('landing.rec.eyebrow')}</span>
          <h2 style={{ margin: '14px 0 14px' }} dangerouslySetInnerHTML={{ __html: t('landing.rec.h2') }} />{/* inline-style-exempt: prototype's own one-off spacing (TRIP-460, CSS as-is) */}
          <p style={{ color: 'var(--muted)', fontSize: '1.03rem' }}>{t('landing.rec.sub')}</p>{/* inline-style-exempt: prototype's own one-off styling */}
          <ul className="rec-points">
            <li><span className="n">1</span><div><b>{t('landing.rec.p1t')}</b><p>{t('landing.rec.p1d')}</p></div></li>
            <li><span className="n">2</span><div><b>{t('landing.rec.p2t')}</b><p>{t('landing.rec.p2d')}</p></div></li>
            <li><span className="n">3</span><div><b>{t('landing.rec.p3t')}</b><p>{t('landing.rec.p3d')}</p></div></li>
          </ul>
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
  usePainScrub(cssReady);
  useReveal(cssReady);

  useEffect(() => { document.documentElement.setAttribute('lang', lang); }, [lang]);

  if (!cssReady) return null;

  return (
    <>
      <SiteHeader lang={lang} setLang={setLang} variant="full" themed />
      <main>
        <Hero />
        <Pain />
        <Bento />
        <Recognize />
      </main>
      <SiteFooter lang={lang} setLang={setLang} />
    </>
  );
}
