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
   the consent wording matches the real TRIP-502 behaviour (the SDK collects
   nothing before / without a grant; storage and account-linked usage start with
   «Accept all»), retention
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

// Версия и даты двигаются ВМЕСТЕ с содержательной правкой текста, а не с любой.
// В 1.2 текст описывал поведение TRIP-502: до ответа на баннер PostHog не
// собирает НИЧЕГО, а идентификаторы на устройстве и запись под номером аккаунта
// начинаются с «Принять всё».
// В 1.3 (TRIP-518) правка идёт в ДРУГУЮ сторону — состав данных РАСШИРЕН, и
// прежний текст ему прямо противоречил: он обещал запись «under your account
// number (never your name or email)», а персона аналитики теперь несёт email и
// имя. Расширение состава при неизменной цели: сама цель (понять, как
// используется продукт) и основание (легитимный интерес) те же, нового согласия
// правка не требует, но требует правды в тексте — плюс объявленного срока
// хранения аналитических записей, которого в документе не было вовсе, и обещания
// удалить их вместе с аккаунтом (его исполняет `deletePersonAndEvents`).
// Заодно снято ЖЁСТКОЕ «14 дней» в разделе Changes: это было наше собственное
// число, а не требование GDPR (закон требует сообщить заранее, срока не
// называет), и документ, который сам себя не выполняет, хуже честной
// формулировки. Уведомления по этой ревизии нет намеренно: затронутых
// пользователей ноль (решение Pavel 05.09.2026).
export const LEGAL_META = {
  updated: 'Last updated 5 September 2026',
  version: 'Version 1.3',
  effective: 'Effective 5 September 2026',
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
