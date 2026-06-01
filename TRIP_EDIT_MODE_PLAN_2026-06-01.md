# План внедрения — Edit Mode / песочница

Дата: 2026-06-01. Парный документ к `TRIP_EDIT_MODE_TZ_2026-06-01.md` (ревизия 2026-06-01).
Репо: `triplanio_new` (source of truth), деплой **dev + main**, Supabase **prod** (`tizscxrpuopobgcxbekf`) + **dev** (`nydhzevdizkfaxdlikgc`).

Принцип выката: каждый шаг самодостаточен и не роняет прод между шагами. Сначала всё, что нейтрально для текущего UI (миграции + плумбинг `position` с идентичным поведением), потом новый экран за флагом, в самом конце — снятие старых блокировок и включение гейта сохранения.

---

## 0. Инварианты, которые держим всю дорогу

- Каркас контента не меняется: `hotel.city_visit_id`, `activity.city_visit_id`, `transfer.from/to_city_visit_id` остаются. Единственное добавление — `city_visits.position`.
- `position` ЖЁСТКО подчинён датам: сортировка узлов везде `(start_datetime, position)`. Расхождения position↔хронология не существует by design (см. Фаза 1).
- Песочница не пишет контент в БД до Save. Исключение — метаданные лока (`editing_by`/`editing_since`/heartbeat): это не контент.
- Перемещение/каскад/reorder двигает ТОЛЬКО город; отели/активности/трансферы стоят и варнят.
- `trip_services` не трогаем нигде.

---

## Фаза 0 — Миграции схемы (prod + dev, нейтральны для UI)

**Файлы:** `supabase/migrations/0012_trip_edit_lock.sql`, `supabase/migrations/0013_city_visits_position.sql` (нумерация — после текущего 0011).

**0012 — лок редактирования на `trips`:**
```sql
alter table public.trips
  add column if not exists editing_by    uuid references public.users(user_id) on delete set null,
  add column if not exists editing_since timestamptz;
```
Нейтрально: новые nullable-колонки, текущий UI их игнорирует.

**0013 — `city_visits.position` + бэкофилл:**
```sql
alter table public.city_visits add column if not exists position int;
-- backfill: тот же порядок, что сейчас даёт sortVisits (start, затем end), внутри каждого трипа 0..N.
with ordered as (
  select id,
         row_number() over (
           partition by trip_id
           order by (kind='start') desc, start_datetime nulls last, end_datetime nulls last, id
         ) - 1 as pos
  from public.city_visits
)
update public.city_visits cv set position = ordered.pos
from ordered where ordered.id = cv.id;
```
Замечания:
- Бэкофилл воспроизводит текущий `sortVisits` (start-якорь первый, далее по `start`, тай-брейк по `end`), чтобы `(start, position)` дал **ровно тот же** порядок, что и сейчас → прод визуально не меняется.
- Колонку НЕ делаем `NOT NULL` сразу (старый код вставляет города без position между Фазой 0 и Фазой 1). Можно добить `NOT NULL DEFAULT` отдельной миграцией после Фазы 1.
- Применять одинаково на prod и dev. Через MCP `apply_migration` либо CLI `supabase db push` (помним грабли `--no-verify-jwt` — к этим миграциям не относится, они не трогают edge-функции).

**Зависимости/impact:** нет. Чтение `select *` начнёт отдавать `position` автоматически.

---

## Фаза 1 — Плумбинг `position` (поведение идентично текущему)

Цель: ввести `position` в код так, чтобы пользователь не заметил изменений. Это «обезвреживает» главный архитектурный риск до того, как мы что-то снимаем.

1. **`src/lib/validation.js` → `sortVisits`:** добавить `position` в тай-брейк ПЕРЕД текущим тай-брейком по `end`:
   `rank(start/end) → start_datetime → position → end_datetime`.
   Если у обоих `position == null` (до бэкофилла где-то) — поведение откатывается к текущему (по `end`). Это делает переход безопасным.
