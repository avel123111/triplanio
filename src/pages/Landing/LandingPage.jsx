import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { track, withVisitCampaign } from '@/lib/analytics';
import { useAuth } from '@/lib/AuthContext';
import { useT, useI18n } from '@/lib/i18n/I18nContext';
import {
  SiteHeader, SiteFooter, useSiteCss, useSiteTheme, useDocumentMeta,
} from '@/components/site/SiteChrome';
import LandingSprite from './LandingSprite';

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

/**
 * Scroll-reveal (§2). The prototype fades blocks up as they enter the viewport
 * by toggling a class; ported here as one IntersectionObserver over the pain
 * `.rv` blocks and the stage (`#painStage` drives the fallback window/route/pin
 * reveal used when the scrub is off, i.e. reduced-motion). Bidirectional like
 * the prototype: re-arms when a block leaves upward. Runs once the site CSS is
 * in (the nodes exist).
 */
function useReveal(ready) {
  useEffect(() => {
    if (!ready) return undefined;
    const targets = [...document.querySelectorAll('.pain .rv')];
    const stage = document.getElementById('painStage');
    if (stage) targets.push(stage);
    if (!targets.length) return undefined;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) en.target.classList.add('is-in');
        else if (en.boundingClientRect.top > 0) en.target.classList.remove('is-in');
      });
    }, { threshold: 0.16, rootMargin: '0px 0px -5% 0px' });
    targets.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [ready]);
}

/**
 * Pain sticky-scroll scrub (§2 §10). The pile of chat/screenshot scraps collapses
 * into the rising app window as the pinned composition is scrolled; the whole
 * choreography is CSS driven off `--p` (arrival progress 0→1) which this hook
 * writes on each frame, plus a `.filled` flag past the midpoint and a one-off
 * `fit()` that sizes the pin band to the viewport (measured, since the fit
 * depends on the fixed header height). ACTIVE ON ALL WIDTHS — only reduced-motion
 * turns it off (then the `.pain:not(.scrub)` fallback + the reveal above show a
 * static window). Ported from the prototype IIFE; every listener is cleaned up
 * and every CSS var it set is cleared on unmount.
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

    const upd = () => {
      if (!active) return;
      const r = pin.getBoundingClientRect();
      const top = parseFloat(getComputedStyle(inner).top) || 0;
      const total = pin.offsetHeight - inner.offsetHeight;
      let p = total > 0 ? (top - r.top) / total : 0;
      p = Math.max(0, Math.min(1, p));
      stage.style.setProperty('--p', p.toFixed(4));
      if (p >= 0.50) sec.classList.add('filled');
      else if (p < 0.36) sec.classList.remove('filled');
    };

    // One centring: the heading is pinned WITH the stage, so the "heading +
    // stage" composition is fixed and only the animation plays inside it. The
    // stage scales to the remaining band under the fixed header (--fit), its
    // layout height compensated (--needpx) so no white strip is left pinned.
    const fit = () => {
      if (!active || !inner) { stage.style.removeProperty('--fit'); stage.style.removeProperty('--needpx'); return; }
      stage.style.setProperty('--fit', '1');
      stage.style.setProperty('--needpx', '0px');
      const aw = stage.querySelector('.appwin');
      const need = aw ? (aw.offsetTop + aw.offsetHeight) : stage.scrollHeight;
      const head = inner.querySelector('.section-head');
      const headH = head ? head.offsetHeight + (parseFloat(getComputedStyle(head).marginBottom) || 0) : 0;
      const hdr = document.getElementById('siteHeader');
      const hdrH = hdr ? hdr.offsetHeight : 0;
      const band = window.innerHeight - hdrH;
      const gutter = Math.max(20, band * 0.05);
      const avail = Math.max(120, band - gutter * 2 - headH);
      const f = need > 0 ? Math.min(1, avail / need) : 1;
      stage.style.setProperty('--needpx', `${need}px`);
      stage.style.setProperty('--fit', f.toFixed(3));
      sec.style.setProperty('--pin-top', `${hdrH + Math.max(gutter, (band - headH - need * f) / 2)}px`);
      sec.style.setProperty('--pin-h', `${Math.round(headH + need * f + window.innerHeight * 0.85)}px`);
      const cards = [...stage.querySelectorAll('.scrapv3')].filter((c) => c.offsetHeight > 0);
      const pileBot = cards.length ? Math.max(...cards.map((c) => c.offsetTop + c.offsetHeight)) : 0;
      sec.style.setProperty('--rise', `${Math.max(0, (pileBot - (aw ? aw.offsetTop : 0)) * f + 34)}px`);
    };

    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { upd(); ticking = false; });
    };
    const mode = () => {
      const on = !reduce.matches;
      if (on === active) return;
      active = on;
      sec.classList.toggle('scrub', on);
      if (on) { fit(); upd(); } else {
        stage.style.removeProperty('--p');
        stage.style.removeProperty('--fit');
        sec.style.removeProperty('--pin-top');
      }
    };
    const onResize = () => { mode(); fit(); upd(); };
    const onMqChange = () => { mode(); fit(); };

    mode(); fit(); upd();
    window.addEventListener('load', fit);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    mq.addEventListener('change', onMqChange);
    reduce.addEventListener('change', onResize);

    return () => {
      window.removeEventListener('load', fit);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      mq.removeEventListener('change', onMqChange);
      reduce.removeEventListener('change', onResize);
      sec.classList.remove('scrub', 'filled');
      ['--p', '--fit', '--needpx'].forEach((v) => stage.style.removeProperty(v));
      ['--pin-top', '--pin-h', '--rise'].forEach((v) => sec.style.removeProperty(v));
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

/* ── Pain (§2 «Right now, a trip lives in five different apps») ──
   The chaos of scattered scraps (chats, screenshots, a boarding-pass photo, a
   notes scribble, a broken spreadsheet) collapses into ONE calm Triplanio app
   window as the pinned composition is scrolled — see usePainScrub.
   The data-driven `--i`/`--s`/`--p`/width inline styles cannot become classes
   (they are per-element stagger indices and mockup bar widths); each is marked
   inline-style-exempt. (The repo-wide inline floor still falls this PR, so no
   floor-exempt is needed — the Hero rewrite retired more inlines than §2 adds.) */
