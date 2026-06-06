# Triplanio — сплошной аудит текстовок (en / es / ru)

**Дата:** 2026-06-06 · **Репо:** `triplanio_new` (source of truth, ветка `dev`) · **Метод:** ux-copy, 5 параллельных под-проходов по фиче-кластерам со сверкой по компонентам-потребителям.
**Спецификация:** `COPY_STYLE_GUIDE_2026-06-06.md`. **Предыстория:** P0 voice-пасс 2026-06-05 (`DESIGN_UX_AUDIT_2026-06-05.md`).
**Охват:** 33 неймспейса × 3 языка = **1921 ключ/язык**. Режим — **гибрид** (механические правки применены; спорные переименования вынесены на решение Pavel).

---

## 1. Итог за 30 секунд

Проверена **каждая** строка во всех трёх языках и сверена с функционалом, который она описывает. Применено **192 правки** (механические, безопасные): убраны технические термины из разработки, остатки «вы», битая грамматика, символы/стрелки/`$`-суммы в тексте, выровнен регистр EN/ES. **Сборка зелёная, паритет ключей идеальный (0 потерянных).**

Осталось **твоё решение** по ~12 спорным переименованиям (продуктовые имена разделов/шагов/фич и тон маркетинга) — раздел 4. Плюс найдены **функциональные несоответствия и баги** (раздел 5) и **захардкоженные тексты вне i18n** с готовым планом выноса (раздел 6).

---

## 2. Что применено (по категориям)

Полный список — в `git diff`. Здесь — суть и репрезентативные примеры.