2. **`src/pages/TripView.jsx` → TimelineLens:** проход рендера уже идёт по `ordered` (результат `sortVisits`). После п.1 он автоматически учитывает `position`. Проверить, что `prevCity`-сквозняк и пары трансферов берут тот же `ordered` (по коду — да, единый проход). Доп. правок рендера не требуется, кроме сверки.
3. **Инсёрт-пути проставляют `position`:**
   - `src/pages/ManualPlanner.jsx` — при сборке трипа города идут массивом по порядку; писать `position = index` (переиспользовать существующий проход, где формируется `cityVisitIdMap`).
   - `src/pages/AiTripPlanner.jsx` — то же при материализации ИИ-плана.
   - `copyTrip` (edge) — копировать `position` исходных визитов 1:1 при ремапе id.
4. **Payload passthrough:** проверить, что `getTripDetails`/`getPublicTrip`/`_shared/tripPayload.ts` отдают `city_visits` через `select('*')` (тогда `position` течёт сам). Если где-то перечислены колонки явно — дописать `position`. То же для `MapView`/`mapRoute` (станет надёжнее на общих днях).
5. **Нормализатор позиций (чистая ф-ция, понадобится в песочнице, но завести здесь):**
   `normalizePositions(nodes)` → сорт по `(start, текущий on-screen index)` и переустановка `position = 0..N`. Держать рядом с `sortVisits` в `validation.js` (без обращения к БД).

**Тесты:** юнит на `sortVisits` с `position` (кейс `city1 10-12 / city2 12-12 / city3 12-12 / city4 12-14` — порядок city2/city3 решается position; при равных датах и null position — стабильность). Снять до/после-снапшот порядка на нескольких реальных трипах dev (через `scripts/clone-trip.mjs`) — порядок не должен измениться.

**Impact:** TimelineLens, ManualPlanner, AiTripPlanner, copyTrip, payload-функции, MapView. Бюджет/календарь/PDF — не затронуты.

---

## Фаза 2 — Валидатор A–E как чистые функции (не подключён к блокировке)

**Файл:** `src/lib/validation.js` (расширяем существующее, переиспользуем `hotelWarnings`/`activityWarnings`/`transferWarnings`/`tripWarnings`).

- **A (новый `cityWarnings`/узловой валидатор):** A1 нет дат (`transit` обязателен; якоря пропускать), A2 `start>end`, A3 пограничный день ОК / наслоение глубже погран-дня = варнинг / разрыв >1 дня = варнинг. Заменяет жёсткий `overlapWith` из `CityVisitDialog` (сам блок снимаем в Фазе 5).
- **B:** B1/B2 уже есть (стр. 37/39). Добавить B3 (сирота — `city_visit_id` null/удалён). **Убрать** ветку пересечения отелей (стр. 42-49) — но только в Фазе 5, чтобы не менять текущий таймлайн раньше времени; здесь подготовить флаг/новую чистую ф-цию.
- **C:** C1/C2 есть (стр. 60/61). Добавить C3 (сирота).
- **D:** D1/D3 есть (стр. 80/84). Добавить D2/D4 (симметрия, сравнение по календарному дню в tz города), D5 (несоседние узлы по `(start, position)`, строго; включает «назад во времени»), D6 (висячий конец). `transferGroupWarnings`/`MAX_TRANSFER_SEGMENTS` — пометить к удалению (удалить в Фазе 5 вместе с переходом на waypoint-цепочки; пока оставить, чтобы текущий EventEditDialog не сломать).
- **E:** E1 «нет переезда между соседями» — вынести в чистую ф-цию по соседям `(start, position)` (сейчас живёт в рендере `hasTransferBetween`); E2 один город подряд (различать по идентичности города, не `city_visit_id`); E3 дубликат (1 трансфер на пару соседей). Ветку «разрыв >24ч» (стр. 166) заменить на A3.
- Единый агрегатор `computeTripValidation(draft)` → структурированный список `{level, code, nodeId/eventId, message}` для UI песочницы и для гейта сохранения.