function Pain() {
  const t = useT();
  const html = (key) => ({ dangerouslySetInnerHTML: { __html: t(key) } });
  return (
    <section className="pain section--sheet section-pad" data-hdr="light" id="how">
      <div className="container">
        <div className="pain-pin"><div className="pain-pin-inner">
          <div className="section-head rv">
            <span className="eyebrow">{t('landing.pn.eyebrow')}</span>
            <h2>{t('landing.pn.h2')}</h2>
          </div>
          <div className="pain-stage" id="painStage">
            <div className="scrap-strip" aria-hidden="true">
              <div className="scrapv3 msg-row p1" style={{ '--i': 0 }}>{/* inline-style-exempt: stagger мокап §2 */}
                <svg className="mic mic--tg" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="12" fill="currentColor" opacity=".14" /><use href="#i-tg" /></svg>
                <div className="mbody">
                  <div className="mtop"><span>{t('landing.pn.tgName')}</span><time>14:32</time></div>
                  <div className="mprev">{t('landing.pn.tgMsg')}</div>
                </div>
                <span className="badge badge--tg">47</span>
              </div>
              <div className="scrapv3 msg-row p2" style={{ '--i': 1 }}>{/* inline-style-exempt: stagger мокап §2 */}
                <svg className="mic mic--wa" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" /></svg>
                <div className="mbody">
                  <div className="mtop"><span>{t('landing.pn.waName')}</span><time>11:07</time></div>
                  <div className="mprev"><span className="ftag">PDF</span><span>{t('landing.pn.waFile')}</span></div>
                </div>
                <span className="badge badge--wa">3</span>
              </div>
              <div className="scrapv3 bpass p3" style={{ '--i': 2 }}>{/* inline-style-exempt: stagger мокап §2 */}
                <div className="bp-head">
                  <div className="bp-route">VIE → BCN<span>09:40</span></div>{/* i18n-ignore — декоративный посадочный талон */}
                  <div className="bp-meta">SEAT 12A · GATE B7</div>{/* i18n-ignore — декоративный посадочный талон */}
                </div>
                <div className="bp-code" />
                <div className="bp-file">{t('landing.pn.bpFile')}</div>
              </div>
              <div className="scrapv3 snote p4" style={{ '--i': 3 }}>{/* inline-style-exempt: stagger мокап §2 */}
                <b>{t('landing.pn.note')}</b>
                <p {...html('landing.pn.noteBody')} />
              </div>
              <div className="scrapv3 ssheet p5" style={{ '--i': 4 }}>{/* inline-style-exempt: stagger мокап §2 */}
                <div className="sh-row hd"><div /><div>{t('landing.pn.sheetT')}</div><div /><div /></div>
                <div className="sh-row"><div className="idx">2</div><div>{t('landing.pn.shHotel')}</div><div>480 €</div><div className="err">???</div></div>
                <div className="sh-row"><div className="idx">3</div><div>{t('landing.pn.shTrain')}</div><div className="err">#REF!</div><div /></div>
              </div>
            </div>
            <div className="pain-divider rv">
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" d="M12 4v15m-6-6 6 6 6-6" /></svg>
              <span {...html('landing.pn.divider')} />
            </div>
            <div className="appwin device">
              <div className="aw-screen device-screen">
                <div className="aw-browserbar" aria-hidden="true"><span className="wdots"><i /><i /><i /></span><span className="aw-url"><svg width="12" height="12"><use href="#i-lock" /></svg>app.triplanio.com/trip/spain-7-days</span></div>
                <div className="aw-phonebar" aria-hidden="true"><i /></div>
                <div className="aw-head">
                  <svg className="logo" viewBox="0 0 342 341" aria-hidden="true"><use href="#tl-logo" /></svg>
                  <div><b>{t('landing.aw.title')}</b><small>{t('landing.aw.dates')}</small></div>
                  <div className="avs"><span>M</span><span>A</span><span>K</span></div>
                </div>
                <div className="aw-grid">
                  <div className="aw-col">
                    <div data-step style={{ '--s': 0 }}>{/* inline-style-exempt: stagger мокап §2 */}
                      <div className="aw-row"><span className="aw-label">{t('landing.aw.mapLbl')}</span><span className="aw-more">{t('landing.aw.open')}</span></div>
                      <div className="aw-map" aria-hidden="true">
                        <svg viewBox="0 0 608 190" preserveAspectRatio="xMidYMid slice">
                          <path className="aw-coast" d="M608 0 L608 190 L0 190 L0 150 C40 140 70 120 110 118 C150 116 175 132 210 128 C250 123 270 96 310 96 C350 96 372 120 410 110 C450 100 470 66 512 60 C548 55 572 30 590 16 C596 10 602 4 608 0 Z" />
                          <path d="M390.3 58.0 C377.8 70.3 344.3 125.7 315.5 132.0 C286.7 138.3 234.0 101.8 217.7 95.7" fill="none" strokeWidth="2.4" strokeDasharray="2 7" strokeLinecap="round" className="aw-route" />
                          <g className="aw-pin" style={{ '--p': 0 }}>{/* inline-style-exempt: stagger мокап §2 */}<circle cx="390" cy="58" r="11" strokeWidth="2.2" /><text className="npin-t" x="390" y="62">1</text></g>
                          <g className="aw-pin" style={{ '--p': 1 }}>{/* inline-style-exempt: stagger мокап §2 */}<circle cx="316" cy="132" r="11" strokeWidth="2.2" /><text className="npin-t" x="316" y="136">2</text></g>
                          <g className="aw-pin" style={{ '--p': 2 }}>{/* inline-style-exempt: stagger мокап §2 */}<circle cx="218" cy="96" r="11" strokeWidth="2.2" /><text className="npin-t" x="218" y="100">3</text></g>
                        </svg>
                      </div>
                    </div>
                    <div className="aw-stats" data-step style={{ '--s': 1 }}>{/* inline-style-exempt: stagger мокап §2 */}
                      <div className="aw-stat"><b>3</b><span>{t('landing.aw.st1')}</span></div>
                      <div className="aw-stat"><b>2</b><span>{t('landing.aw.st2')}</span></div>
                      <div className="aw-stat"><b>7</b><span>{t('landing.aw.st3')}</span></div>
                      <div className="aw-stat"><b>{t('landing.aw.kmN')}</b><span>{t('landing.aw.km')}</span></div>
                    </div>
                  </div>
                  <div className="aw-col">
                    <div data-step style={{ '--s': 2 }}>{/* inline-style-exempt: stagger мокап §2 */}
                      <div className="aw-row"><span className="aw-label">{t('landing.aw.budLbl')}</span><span className="aw-total">{t('landing.aw.total')}</span></div>
                      <div className="aw-bbar"><span style={{ width: '41%' }} />{/* inline-style-exempt: ширина мокапа §2 */}<span style={{ width: '24%' }} />{/* inline-style-exempt: ширина мокапа §2 */}<span style={{ width: '21%' }} />{/* inline-style-exempt: ширина мокапа §2 */}<span style={{ width: '14%' }} />{/* inline-style-exempt: ширина мокапа §2 */}</div>
                      <div className="aw-brows">
                        <div className="aw-brow"><i /><span>{t('landing.aw.b1')}</span><em>€480</em></div>
                        <div className="aw-brow"><i /><span>{t('landing.aw.b2')}</span><em>€322</em></div>
                        <div className="aw-brow"><i /><span>{t('landing.aw.b3')}</span><em>€284</em></div>
                      </div>
                    </div>
                    <div className="aw-ready">
                      <div className="aw-row" data-step style={{ '--s': 3 }}>{/* inline-style-exempt: stagger мокап §2 */}
                        <span className="aw-label">{t('landing.aw.readyLbl')}</span>
                        <span className="aw-ready-n"><b>2</b>/5</span>
                      </div>
                      <div className="stat-rows">
                        <div className="stat-row" data-step style={{ '--s': 3.6 }}>{/* inline-style-exempt: stagger мокап §2 */}<svg className="ok-ic" width="15" height="15"><use href="#i-check" /></svg><s>{t('landing.aw.rd1')}</s><span className="pill done">{t('landing.pill.done')}</span></div>
                        <div className="stat-row" data-step style={{ '--s': 4.2 }}>{/* inline-style-exempt: stagger мокап §2 */}<svg className="ok-ic" width="15" height="15"><use href="#i-check" /></svg><s {...html('landing.aw.rd2')} /><span className="pill done">{t('landing.pill.done')}</span></div>
                        <div className="stat-row" data-step style={{ '--s': 4.8 }}>{/* inline-style-exempt: stagger мокап §2 */}<svg className="todo-ic" width="15" height="15"><use href="#i-bed" /></svg><span>{t('landing.aw.rd3')}</span><span className="pill todo" {...html('landing.pill.todo')} /></div>
                        <div className="stat-row" data-step style={{ '--s': 5.4 }}>{/* inline-style-exempt: stagger мокап §2 */}<svg className="todo-ic" width="15" height="15"><use href="#i-train" /></svg><span {...html('landing.aw.rd4')} /><span className="pill todo" {...html('landing.pill.todo')} /></div>
                        <div className="stat-row" data-step style={{ '--s': 6 }}>{/* inline-style-exempt: stagger мокап §2 */}<svg className="todo-ic" width="15" height="15"><use href="#i-bed" /></svg><span>{t('landing.aw.rd5')}</span><span className="pill todo" {...html('landing.pill.todo')} /></div>
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
  useReveal(cssReady);
  usePainScrub(cssReady);

  // Keep <html lang> in sync with the active language.
  useEffect(() => { document.documentElement.setAttribute('lang', lang); }, [lang]);

  // Don't render until the site CSS is loaded — prevents a flash of unstyled content.
  if (!cssReady) return null;

  return (
    <>
      <SiteHeader lang={lang} setLang={setLang} variant="full" themed />
      <LandingSprite />
      <main>
        <Hero />
        <Pain />
      </main>
      <SiteFooter lang={lang} setLang={setLang} />
    </>
  );
}
