// ═══════════════════════════════════════════════════════════════════════════
// ПОРЯДОК CSS-КАСКАДА ЗАДАЁТСЯ ЗДЕСЬ, ПОРЯДКОМ ЭТИХ СТРОК (TRIP-339, Р9).
//
// Сборщик пишет CSS в порядке обхода графа модулей, поэтому раньше порядок был
// ПОБОЧНЫМ ЭФФЕКТОМ, а не решением: `app.css` оказывался первым только потому,
// что его импортировали ещё и семь экранов, а экраны подключались раньше (через
// `App.jsx`), чем собственные строки этого файла. Стоило удалить те семь
// импортов — а фазы 04–09 эпика TRIP-337 удаляют их как побочный эффект
// схлопывания экранов — и `app.css` уезжал в КОНЕЦ, получая последнее слово над
// всеми файлами экранов разом. Молча: в дифф это не попадает, ни один гард
// такого не ловит.
//
// Теперь порядок держат ровно эти три строки, и он совпадает с прежним
// побайтово по составу:
//   1. `app.css`   — база дизайн-системы, ПЕРВОЙ;
//   2. `App.jsx`   — экраны; их CSS импортируют сами экраны и он ложится сюда;
//   3. `index.css` — reset (Tailwind Preflight) + шрифтовые токены, ПОСЛЕДНИМ.
// «Последним» — из трёх СВОИХ таблиц стилей: вендорный `mapbox-gl.css` идёт
// после и на каскад системы не влияет (он весь под `.mapboxgl-*`).
//
// ⚠️ Шаг 3 последним — это ЗАФИКСИРОВАННЫЙ ДЕФЕКТ, а не замысел: сброс обязан
// стоять перед системой, а не после неё. Из-за текущего порядка `index.css`
// перебивает `app.css` в объявлениях; двойной движок заголовков (голые h1..h4)
// снят в TRIP-410, но `app.css` `a{color:var(--brand)}` всё ещё мёртв. Чинится ОТДЕЛЬНЫМ
// визуальным PR с отдельным апрувом: смена вида глобальной типографики — это
// «изменение общего» (TRIP-337 закон 6), и ему не место в PR, ценность
// которого именно в том, что он доказуемо ничего не меняет.
//
// Проверка при правках: `npx vite build`, затем найти в собранном CSS смещения
// уникальных селекторов каждого исходника — состав порядка обязан совпасть с
// перечисленным выше.
// ═══════════════════════════════════════════════════════════════════════════
import '@/design/app.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { initSentry } from '@/lib/sentry'
import { applyConsent, clearAnalyticsStorage, getConsent, isProdHost } from '@/lib/consent'
import { startKeyboardOpenWatch } from '@/lib/keyboardOpen'
import App from '@/App.jsx'
import '@/index.css'
import 'mapbox-gl/dist/mapbox-gl.css'

// PostHog product analytics (TRIP-213 Phase 0), under consent since TRIP-311.
// Started by applyConsent() and ONLY for someone who said yes; the config and the
// reasoning live in consent.js. Until it runs, every posthog call in the codebase
// is a no-op and nothing reaches the device or the network.
//
// No usable answer covers "never asked", "expired", "our version moved" and
// "hand-edited" alike: wipe whatever PostHog left on the device and let
// ConsentBanner ask again.
const consent = getConsent()
if (consent) applyConsent(consent)
else clearAnalyticsStorage()

// Must run before the first render so early errors are captured.
initSentry()

// Typography canon inspector (TRIP-165) — a dev/staging-only browser tool.
// It must run on the DEPLOYED dev site (dev.triplanio.com), which Vercel builds
// with `vite build` (production mode) — so `import.meta.env.DEV` is FALSE there
// and can't be the gate. Instead we gate by HOST: active everywhere EXCEPT the
// production domain (mirrors the CORS allow-list split prod = triplanio.com/www).
// The dynamic import stays lazy, so on production the chunk is never fetched.
if (!isProdHost) {
  import('../dev/canon-inspector/index.js')
    .then((m) => m.initCanonInspector())
    .catch(() => { /* dev tool is best-effort; never break the app */ })
}

// Flag `kb-open` on <html> while the soft keyboard is up (mobile) so CSS can
// hide the bottom nav / sheet footer above it. Geometry-based, not focus-based.
startKeyboardOpenWatch()

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
