import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useZoneHome } from '@/components/site/zoneCta';
import { useZoneDesktop } from '@/components/site/zoneBreakpoint';
import {
  SiteHeader, SiteFooter, useSiteCss, useDocumentMeta, useZoneLang,
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

// Адрес главной с меткой кампании визита — общий на всю зону (`zoneCta.js`).
const DOCS = ['terms', 'privacy'];

export default function Legal({ doc = 'terms' }) {
  const { lang, setLang } = useZoneLang();
  const site = useZoneHome();
  const cssReady = useSiteCss();

  const active = LEGAL[doc] ? doc : 'terms';
  const d = LEGAL[active];
  useDocumentMeta(`${d.title} — Triplanio`, d.lede);

  // Scroll-spy: mark the TOC entry of the section currently under the header
  // (prototype's sticky-TOC highlight). Re-arms when the CSS goes live (sections
  // mount) and when the active document changes.
  const [activeId, setActiveId] = useState(d.toc[0]?.id);

  // ОГЛАВЛЕНИЕ: на десктопе — липкая колонка, ниже границы зоны — аккордеон,
  // закрытый по умолчанию. Так в макете, и это не косметика: раскрытым на
  // телефоне оно отдаёт читателю целый экран из полутора десятков ссылок
  // ВМЕСТО первого абзаца документа.
  //
  // ★ На десктопе `open` обязан быть true ВСЕГДА: там `site.css` прячет саму
  // кнопку (`.doc-toc > summary { display: none }` в десктопном @media),
  // потому что колонка развёрнута по построению. Закрыть его там — значит
  // спрятать оглавление без единого способа открыть.
  //
  // Само число границы здесь НЕ повторяется — оно живёт в `zoneBreakpoint.js`
  // вместе с разбором, почему у зоны она своя, а не приложенческие 640.
  const desktop = useZoneDesktop();
  const [tocOpen, setTocOpen] = useState(desktop);
  useEffect(() => { setTocOpen(desktop); }, [desktop]);
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
      <SiteHeader lang={lang} setLang={setLang} variant="minimal" brandHref={site} />

      <main>
        <section className="doc" id="doc" data-hdr="light">
          <div className="wrap">
            <div className="doc-head">
              <span className="brow">{LEGAL_UI.eyebrow}</span>
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
              {/* Real route navigation (/terms ⇄ /privacy), not an in-place tab
                  panel — so a <nav> of router links with aria-current, not the
                  WAI-ARIA tablist pattern (which would promise content swaps
                  under one panel). */}
              <nav className="doc-tabs" aria-label={LEGAL_UI.tablistLabel}>
                {DOCS.map((k) => (
                  <Link key={k} to={`/${k}`} aria-current={active === k ? 'page' : undefined}>
                    {LEGAL[k].tab}
                  </Link>
                ))}
              </nav>
            </div>

            <div className="doc-grid">
              <details
                className="doc-toc"
                open={tocOpen}
                onToggle={(e) => setTocOpen(e.currentTarget.open)}
              >
                <summary>
                  <span>{LEGAL_UI.contents}</span>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-chev" /></svg>
                </summary>
                {/* Схлопнуть после перехода к разделу — иначе человек приземляется
                    под той же стеной ссылок, из которой только что выбирал. По
                    клику именно на ПУНКТ, как в макете: промах мимо ссылки не
                    должен закрывать список. На десктопе схлопывать нечего —
                    там кнопки нет. */}
                <nav
                  className="doc-toc-list"
                  aria-label={LEGAL_UI.contents}
                  onClick={(e) => { if (!desktop && e.target.closest('a')) setTocOpen(false); }}
                >
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

      <SiteFooter lang={lang} setLang={setLang} brandHref={site} />
    </>
  );
}
