# Обложки трипа: пресеты + своё фото, без градиентов (TRIP covers)

Заменили дефолтные **градиенты обложек** на курируемую **галерею пресетов** + загрузку своего фото. Две фазы: Ф1 (продуктовая, PR #916, смёржена в dev) + Ф2 (выпил колонки).

## Модель (как работает сейчас)
- **Дефолт «нет обложки» = картинка, не цвет.** Фоллбек лежит в **репо** `public/covers/fallback.webp` (бандл/CDN Vercel — не зависит от Supabase). Единый JS-путь — `COVER_FALLBACK` (экспорт из `src/design/Cover.jsx`); CSS-подложка `.cover` держит тот же литерал. Дрейф JS↔CSS + отсутствие правил `.cover[data-cover]` пинит `src/design/Cover.test.js`.
- **Пресеты = общий справочник картинок.** Живут в Supabase (чтобы пополнять **без деплоя**): публичный бакет `trip-cover-presets` + таблица-каталог `cover_presets` (ярус D, RLS deny-all, читается только через edge). Выбор пресета **КОПИРУЕТ его публичный URL в `trips.cover_image_url`** — ровно как загрузка своего фото. Трип ссылается на КАРТИНКУ, а не на «пресет» → удаление/`active=false` пресета ничью обложку не ломает (инвариант требования Pavel). Бакет пресетов ОТДЕЛЬНЫЙ от `trips`: `collectDocPaths` (`storageCleanup.js`) фильтрует по бакету `trips`, поэтому смена/снос обложки-пресета не трогает общий файл.
- **Своё фото** — приватный бакет `trips`, подписанный URL, драфт-финализация (`finalizeDraftCover`) — без изменений.
- **Витрина каталога — edge `getCoverPresets`** (дверь `auth`, service_role, отдаёт `active` по `sort`; ошибки через `HttpError`). НЕ прямой клиентский SELECT (эпик «единая дверь» TRIP-374, гард 2r). Фронт кэширует React Query (`queryKey ['coverPresets']`, staleTime 1ч).
- **Пикер** `TripCoverPicker.jsx`: сетка пресетов на примитиве `<Swatch variant="round">` (его round-вариант и ЕСТЬ обложка-свотч), выбор = `aria-pressed`, картинка фоном. Ноль своих классов.
- **Рендер обложки** — 5 точек на `фото || COVER_FALLBACK`: `Trips.jsx` (3 формы карточек через `.tc__img`), `ManualPlanner` StepReview, `ScreenAccount` (`<Cover>`), `VisitPanel` (`.d` дот). Примитив `<Cover>`: фоллбек-фон + `<img onError>` (гасит битый/протухший src → просвечивает фоллбек).

## Как курировать набор (Pavel, без деплоя)
1. **Storage → бакет `trip-cover-presets`** → залить картинки (webp/png/jpeg, ≤5MB). `fallback.webp` в бакете можно оставить как выбираемый вариант — репо-фоллбек для «нет обложки» отдельный.
2. **SQL Editor** — самонаполняющийся идемпотентный insert (читает бакет ЭТОГО проекта, строит URL сам, без опечаток):
   ```sql
   insert into public.cover_presets (image_url, sort, active)
   select 'https://<PROJECT_REF>.supabase.co/storage/v1/object/public/trip-cover-presets/' || o.name,
          (row_number() over (order by o.name)) * 10, true
   from storage.objects o
   where o.bucket_id = 'trip-cover-presets'
     and not exists (select 1 from public.cover_presets cp
       where cp.image_url = 'https://<PROJECT_REF>.supabase.co/storage/v1/object/public/trip-cover-presets/' || o.name);
   ```
   PROJECT_REF: dev `nydhzevdizkfaxdlikgc`, prod `tizscxrpuopobgcxbekf`. Бакеты/таблицы у проектов РАЗДЕЛЬНЫЕ — заливать и сидить в обоих (prod — после `dev→main`).
3. **Убрать из галереи, не ломая выбравших:** `update public.cover_presets set active=false where image_url like '%<file>';`. **Порядок:** правь `sort`. **Проверить, что отдаст витрина:** `select id,image_url,sort from public.cover_presets where active order by sort;`.
- ⚠️ Сид на dev наполнен агентом (16 файлов) по прямой просьбе Pavel — это НЕ деплой (данные каталога), а штатный путь управления. prod — руками Pavel/агентом после мерджа.

## Фаза 2 — выпил колонки `trips.cover_gradient`
Колонка была nullable `DEFAULT 'gradient_1'` (baseline). После Ф1 — мёртвая. Ф2 (миграция `20260820201544_trip_drop_cover_gradient.sql`):
- Переопределены **4 живые RPC** (каждая с ОДНИМ edge-вызывателем под service_role, ни одна не мертва) дословно минус `cover_gradient`: `get_my_trip_cards` (edge `getTrips`), `get_user_travel_stats` (edge `getTravelStats`, security-sensitive), `update_trip_settings` (edge `trip-settings`), `copy_trip` (edge `trip-share`).
- Edge `telegramGetMyIntegrations` перестал `select`/возвращать `cover_gradient` (иначе `select` упал бы после дропа).
- `alter table trips drop column cover_gradient` (маркер деструктив-гарда 2b `ddl-guard: allow-destructive`; колоночный `GRANT UPDATE` снимается сам с дропом).
- `database.types.ts` регенерирован (гард 2t) — не править руками, воспроизводимый вывод `supabase gen types`.
- ⚠️ Унификацию 4 RPC рассматривали и ОТКЛОНИЛИ объективно: это 4 РАЗНЫХ тела (2 разных по форме чтения + insert + update), пересечение = 3 колонки трипа, общей SQL-абстракции ради 3 колонок = over-engineering (ponytail #1), а не reuse.

## Грабли (записаны кровью в этом эпике)
- **Гард 2t (DB types):** ЛЮБАЯ правка схемы (даже ADD таблицы в Ф1) требует регенерации `database.types.ts` в ТОМ ЖЕ PR. Локально CLI нет — качается байт-точный артефакт `database-types-generated` из упавшего CI-прогона (`GET /repos/.../actions/artifacts/<id>/zip`, токен в `$GITHUB_TOKEN`).
- **Migration numbering:** таймстамп обязан быть > журнала И second-precision (не `…0000`); пока работаешь, в dev могут влиться новые миграции — влей свежий dev + переименуй (`git mv`).
- **Гард 2p (semantics):** удаление CSS-правила = снятие деклараций у юнита → каждое требует `visual-diff-exempt` добавленной строкой (кроме `color`). 16 правил `.cover[data-cover]` сняты так.
- **Гард 2l (inline):** `style={{…}}` считается, `style={var}` — нет; фон из данных держи переменной.
- **Гард 2r (data-door):** новая edge-функция с `Response.json({error})` растит «сырые ответы» — ошибки через `throw HttpError` (рендерит `withHandler`).
- Диф-гарды (inline/prefixes/orphans/destructive) диффят ЗАКОММиченное — «nothing to check» до коммита не значит «прошло».