**A. Технические термины из разработки → человеческий язык (complaint #1, #2).**
- `метаданные` → «детали» (`trip.edit_metadata`, RU; EN/ES уже были «details/detalles»).
- `режим структуры` / `Structure editing` / `Edición de la estructura` → «режим редактирования» / «Edit mode» / «Modo de edición» (`tse.section_eyebrow`, `trip.frozen_note`, `trip.edit_structure`).
- `парсинг` / `parser` / `parsing` → «распознавание (броней)» / «booking recognition» / «reconocimiento de reservas» (`sub.*`, `account.*`, `trips.*`).
- `идентификатор из сессии` / `session identifier` → «Сессия истекла. Войди снова.» (`planner.err_no_session`, все языки).
- `занять блокировку` / `acquire the lock` → «Не удалось войти в режим редактирования» / «Couldn’t open edit mode» (`tse.lock_err_desc`).
- RU-транслит: `апгрейд`→«переход на Pro / Подключить Pro», `инбокс`→«Входящие», `чекаут`→«оплата», `драфт`→«черновик», `фичи`→«функции/возможности», `варнинг`→«предупреждение», `таймзона`→«часовой пояс», `дефолтные`→«загружаются автоматически», `FX-override`→«свои курсы валют», `Аппрувер`→«по роли участника / кто голосует».
- `materializing` / `материализуются` (DB-жаргон в статусе AI) → «добавляю города, переезды и активности».

**B. Остатки «вы» → «ты» (RU, complaint #3), которые P0 не добил.**
`ai_plan.prompt_label_initial` «Ваши пожелания»→«Твои пожелания»; drop-хинты hotel/transfer/common («Перетащите/загрузите»→«Перетащи/загрузи»); `notif.tpl_invite_title` «Вас пригласили»→«Тебя пригласили»; `members.you` «вы»→«ты»; `budget.fx_subtitle`, `service.*`, `hotel.*`, `view.*` и др.

**C. Битая грамматика.**
`visit.kind_start_hint` «Откуда ты выезжаете»→«выезжаешь»; `trips.free_limit_title` «доступен 1 активное»→«доступно»; `trips.invited` «Приглашен»→«Приглашён»; ES `assistant_label` «Asistente IA»→«Asistente de IA»; ES `trip_menu` добавлены артикли.

**D. Символы / стрелки / `$` в тексте (de-AI, §3).**
Убраны `⭐`/`✓`/`•`/ведущие `- `/завершающие `→ ←` из строк (`sub.most_popular`, `sub.selected`, `account.pro_yearly_sub`, `planner.back/next/open_trip/to_trips`, `notif.open_full_inbox`, `doc.tab_add`, `admin.*.back_home`, hotel/transfer хинты). Семантические `{from} → {to}` оставлены. `$45/мес` в `service.insurance_safetywing_hint` → «цены у партнёра» (все языки). ASCII `...` → `…`.

**E. Регистр (complaint про нормы UI).**
- **EN** Title Case → sentence case для лейблов/кнопок/заголовков секций: `Trip Settings`→`Trip settings`, `Calendar View`→`Calendar view`, `Hotel Selection`→`Hotel selection`, `AI Trip Planner`→`AI trip planner`, `Cities & Dates`→`Cities & dates`, `Choose Plan`→`Choose plan` и т.д. (Pro/Telegram/PDF — оставлены как имена.)
- **ES** Title Case → sentence case: `Planificador de Viajes con IA`→`…viajes con IA`, `Suscripción Pro Mensual`→`…Pro mensual`, `Pasaporte, Seguro, Lista`→`…seguro, lista` и т.д.

**F. Точечная гуманизация роботичных формулировок** (`account.cancelled_desc`, `ai_plan.status_*`, `settings.*`, `members.empty`).

---

## 3. Глоссарий, зафиксированный в этом проходе

- RU — на «ты». «Путешествие» — канон; «поездка» допустима контекстно (реш. Pavel).
- Термины-замены — таблица §3 гайда.
- Инварианты: ключи не переименовываются, плейсхолдеры/плюралы сохранены, en/es/ru одинаковы по ключам.

---

## 4. ⚠️ ТРЕБУЕТ ТВОЕГО РЕШЕНИЯ — спорные переименования (НЕ применены)

Это продуктовые имена и тон. Дай по каждому ответ — применю отдельным батчем.

| # | Что | Сейчас (ru / en / es) | Моя рекомендация |
|---|---|---|---|
| 1 | **Семейство «аддон»** (`trip.section_addons`, `trip.addon_activation_hint`, `trip.settings_subtitle`, `budget.addon_off_title`) | Аддоны / Enhancements & Add-ons / Mejoras y complementos (+ES разнобой «módulo» vs «complemento») | RU «Возможности» (или «Дополнения»), EN «Add-ons», ES «Complementos» — **одно слово везде** |
| 2 | **Шаги планнера** `planner.step_cities` / `planner.step_review` | Скелет путешествия / Trip skeleton / Esqueleto · Финальный драфт / Final draft / Borrador final | «Города и даты» / «Проверка» (или «Маршрут» / «Проверка») |
| 3 | **Имя Free-тарифа** `trip_menu.free_trip_title` | Free-путешествие / Free trip / Viaje Free | Оставить «Free» (бренд тарифа) или «Базовый/Basic/Básico» — твой выбор |
| 4 | **Лейбл «Upgrade trip»** (`trip_menu.upgrade_trip`, `sidebar.upgrade_trip`) | RU уже «Подключить Pro» / Upgrade trip / Actualizar viaje | Выровнять EN/ES под RU: «Get Pro» / «Cambiar a Pro»? |
| 5 | **Роль «approver»** (`settings.approver_by_role`, `settings.approvers_title`) | RU уже «по роли участника / кто голосует» / Approver by role / Aprobador por rol | EN «By role» / «Who votes on hotels», ES «Por rol» / «Quién vota los hoteles» |
| 6 | **Роль «viewer»** (`members.badge_viewer` vs `members.role_viewer`) | Зритель ↔ Участник (только просмотр) | Свести к одному: «Наблюдатель» или «Только просмотр» |
| 7 | **Offline-участник** (`members.mode_offline`, `badge_offline`, `add_offline`) | Оффлайн (англицизм) / Offline / sin conexión | RU «без аккаунта»? (ES уже «sin conexión») |
| 8 | **Имя экрана Inbox** (`notif.inbox_title`, `notif.open_full_inbox`) | Сейчас «Входящие» / Inbox / Bandeja — разнобой | Унифицировать: «Уведомления» / «Notifications» / «Notificaciones» |
| 9 | **Тип города transit/layover** (`tse.transit*`, `tse.layover`) | транзит / transit / tránsito | «пересадка» или оставить «транзит» |
| 10 | **`account.identity`** (применил «Профиль/Profile/Perfil») | было Идентичность / Identity / Identidad | Подтвердить «Профиль», ИЛИ «Личные данные» если планируется отдельная страница Profile |
| 11 | **Тон маркетинга** — `sub.*` (питч Pro), `trips.empty_*` / `subtitle_motto`, `account.free_desc` / `cancelled_note` | Канцелярит/перечень запретов; RU-версии Pro сильнее EN | Отдельный проход «голос консьержа»; RU как эталон, подтянуть EN/ES |
| 12 | **CTA `ai_plan.generate_draft`** | Сгенерировать черновик / Generate draft / Generar borrador | «Собрать маршрут» — теплее инженерного «сгенерировать»? |

---

## 5. Функциональные несоответствия и баги (текст ↔ функция, complaint #4)

Не чистый копирайт — требует решения или отдельного фикса.

1. **💰 `sub.badge_discount` «−33%» захардкожен в `Pro.jsx` (стр. ~119), не считается из Stripe.** Если цены изменятся — баннер соврёт. → считать из `renderPrice(pro_monthly)` vs `renderPrice(pro_yearly)/12`. (Деньги — приоритет.)
2. **💰 `sub.plan_pro_feature_past` «Edit past trips».** Проверить: реально ли Pro даёт редактировать завершённые путешествия? Если нет — убрать из списка benefits (ложное обещание). Связано: `validation.TRIP_PAST_READONLY` объявлен, но в `validation.js` не эмитится — найти реальный guard.
3. **`service.insurance_safetywing_hint`** — `$45` убран; подтвердить, что у SafetyWing нет фиксированной цены для всех регионов (партнёрская ссылка).
4. **Инвайт по ссылке — заглушка.** `MembersLens` рендерит фейковый код (`4f6b-v-x29a`); таб «ссылка» ничего не шлёт. Копирайт описывает задуманное поведение — баг в компоненте (известно: продуктовое решение Pavel).
5. **`admin.notifications.when`** переиспользован в **клиентских** `EventPanels.jsx` / `EventViewBody.jsx` как лейбл даты брони. → завести `event.when_label` (Когда/When/Cuándo) и не тянуть admin-ключ в клиентский UI.
6. **`chat.ai_can_3` «Может править путешествие с согласия владельца».** Похоже на обещание нереализованной фичи (ChatLens только шлёт сообщения). Проверить; если нет — «Помогает планировать маршрут».
7. **Дубликаты-сироты:** в `ru/trip.js` (~стр. 118–124) живут старые `ai_plan.*` ключи (с «вы»-ошибками), перетёртые реальным `ai_plan.js`. Мёртвые — проверить потребителя и удалить.
8. **`trip.notif_*`, `trip.approvers_*`, `trip.addon_activation*`** в `trip.js` — похоже, не потребляются (SettingsLens использует `settings.*`). Кандидаты на удаление после проверки.

---

## 6. Захардкоженные тексты вне i18n (complaint #5) — план выноса (НЕ применено)

Это правки кода — по правилу проекта выношу планом на твоё «ок».

| Где | Что | План |
|---|---|---|
| `src/pages/Landing/LandingPage.jsx` | **Целый инлайн-объект i18n** мимо системы (`thumb.*`, `faq.*`…), внутри — «AI voucher parsing» (жаргон в публичном FAQ) | Вынести в `locales/*/public.js` (или новый `landing.js`), 3 языка; «parsing»→«распознавание». Отдельная задача (большой объём). |
| `src/design/index.jsx` (~682–686) | RU-литералы `label:` рядом с `labelKey` (Заезд/Выезд/Дедлайн отмены/Получение/Возврат) | **Мёртвые fallback’и** (потребители всегда зовут `t(labelKey)`). Удалить литералы. Низкий приоритет. |
| `src/pages/MembersLens.jsx:129` | `<Field label="E-mail">` хардкод | Ключ `member.field_email` (E-mail / Эл. почта / Correo) + `t()`. |
| `src/components/notifications/NotificationsBell.jsx:262` | `✓ {t('notif.accepted')}` — символ ✓ в JSX | Заменить на `<Icon name="check"/>` (паттерн уже есть в этом файле). |

---

## 7. Верификация

- ✅ Сборка: `vite build` зелёная.
- ✅ Паритет: 33 неймспейса, 1921 ключ/язык, наборы ключей en/es/ru идентичны, 0 потерянных.
- ✅ Diff: 59 файлов, 192/192 (только значения; ключи, плейсхолдеры, плюрал-семьи не тронуты).
- ✅ Остаточный скан tech-терминов/«вы»/символов/`$` — чисто (кроме вынесенного в §4 спорного и §6 хардкода).

---

## 8. Фаза 2 — решения Pavel применены (2026-06-06)

Сборка зелёная, паритет 1921×3, итого diff: 78 файлов, 609/609 (только значения).

**Переименования (применены):**
- **Аддоны** → RU «Расширения», EN «Add-ons», ES «Extensiones» (section_addons, settings_subtitle, addon_activation_hint; ES убран разнобой complemento/módulo).
- **Шаг планнера** «Скелет» → «Маршрут» / «Route» / «Ruta»; «Финальный драфт» → «Проверка» / «Review» / «Revisión».
- **Раздел редактора** → «Планирование» / «Planning» / «Planificación» (tse.section_eyebrow, exit_editor, reset_title, lock_err_title/desc, trip.edit_structure).
- **Кнопка Pro** → RU «Улучшить до Pro», EN «Upgrade to Pro», ES «Mejorar a Pro» (унифицированы все upgrade-CTA: trip/trip_menu/trips/settings/sub). `trips.go_pro` («Перейти к Pro»/«Go to Pro») оставлен — это навигация на экран Pro, а не действие апгрейда.
- **viewer** → RU унифицирован в «Наблюдатель» (badge/role/desc/short/trips/notif). EN «Viewer», ES «Lector» уже консистентны.
- **Free-тариф** — оставлен «Free» (реш. Pavel).
- **Оффлайн-участник** — оставлен «Оффлайн» (реш. Pavel).
- **Inbox** → RU «Входящие», ES «Bandeja de entrada», EN «Inbox».
- **account.identity** → «Профиль / Profile / Perfil» (подтверждено).

**Обобщение «вылет» (complaint про транспорт):** `tse.departure_word` RU «Вылет» → «Отправление» (показывался для старта любого города независимо от типа транспорта; EN «Departure» / ES «Salida» уже были общими). Кандидаты того же класса (не трогал, на твоё усмотрение): `planner.home_title` «Откуда вылетаешь?», `planner.departure_date` «Дата вылета».

**Точки в конце фраз:** убрана завершающая `.` у **560 строк** (3 языка) — у одно-предложенческих фраз/лейблов/подсказок. Сохранены: многострочная проза (несколько предложений), `?`, `!`, многоточие `…`, сокращения (`err.`, `act.`, `{n} ...` и т.п.). Если хочешь оставить точки у полных описательных предложений — скажи, верну выборочно.

**Транзит → пересадка (применено).** Перепроверил компонент (`TripStructureEdit.jsx:1083–1094`): слово «транзит» показывалось только у 1-дневной точки-проезда (тег «Пересадка» + подстрока «транзит · дата») и в подзаголовке пикера; тип с ночёвкой подписан «Город» / «Остановка с ночёвками» — **коллизии нет**. Убрал «транзит» полностью: `tse.transit_word` → «проездом» / «passing through» / «de paso» (подстрока, чтобы не дублировать тег); `tse.transit` → «пересадка» / «layover» / «escala»; `tse.pt_waypoint_sub` «Транзит на 1 день» → «На 1 день, без ночёвки» / «One day, no overnight» / «De 1 día, sin pernoctar». Тип-точка остаётся «Пересадка» / «Layover» / «Escala».

---

## 9. Фаза 3 — планнер, CTA, вынос хардкода (2026-06-06)

Сборка зелёная, паритет **34 неймспейса, 2110 ключей/язык**.

**Планнер (обобщение «вылет», реш. Pavel):** `planner.home_title` «Откуда вылетаешь?» → «Откуда стартуешь?» / «Where do you set off?» / «¿Desde dónde sales?»; `planner.departure_date` RU «Дата вылета»→«Дата отправления»; `return_desc`/`return_other_desc` — убраны «вылететь»/«fly»/«volar» → «уехать»/«head»/«ir». **CTA** `ai_plan.generate_draft` RU «Сгенерировать черновик» → «Собрать маршрут».

**Вынос хардкода — итог триажа (важно):** приложение **уже почти полностью на i18n**. Сплошной скан кириллицы в `.jsx`/`.js` показал, что подавляющее большинство — это **комментарии и regex** (Login — классы символов пароля), а не UI. Реально не вынесенного пользовательского текста было два места:
- **`AppErrorBoundary.jsx`** (экран краша) — «Что-то пошло не так / Неизвестная ошибка / На главную» → вынесено в самодостаточную 3-язычную карту `CRASH_COPY`, выбор языка по localStorage. (Намеренно НЕ через центральный i18n: error boundary рендерится, когда рантайм/контекст мог упасть.)
- **`LandingPage.jsx`** — имел СВОЙ инлайн-словарь `TRANSLATIONS` (en/es/ru, ~189 ключей) и свой `useT`/`LangCtx`. **Перенесён в центральный i18n**: `locales/{en,es,ru}/landing.js` (ключи с префиксом `landing.`), компонент переведён на центральный `useT`/`useI18n`. **Попутно исправлен баг:** лендинг хранил язык в `triplanio.lang`, а остальное приложение — в `travel-planner-lang` (рассинхрон языка лендинг↔приложение). Теперь общий ключ.

**Оставлено как есть (не хардкод-баги):** символы валют «лв»/«дин» (`currencies.js`, языконезависимы); родные имена языков «Русский» (`translations.js`, показываются как есть); мёртвые `label:`-фоллбэки рядом с `labelKey` (`design/index.jsx`, `booking-platforms.js` — уже привязаны к ключам, литерал не виден); шаблоны бота/уведомлений (`notifications-catalog.js`, RU-only `_ru`/`hardcodedText` — вне охвата этого прохода по решению Pavel, отдельный трек бота).

**Остаётся открытым (твоё решение):** тон маркетинга (sub/trips/account); `sub.badge_discount` «−33%» захардкожен в `Pro.jsx`, не из Stripe (ты делаешь отдельно); **Pro-гейт прошлых поездок** — структуру прошлого путешествия Pro редактировать может (`TripView` `canEditMode = … || tripIsPro`), но форма названия/описания (`TripFormDialog`) блокирует прошлые поездки для ВСЕХ, включая Pro (не получает `tripIsPro`) → мелкая нестыковка: Pro может править маршрут, но не переименовать. Рекомендация: прокинуть `tripIsPro` в `TripFormDialog` (`isPastTrip = … && !tripIsPro`).
