/* =============================================================================
   Legal page content — Terms of Service + Privacy Policy (TRIP-465, Ф6.6).

   English only, verbatim from the unauthenticated-zone prototype v5.7 (#doc,
   data-doc-lang="en"). NOT internationalised (Pavel decision, handoff §7): the
   document is a legal instrument, its wording is edited as a whole, not through
   t()/Tolgee. The prose lives in real markup — `./legal/*.en.html`, imported as
   raw strings and injected into `.doc-body` (trusted, authored in-repo). Keeping
   it in .html rather than JS string literals is why the i18n hardcode guard does
   not (and should not) touch it: it is markup, not UI code. The section ids
   double as the TOC anchors, so the TOC is derived from the prose — one source.

   The prose is the reviewed v1.0 (TRIP-133 audit): operator = sole trader in
   Spain (details on request), contacts info@/support@ only, Spanish law, 16+,
   the consent wording matches the real TRIP-407 variant-B behaviour, retention
   figures are verified facts (Supabase Pro backups 7d, Sentry 90d, Spanish
   accounting 6y). Every factual claim is traced to code in the PR description —
   keep the text in sync with behaviour when either changes.
   ============================================================================= */
import termsHtml from './legal/terms.en.html?raw';
import privacyHtml from './legal/privacy.en.html?raw';

// TOC from the prose itself: every `<section id><h2>` is one entry. One source
// of truth — the .html — so the sidebar can never drift from the document.
// `[\s\S]*?` (not `\s*`): find each section's <h2> even if a note/badge sits
// between the <section id> and its heading — a future edit to the prose can't
// silently drop an entry from the TOC. matchAll advances past each <h2>, so the
// lazy scan pairs every section with its OWN first heading.
function tocOf(html) {
  return [...html.matchAll(/<section id="([^"]+)">[\s\S]*?<h2>([\s\S]*?)<\/h2>/g)]
    .map((m) => ({ id: m[1], title: m[2].replace(/<[^>]+>/g, '').trim() }));
}

export const LEGAL_META = {
  updated: 'Last updated 31 August 2026',
  version: 'Version 1.1',
  effective: 'Effective 26 August 2026',
};

// Chrome labels of the viewer. English like the rest of the legal surface (not
// i18n — same decision as the prose above); centralised here so all the copy
// for these pages lives in one file, and the component reads data, not literals.
export const LEGAL_UI = {
  eyebrow: 'Legal',
  print: 'Print',
  contents: 'Contents',
  tablistLabel: 'Legal documents',
};

export const LEGAL_FOOT = 'This page always shows the current version of the document. Questions: <a href="mailto:info@triplanio.com">info@triplanio.com</a>.';

export const LEGAL = {
  terms: {
    title: 'Terms of Service',
    tab: 'Terms of Service',
    lede: 'The agreement between you and Triplanio: what the Service does, what you can expect from us, and what we expect from you.',
    toc: tocOf(termsHtml),
    html: termsHtml,
  },
  privacy: {
    title: 'Privacy Policy',
    tab: 'Privacy Policy',
    lede: 'What personal data the Service collects, why, who else can see it, and how to take it back.',
    toc: tocOf(privacyHtml),
    html: privacyHtml,
  },
};