**Тесты:** юнит-набор на каждый кейс A–E из стресс-теста (Рим-13/билет-16 для D4; перелёт город7→город2 для D5; Мадрид→Мадрид для E2). Это критично — на этих функциях держится и гейт, и подсветка.

**Impact:** только новые/расширенные чистые функции. К блокировке НЕ подключаем — доступны для следующих фаз.

---

## Фаза 3 — Экран Edit Mode (черновик в памяти) + лок + заморозка мутаций. Save выключен

1. **Маршрут/вход:** новый роут (напр. `/trips/:id/edit`) или модальный полноэкранный режим. Гейт входа = текущая модель доступа:
   `canEditMode = myRole !== 'viewer' && (!isTripInPast(visits) || tripIsPro)`.
   Переиспользовать `myRole`, `isTripInPast` (`trip-dates.js`), `tripIsPro` (`is_pro_trip || ownerProResolved`). **Учесть async-резолв** `ownerProResolved` (через `checkSubscriptionStatus`): пока не резолвнулось — кнопку Edit для ПРОШЛОГО трипа держать в загрузке (тот же паттерн `proResolved`, что для баннера), иначе мигнёт.
2. **Лок:** при входе атомарно занять (`editing_by`/`editing_since`) если пусто или TTL>30мин; иначе экран «Трип редактирует <имя>». Heartbeat `editing_since=now()` ~5 мин. Выход (Save/Отмена) — `editing_by=null`. `beforeunload` best-effort. Реализовать как RPC `acquire_trip_lock(trip_id)`/`release_trip_lock(trip_id)`, чтобы захват был атомарным (single round-trip, без гонки read-then-write).
   - **Долг (зафиксирован в ТЗ §3):** простаивающая открытая вкладка держит лок (heartbeat < TTL). Приемлемо (prod≈1 юзер).
3. **Черновик:** read трипа (shell+content) → нормализованная in-memory модель (узлы с `position`, события с реальными id, список «к удалению», temp-id для новых). `sessionStorage`-персист (паттерн `ManualPlanner:1329-1360`), переживает перезагрузку вкладки.
4. **UI каркаса:** города-блоки с датами + переезды между. Reorder + правка дат + add/edit/delete городов и событий. Переиспользовать `CityRow`/`recomputeDates` из ManualPlanner как ОТДЕЛЬНЫЙ компонент (не визард). Каждое действие → пересчёт `position` (`normalizePositions`, Фаза 1.5) + пересчёт валидаций (Фаза 2) на лету. Удаление = только пометка.
5. **Заморозка мутаций вне песочницы (ТЗ §3a):** пока `editing_by` занят — скрыть/задизейблить в `TripView` и компонентах все add/edit/delete эвентов (`hotel_stays`/`activities`/`transfers`) с подсказкой «Трип сейчас редактируется». Точки (по коду): `setHotelChoice/Edit`, `setTransferChoice/Edit`, `setActivityEdit`, `AddDayButton`, `Missing*Warning`-кнопки, `openEventView→EventEditDialog` (вкл. внутр. «Удалить» `:599`), `confirmDeleteCity`, прямые delete в `HotelTimeline:20`/`ActivityList:27`/`TransferStrip:30`, инлайн `isEditMode` таймлайна. **`trip_services`/`ServiceDialog`/`ServicesWidget` — НЕ морозим.** Просмотр таймлайна НЕ ограничиваем.
6. **Save пока скрыт/выключен.** На этом этапе экран читает, валидирует, держит черновик и лок — но не пишет контент.

**Impact:** новый экран; точечные гейты в `TripView.jsx` и delete-компонентах; RPC лока. Чтение существующего трипа не меняется.

---

## Фаза 4 — Batch-save (upsert по id + явные удаления) + пост-пересчёт бюджета

Алгоритм (только когда валидаций нет — но кнопку всё ещё держим выключенной до Фазы 6, тестируем вручную/на dev):

