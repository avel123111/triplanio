import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { withVisitCampaign } from '@/lib/analytics';
import { useI18n } from '@/lib/i18n/I18nContext';
import {
  SiteHeader, SiteFooter, useSiteCss, useSiteTheme, useDocumentMeta,
} from '@/components/site/SiteChrome';
import { LEGAL, LEGAL_META, LEGAL_FOOT, LEGAL_UI } from './legalContent';

/* =============================================================================
   Legal — Terms of Service / Privacy Policy (TRIP-465, Ф6.6).

   One document viewer, ported from the zone prototype's `#doc`: head (title ·
   lede · meta · Print) → Terms⇄Privacy tabs → sticky TOC + body. The two routes
   `/terms` and `/privacy` render this same viewer with the matching tab active;
   switching a tab is a real router navigation to the sibling route (keeps the
   URL honest and the campaign snapshot alive — no full reload). Content is
   English-only static prose from `legalContent.js` (handoff §7 — not i18n); the
   body HTML is trusted, authored in-repo, and injected into `.doc-body`.
   Replaces the old static `public/terms.html` / `public/privacy.html`.

   floor-exempt: dsshare +29 — юр-документ это сплошная проза (out-of-scope
   витрина, как LandingPage/PublicTrip/Demo): его разметка сырая по природе, а
   впрыснутое тело (dangerouslySetInnerHTML) вообще не JSX — доля из ДС падает.
   Метрика целит в экраны приложения, не в витрины. Апрув Pavel: перенос
   /terms + /privacy по прототипу (TRIP-465).
   ============================================================================= */

// The chrome's brand/CTA point at OUR origin with the visit's campaign mark,
// same as the landing/demo/public-trip.
const SITE = withVisitCampaign(`${window.location.origin}/`);
const DOCS = ['terms', 'privacy'];

export default function Legal({ doc = 'terms' }) {
  const { lang, setLang } = useI18n();
  const cssReady = useSiteCss();
  useSiteTheme(); // marketing zone follows the landing: light-only, restored on exit

  const active = LEGAL[doc] ? doc : 'terms';
  const d = LEGAL[active];
  useDocumentMeta(`${d.title} — Triplanio`, d.lede);

  const nav = useNavigate();

  // Scroll-spy: mark the TOC entry of the section currently under the header
  // (prototype's sticky-TOC highlight). Re-arms when the CSS goes live (sections
  // mount) and when the active document changes.
  const [activeId, setActiveId] = useState(d.toc[0]?.id);
  useEffect(() => {
    setActiveId(d.toc[0]?.id);
    if (!cssReady) return undefined;
    const sections = d.toc.map((s) => document.getElementById(s.id)).filter(Boolean);
    if (!sections.length) return undefined;
    const io = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActiveId(visible[0].target.id);
    }, { rootMargin: '-96px 0px -70% 0px', threshold: 0 });
    sections.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [cssReady, active, d.toc]);

  if (!cssReady) return null;

  return (
    <>
      <SiteHeader lang={lang} setLang={setLang} variant="minimal" brandHref={SITE} />

      <main>
        <section className="doc" id="doc" data-hdr="light">
          <div className="wrap">
            <div className="doc-head">
              <span className="eyebrow">{LEGAL_UI.eyebrow}</span>
              <h1 className="doc-title">{d.title}</h1>
              <p className="doc-lede">{d.lede}</p>
              <div className="doc-meta">
                <span>{LEGAL_META.updated}</span>
                <span>{LEGAL_META.version}</span>
                <span>{LEGAL_META.effective}</span>
                <button type="button" className="doc-print" onClick={() => window.print()}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-print" /></svg>
                  <span>{LEGAL_UI.print}</span>
                </button>
              </div>
              <div className="doc-tabs" role="tablist" aria-label={LEGAL_UI.tablistLabel}>
                {DOCS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={active === k}
                    onClick={() => { if (k !== active) nav(`/${k}`); }}
                  >
                    {LEGAL[k].tab}
                  </button>
                ))}
              </div>
            </div>

            <div className="doc-grid">
              <details className="doc-toc" open>
                <summary>
                  <span>{LEGAL_UI.contents}</span>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-chev" /></svg>
                </summary>
                <nav className="doc-toc-list" aria-label={LEGAL_UI.contents}>
                  {d.toc.map((s, i) => (
                    <a key={s.id} href={`#${s.id}`} className={s.id === activeId ? 'doc-on' : undefined}>
                      <span className="doc-n">{i + 1}</span>{s.title}
                    </a>
                  ))}
                </nav>
              </details>

              {/* Trusted static legal prose (legalContent.js) — English, not i18n. */}
              <article className="doc-body" dangerouslySetInnerHTML={{ __html: d.html }} />
            </div>

            <p className="doc-foot" dangerouslySetInnerHTML={{ __html: LEGAL_FOOT }} />
          </div>
        </section>
      </main>

      <SiteFooter lang={lang} setLang={setLang} brandHref={SITE} />
    </>
  );
}
