---
name: triplanio-ui-audit
description: Кросс-экранный UI/UX аудит (2026-06-05) + дорожная карта P0/P1/P2; статус правок
metadata: 
  node_type: memory
  type: project
  originSessionId: 74dd13ba-fbfb-42ca-90c8-bfe351a6f77a
---

Полный кросс-экранный аудит UI выполнен 2026-06-05 (5 параллельных субагентов: TripView+ленты, планнеры, Pro/Trips/Login/Inbox, вторичные ленты, дизайн-система). Отчёт-документ: **UI_AUDIT_2026-06-05.md** в корне репо triplanio_new.

**Два системных корня «перегруженности»:** (1) дробная типошкала — 27 разных инлайн-`fontSize` (521 литерал), `--fs-*` используется в ~1 файле; (2) два несведённых дизайн-движка — бэспоук app.css (284 `<Btn>`) vs остатки shadcn/Tailwind (PublicTrip, ProBadge, TripLimitDialog, components/views/* легаси, components/ui/*). Плюс 51 JS-ховер вместо CSS, дубли хелперов (fmt ×7, fmtDate ×4), i18n-протечки в index.jsx/dock.jsx.

**Эталон в репо:** CalendarLens (CSS-driven, токены, ARIA) — модель для остальных лент.

**P0 СДЕЛАНО (2026-06-05, dev, build зелёный):**
- TimelineRail: фантомный `--muted-foreground` → `color-mix(--muted-2)`.
- TripView чип путешественников: `#1f8a5b22/33` → `--success-soft` + color-mix.
- `#dbe1ec` ховер-бордеры → новый токен `--line-hover` (light #dbe1ec / dark #2f3a4e); заменено в index.jsx, Trips, DocsLens, ManualPlanner, ForkPartnerModal (redesign/* мокапы НЕ трогали).
- Route color `#5b6cff` → brand `#2167e2` в MapView + FlowMap ROUTE_COLOR + ManualPlanner accent (mapbox-paint нужен hex, не var; theme-adaptive route = P1). Заодно AI-маршрут `var(--ai)`→`#6a3ee2` (var в mapbox не резолвился — латентный баг).
- BudgetLens: убран всегда-100% прогресс-бар (числитель=знаменатель, вводил в заблуждение).

**P0-6 ОТКРЫТО (продуктовое решение Pavel):** MembersLens invite-link tab показывает захардкоженную фейк-ссылку `triplanio.com/join/4f6b-…`, copy ничего не копирует. Варианты: скрыть таб / сделать реальный invite-token бэкенд / disabled-состояние. Жду решения.

**P1 — типошкала СДЕЛАНО (2026-06-05, dev, build зелёный):** codemod (/tmp/fs_codemod.py логика) свернул 522 инлайн-`fontSize` в 41 файле к 4 токенам: 15.5/15/14.5/14→`--fs-strong`, 13.5/13→`--fs-base`, 12.5/12→`--fs-meta`, 11.5/11/10.5/10/9→`--fs-micro`. Дисплейные ≥16px НЕ трогали (нужен `--fs-display` для заголовков/статов — предусловие eslint-гейта). Мокапы `redesign/` исключены. eslint-гейт (бан числового fontSize) ОТЛОЖЕН до завода display-токенов, иначе ломает CI.
**P1 — сведение движков (в работе):** ВАЖНО — аудит упростил: shadcn здесь НЕСУЩИЙ (alert-dialog/dialog/select/popover/command=CitySearch автокомплит/dropdown), в app.css/index.jsx таких интерактивных примитивов НЕТ. Транзитивный анализ: из 51 ui-примитива **16 живых** (button,badge,input,textarea,checkbox,label,select,dialog,alert-dialog,popover,dropdown-menu,toast,toaster,use-toast,AiField,CurrencyCombobox), **35 мёртвых** (accordion,alert,aspect-ratio,avatar,breadcrumb,calendar,card,carousel,chart,collapsible,command,context-menu,drawer,form,hover-card,input-otp,menubar,navigation-menu,pagination,progress,radio-group,resizable,scroll-area,separator,sheet,sidebar,skeleton,slider,sonner,switch,table,tabs,toggle,toggle-group,tooltip). ⚠️ Удалять файлы из cowork-окружения НЕЛЬЗЯ (маунт запрещает unlink) → Pavel делает `git rm` сам. shadcn-HSL-токены ОПРЕДЕЛЕНЫ в src/index.css (компоненты не сломаны).
СДЕЛАНО: ProBadge переведён на каноничный warm-бейдж (`--warm-tint`/`--warm`+Icon pro, без lucide/orange), API {className,size} сохранён, build зелёный.
ОСТАЛОСЬ в сведении: визуально-чужие экраны на app-токены (PublicTrip, TripLimitDialog), сверка токенов несущих shadcn-примитивов с app.css.
**P1 — JS-ховеры→CSS (в работе):** ⚠️ подвох: инлайн base-стиль (`style={{border}}`) по специфичности бьёт CSS `:hover` → надо выносить И базу, И hover в класс (не просто добавить :hover). СДЕЛАНО: design/index.jsx полностью (6 мест, 0 осталось) — общие карточки таймлайна (transfer ×3, event-row ×2, dismiss-×) на классы `.dz-lift`/`.dz-lift--transfer`/`.dz-xbtn` в app.css (+reduced-motion, +theme-aware hover bg вместо rgba(0,0,0,.05)). Это самый ценный кластер (shared, рендерится везде). ОСТАЛОСЬ (page-level one-off'ы, ниже приоритет, лучше с визуальным прогоном): Trips, DocsLens, ManualPlanner, MembersLens, TripView, TripSidebar, ChatWidget, ChatLens, AddressAutocomplete. Карты shadcn `card.jsx` нет — `.dz-lift` это и есть канон карточки. Флаг: `title="Скрmagn"` в index.jsx Banner — хардкод RU (в i18n-пасс).
Раунд 2 ховеров (этот заход): добавил классы `.dz-rowhover`/`.dz-bord`/`.dz-lift-card`; конвертил безусловные: TripView меню ×4 (+убрал bg из itemStyle), ChatLens/ChatWidget mention-кнопки, Trips card(`dz-lift-card`)+row(`dz-bord`), DocsLens карта(`dz-lift`), ManualPlanner country-row. ОСТАВЛЕНЫ на JS (условные/мульти-prop, нельзя в чистый CSS): TripView 331/343/1440, Trips 165/462, DocsLens 183(!uploading)/366, ManualPlanner 330/467/615, MembersLens 226(danger). Итого ~16 из ~30 боевых ховеров на CSS.
**P1 — дедуп (СДЕЛАНО частично):** `hashStr`/`hashString` (index.jsx+UserAvatar, математически идентичны h*31+c) → единый `src/lib/hash.js`. ⚠️ ВАЖНО про остальной дедуп: «fmt ×7» из аудита = в основном МОКАПЫ redesign/; в боевом коде `fmt`(index) / `fmtMoney`(lib/budget) / `fmtPrice`(EventViewBody) / два разных `fmtDate` — это РАЗНЫЕ функции с разным выводом (десятичные/локаль). Слепо сливать НЕЛЬЗЯ — это продуктовое решение «должны ли все деньги/даты форматироваться единообразно». Жду решения Pavel прежде чем трогать форматтеры.
**P1 — форматтеры УНИФИЦИРОВАНЫ (2026-06-05, Pavel одобрил канон):** канон уже был — `lib/i18n/format.js formatMoney` (locale + min0/max2 = копейки если есть) + `useI18nFormat`. Добавил модульный `getActiveLang/getActiveLocale/fmtMoneyActive` (синкается в `applyLuxonLocale`, провайдер зовёт при смене языка) для не-хуковых мест. Подключил расходившиеся: `index.jsx fmt`→fmtMoneyActive; `EventViewBody fmtPrice`→канон, `fmtDT/fmtDate`→убрал `.setLocale('ru')`; `budget/money.js fmtMoney`→+minFraction:0; `BudgetLens money`→getActiveLocale; `ChatLens` времена/даты→getActiveLocale. ⚠️ ВИЗ-ИЗМЕНЕНИЯ (нужен прогон): цены теперь локале-раскладка + копейки-если-есть (события раньше округляли); даты/время событий/бюджета/чата теперь по языку (были всегда RU). editor fmtD/fmtDW оставлен (уже локале-зависим через передаваемый lang).
**P1 ОСТАЛОСЬ:** условные ховеры (по желанию); i18n index.jsx/dock.jsx (хардкод RU: «Скрыть», RoleBadge роли, «Открыть»); `--fs-display` + eslint-гейт; сведение TripLimitDialog (PublicTrip Pavel переделывает сам — отложено); P0-6. **P2 a11y:** 44px тач-цели, aria-label вместо title, role=radio для Pro, table-семантика Members/Budget, role=alert Login, контраст muted-2, confirm/alert→AlertDialog.

**Прочие баги из аудита:** Inbox запрос на user.email (vs user_id миграция [[triplanio-userid-migration]]); SettingsLens ApproverRow toggle не персистится; ChatLens shimmer position; PublicTrip http→https. Pre-existing eslint errors в Trips.jsx (unused imports useSearchParams/PaymentSuccessDialog/PaymentFailDialog) — не мои, не блокируют build.

Связано: [[triplanio-editor-ui-redesign]], [[triplanio-i18n-no-hardcode]], [[triplanio-mapbox-migration]].