1. **Удаления** (отложенный список): явные DELETE в порядке `hotel_stays → activities → transfers → city_visits`. Трансферы — ВСЕГДА явно (FK = SET NULL, не cascade): оба конца удаляются → DELETE; один конец выживает → это D6-сирота, гейт не пускает к Save, пока не исправлено.
2. **Города:** upsert — существующие `update` по id; новые — `insert ... returning id`, запомнить ремап `temp-id → id` (паттерн `cityVisitIdMap` из `ManualPlanner`/`copyTrip`). Писать актуальный `position`.
3. **События:** upsert — существующие по своему id (правки на месте → бюджет/документы целы, id не рвётся); новые — insert; `city_visit_id`/`from/to_city_visit_id` для новых городов берём из ремапа п.2.
4. **Бюджет:** не полагаться на построчный шторм триггера `sync_budget_expense`; после записи — один пост-проход синхронизации `budget_expenses` с актуальным набором (меньше моргания сумм). Триггер оставить.
5. Освободить лок, инвалидация `TRIP_SHELL_KEY`/`TRIP_CONTENT_KEY` (`trip-data.js`).
6. Ошибка на любом шаге → откат/повтор, лок не отпускать, данные не терять.

**Транзакционность:** обернуть весь сейв в **RPC/функцию БД** (`save_trip_edit(trip_id, payload jsonb)`), чтобы частичный сейв не оставил трип в полусостоянии и чтобы пройти под одним RLS-контекстом. Это предпочтительнее, чем серия отдельных `supabase.from(...)` вызовов с фронта.

**Почему upsert, а не wipe+reinsert (подтверждено схемой):** `budget_expenses.source_id` — НЕ FK; связь расход↔событие держит триггер по `source_kind+source_id`. wipe+reinsert → новый id события → новый дефолт-расход → ручная правка суммы/категории теряется. Документы (`documents` jsonb, storage `attachments/{uid}/{name}`) переживут, но ссылки на event id порвутся. Upsert по id ничего не рвёт.

**Тест:** на dev на клонированном трипе (`scripts/clone-trip.mjs`, prod→dev, ремап на dev-юзера). Проверить: ручная правка авто-расхода переживает сейв; документы на месте; удаление города не оставляет сирот-трансферов и сирот-расходов.

**Impact:** новая RPC + клиент batch-save; пост-пересчёт бюджета. `confirmDeleteCity` логика переезжает сюда (Фаза 5).

---

## Фаза 5 — Снять старые блокировки

1. `CityVisitDialog.jsx` — снять `overlapWith`-блок (`canSave` `:172-175`, `overlapWith` `:93-105`): теперь overlap = варнинг A3 в песочнице, а не блок диалога.
2. `validation.js` — фактически удалить ветку пересечения отелей (`:42-49`) и `transferGroupWarnings`/`MAX_TRANSFER_SEGMENTS` (после перехода составных перелётов на цепочки — но это фаза waypoint; здесь только перестать использовать в новом валидаторе).
3. `TripView.jsx` — E1 окончательно перевести на чистую ф-цию из Фазы 2 (рендер использует её результат, `hasTransferBetween` уходит).
4. `confirmDeleteCity` — удаление города направить через batch-save (отложенная пометка), убрать немедленный каскад-delete + `alert()` (заменить на `AlertDialog`-паттерн по конвенции проекта).

**Impact:** меняет поведение таймлайна/диалогов. Делать после того, как новый валидатор и batch-save доказаны на dev.

---

## Фаза 6 — Включить гейт сохранения

Подключить `computeTripValidation` к кнопке Save: пусто → upsert-batch; есть хоть один варнинг/ошибка → Save заблокирован, список проблем виден. Прогнать сценарии корнер-кейсов (ТЗ §8) на dev: каскад→много варнингов; якоря; трансфер с удаляемым концом; город без дат после reorder; восстановление из sessionStorage; двое в шаренном трипе.

---

## Анализ зависимостей и зоны влияния (сводка)

| Область | Тип | Что делаем |
|---|---|---|
| `city_visits` (+`position`), `trips` (+lock) | схема | миграции 0012/0013 (prod+dev) |
| `validation.js` | менять | sortVisits тай-брейк; A–E; убрать overlap-отелей/24ч/group |
| `TripView.jsx` TimelineLens | менять | `(start, position)`; E1 из рендера; заморозка §3a |
| `CityVisitDialog.jsx` | менять | снять overlap-блок |
| `ManualPlanner`/`AiTripPlanner`/`copyTrip` | менять | проставлять/копировать `position` |
| `getTripDetails`/`getPublicTrip`/`tripPayload` | проверить | passthrough `position` (если select `*` — само) |
| `MapView`/`mapRoute` | проверить | сортировка по `position` |
| Новый экран Edit Mode + RPC лок/сейв | новое | Фазы 3–4 |
| `sendTripReminders`/`getDailyReminders`/`getPendingReminders`, Календарь, PDF | НЕ задеты | только читают коммитнутый трип |
| `trip_services`/сервисы | НЕ трогаем | вне песочницы и batch |

## Переиспользование (без дублирования)

- `recomputeDates` + `CityRow` (`ManualPlanner`) — каркас блоков/каскада дат.
- `cityVisitIdMap`-паттерн ремапа (`ManualPlanner`/`copyTrip`) — для новых городов в batch.
- `sessionStorage`-персист (`ManualPlanner:1329-1360`) — черновик.
- Чистые `hotelWarnings/activityWarnings/transferWarnings/tripWarnings` — основа A–E (расширяем, не пишем заново).
- `trip-data.js` (`TRIP_SHELL_KEY`/`TRIP_CONTENT_KEY`/`invalidateTripData`) — инвалидация после сейва.
- Гейт-хелперы `isTripInPast`, `tripIsPro`, `useTripAccess` — вход в Edit Mode (новых правил доступа не вводим).

## Риски / технический долг (зафиксировать)

1. **TTL-окно лока:** при протухшем TTL — узкое окно «двое редактируют» без финальной сверки версии (Pavel отказался от optimistic-lock; `trips.updated_at` существует, если решим вернуться). Приемлемо при prod≈1 юзер.
2. **Простаивающая вкладка держит лок** (heartbeat 5мин < TTL 30мин). TTL спасает только от закрытой вкладки.
3. **Каскад → шторм варнингов** (сдвиг города → стоящие отели/трансферы варнят). Принято как поведение этапа.
4. **Бэкофилл `position`** должен в точности повторить текущий `sortVisits`-порядок, иначе у существующих трипов «прыгнет» порядок городов. Проверять до/после-снапшотом на dev.

## Замеченные баги (вне задачи, проверить)

- `ActivityList`/`TransferStrip` после delete инвалидируют `['activities', tripId]` / `['transfers', tripId]`, а `TripView` читает контент по `TRIP_CONTENT_KEY=['trip-content', tripId]`. Похоже, прямой delete не освежает контент-кэш TripView (стейл до перезагрузки). Проверить и при работе над заморозкой §3a — заодно перевести на `invalidateTripData`.
- `confirmDeleteCity` использует `alert()` на ошибке — против конвенции проекта (AlertDialog). Поправить при переносе удаления в batch (Фаза 5).

---

## Git (выполнять пофазно; деплой dev + main)

Перед стартом каждой фазы — ветка от `dev`. После ревью — мёрдж в `dev` и `main` (оба деплоятся, ТЗ-требование). Пример для одной фазы:

```bash
# Фаза 0 (пример)
git checkout dev && git pull
git checkout -b feat/edit-mode-phase0-migrations

git add supabase/migrations/0012_trip_edit_lock.sql supabase/migrations/0013_city_visits_position.sql
git commit -m "feat(edit-mode): trips edit-lock cols + city_visits.position (+backfill) migrations"
git push -u origin feat/edit-mode-phase0-migrations

# после ревью:
git checkout dev && git merge --no-ff feat/edit-mode-phase0-migrations && git push origin dev
git checkout main && git merge --no-ff feat/edit-mode-phase0-migrations && git push origin main
```

Миграции применять на ОБА Supabase (prod `tizscxrpuopobgcxbekf` + dev `nydhzevdizkfaxdlikgc`). Документацию в Notion обновить отдельно (по запросу Pavel — позже).
