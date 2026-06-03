# Triplanio — единый свод правил валидации (Ф0, ред. 2)

Статус: **предложение к согласованию.** Контракт для `validateEntity()` и единого показа.
Решения Pavel: out-of-bounds = **error**; все `start`/`end` обязательны, предзаполнены, неудаляемы; enforce пока только на фронте; показ = инлайн под полями + единая панель. Правки ред.2 учтены (см. §7).

---

## 1. Модель issue (единая для ВСЕХ форм — структурных и обычных)

```ts
type Issue = {
  level: 'error' | 'warning';   // error блокирует сохранение, warning — нет
  code: string;                 // стабильный код, напр. 'HOTEL_CHECKIN_OOB'
  scope: 'field' | 'entity' | 'structure';
  field?: string;               // модалка: инлайн-показ + подсветка поля
  // ссылки на сущности — для подсветки строк/счётчиков в Edit Mode:
  entityKind?: 'hotel'|'activity'|'transfer'|'city'|'service';
  entityId?: string;            // для одиночной сущности (hotel/activity/transfer/city)
  fromId?: string; toId?: string; // для парных structure-issue (разрыв/наложение/дубль)
  message: string;              // всегда через t()
  ctx?: Record<string, string>; // {city}, {from}, {to}, {n}…
};
```

> `field` обслуживает модалку (инлайн + рамка); `entityId`/`fromId`/`toId` — Edit Mode (подсветка строки перелёта, счётчик конфликтов города, открытие модалки сущности). Один и тот же Issue работает на обе поверхности.

`validateEntity(kind, draft, ctx) → Issue[]`. `canSave = issues.every(i => i.level !== 'error')`.
Один и тот же тип используют и структурные сущности (трип/город/событие), и обычные формы (бюджет/документы/участники) — ради **одинакового показа везде**.

---

## 1.1 Что такое `validateEntity` и откуда он берётся

`validateEntity` — это **новая чистая функция, которую мы создаём в Ф1** (в `src/lib/validation.js`). Сейчас её НЕТ. Сегодня валидация размазана; мы сводим её в один движок. Это не сторонняя библиотека — мы **консолидируем уже существующую логику**:

- из `hotelWarnings/activityWarnings/transferWarnings` (текущие OOB-проверки, сейчас soft),
- из ad-hoc проверок в `canSave` (EventEditDialog: required, порядок дат),
- из примитивов `computeTripValidation` (сравнение по календарным дням в tz: `dayInTz/calDay/dayGap`, `sortVisits`, `cityIdentity`) — **их переиспользуем как есть**.

### Форма модуля (целевая)

```ts
// ── примитивы (УЖЕ есть, переиспользуем) ──
// dayInTz, calDay, dayGap, cityIdentity, sortVisits, normalizePositions

// ── правила на ОДНУ сущность (НОВОЕ, ядро) — чистые, возвращают Issue[] ──
// validateHotel(draft, ctx) / validateActivity / validateTransfer / validateService / validateCity

// ── фасад для МОДАЛКИ (одна сущность, L1+L2 + structure про неё) ──
export function validateEntity(kind, draft, ctx): Issue[]   // диспатч по kind

// ── фасад для ВСЕГО трипа (Edit Mode, L3) — РЕФАКТОР computeTripValidation ──
export function validateTrip({ visits, hotels, activities, transfers }): Issue[]
// внутри: для каждой сущности зовёт validateEntity(...) + добавляет
// кросс-сущностные structure-issue (CITY_GAP/CITY_OVERLAP/DUP_TRANSFER, adjacency)

// ── вид для таймлайна (анти-куча) ──
export function primaryIssues(issues): Issue[]   // ≤1 на сущность по приоритету
```

`ctx` — контекст под kind: `{ visit }` для hotel/activity, `{ fromVisit, toVisit }` для transfer, `{ siblings, tripDates }` для city и т.д.

### Как ложится на нашу схему

| Поверхность | Зовёт | Что получает |
|---|---|---|
| **Event-модалка** | `validateEntity(kind, draft, ctx)` | issues одной сущности → инлайн под полями + панель; `canSave = нет error` |
| **Edit Mode** | `validateTrip(draft)` (= новый `computeTripValidation`) | issues всего трипа → панель + подсветка строк; `primaryIssues` для сетки |
| **Таймлайн (read)** | `validateTrip` → `primaryIssues` | только показ (аффордансы), без гейта |

Главное: **модалка и Edit Mode используют ОДНИ правила** (validateTrip строится поверх validateEntity), поэтому вердикт по одним данным совпадает по построению — это и есть цель рефактора. `computeTripValidation` не исчезает, а становится `validateTrip`, переиспользуя per-entity функции.

---

## 2. Уровни проверки

| Уровень | Что | Где | Блок |
|---|---|---|---|
| **L1 · поле** | required, время задано, порядок (end>start), формат (email) | любая модалка | error |
| **L2 · сущность-в-контексте** | границы города, стыковка дней | event-модалка + Edit Mode | error |
| **L3 · структура трипа** | наложение/разрыв городов, дубликаты, «висящие» без города | Edit Mode + подмножество в event-модалке | error/warn |
| **Бэк (Ф4, отложено)** | те же как CHECK/RPC | Supabase | — |

## 3. Показ (единый контракт, везде одинаково)

| scope | Где | Вид |
|---|---|---|
| `field` | под полем (`<FieldError>`) + красная рамка | красный текст |
| `entity` / `structure` | единая панель `<IssuesPanel>` над футером | error красный / warning янтарный; клик → фокус поля |

- Кнопка сохранения **disabled ⟺ есть хоть один `error`**.
- **Toast** — только сетевые сбои сохранения, не валидация.
- `start/end` предзаполнены из контекста; пустое = `error` + ресид (нельзя удалить, только менять).
- Единый стиль во всех модалках; никаких жёлтых EN-плашек.

Легенда: **E** = error (блок), **W** = warning (показ, не блок).

---

## 4. СТРУКТУРНЫЕ сущности (таймлайн трипа)

### 4.0 Trip (создание/метаданные — ManualPlanner / TripFormDialog)
| code | Ур. | scope | Условие | field | Сообщение |
|---|---|---|---|---|---|
| TRIP_TITLE_REQUIRED | E | field | название пустое | title | Укажи название путешествия |
| TRIP_START_REQUIRED | E | field | нет даты старта | startDate | Укажи дату начала путешествия |
| TRIP_NO_CITIES | E | structure | нет ни одного города маршрута | — | Добавь хотя бы один город маршрута |
| TRIP_CITY_UNRESOLVED | E | field | город введён, но не выбран из подсказок (нет координат) | city[i] | Выбери город из списка подсказок |
| TRIP_PAST_READONLY | E | entity | трип в прошлом (правка метаданных) | — | Прошедшее путешествие нельзя изменить |
| TRIP_COVER_TOO_LARGE | E | field | обложка > 4 МБ | cover | Файл слишком большой (макс. 4 МБ) |

### 4.1 Hotel (контекст: city visit)
| code | Ур. | scope | Условие | field | Сообщение |
|---|---|---|---|---|---|
| HOTEL_NAME_REQUIRED | E | field | название пустое | name | Укажи название отеля |
| HOTEL_CHECKIN_REQUIRED | E | field | заезд пуст / без времени | checkInLocal | Укажи дату и время заезда |
| HOTEL_CHECKOUT_REQUIRED | E | field | выезд пуст / без времени | checkOutLocal | Укажи дату и время выезда |
| HOTEL_ORDER | E | field | выезд ≤ заезд | checkOutLocal | Выезд должен быть позже заезда |
| HOTEL_CHECKIN_OOB | E | entity | день заезда < дня прибытия в город | checkInLocal | Заезд раньше прибытия в {city} |
| HOTEL_CHECKOUT_OOB | E | entity | день выезда > дня выезда из города | checkOutLocal | Выезд позже выезда из {city} |
| HOTEL_NO_CITY | E | structure | нет city_visit_id | — | Отель не привязан к городу |

> `HOTEL_OVERLAP` — **убрано** (по решению).

### 4.2 Activity (контекст: city visit)
| code | Ур. | scope | Условие | field | Сообщение |
|---|---|---|---|---|---|
| ACT_TITLE_REQUIRED | E | field | название пустое | title | Укажи название активности |
| ACT_START_REQUIRED | E | field | начало пусто / без времени | startLocal | Укажи начало |
| ACT_END_REQUIRED | E | field | конец пуст / без времени | endLocal | Укажи конец |
| ACT_ORDER | E | field | конец ≤ начало | endLocal | Конец должен быть позже начала |
| ACT_START_OOB | E | entity | день начала < дня прибытия в город | startLocal | Активность начинается раньше прибытия в {city} |
| ACT_END_OOB | E | entity | день конца > дня выезда из города | endLocal | Активность заканчивается позже выезда из {city} |
| ACT_NO_CITY | E | structure | нет city_visit_id | — | Активность не привязана к городу |

### 4.3 Transfer — одиночный (контекст: fromVisit, toVisit)
| code | Ур. | scope | Условие | field | Сообщение |
|---|---|---|---|---|---|
| TR_DEP_REQUIRED | E | field | отправление пусто / без времени | startLocal | Укажи дату и время отправления |
| TR_ARR_REQUIRED | E | field | прибытие пусто / без времени | endLocal | Укажи дату и время прибытия |
| TR_ORDER | E | field | прибытие ≤ отправление | endLocal | Прибытие должно быть позже отправления |
| TR_DEP_DAY | E | entity | день вылета отличается от дня выезда из {from} **более чем на 1 день** | startLocal | Вылет слишком далеко от дня выезда из {from} |
| TR_ARR_DAY | E | entity | день прилёта отличается от дня въезда в {to} **более чем на 1 день** | endLocal | Прилёт слишком далеко от дня въезда в {to} |
| TR_NOT_ADJACENT | E | structure | from/to не соседние узлы | — | Маршрут не сходится: {from} → {to} не соседние |
| TR_NO_CITY | E | structure | нет привязки к городам | — | Переезд не привязан к городу |

> Допуск ±1 день для вылета/прилёта (кейс рейсов в 00:20 на стыке суток).

### 4.4 Transfer — с пересадками (сегменты)
| code | Ур. | scope | Условие | field | Сообщение |
|---|---|---|---|---|---|
| SEG_MIN | E | entity | выбран режим «с пересадкой», но сегментов < 2 | — | Выбран переезд с пересадкой — нужно минимум 2 сегмента. Или переключи на переезд без пересадок. |
| SEG_DEP_REQUIRED / SEG_ARR_REQUIRED | E | field | отправление/прибытие пусто / без времени | seg{i}.start/end | Укажи дату и время |
| SEG_ORDER | E | field | прибытие ≤ отправление | seg{i}.end | Прибытие должно быть позже отправления |
| SEG_BACKSTEP | E | field | вылет < прибытия предыдущего сегмента | seg{i}.start | Отправление раньше прибытия предыдущего сегмента |
| SEG_CITY_REQUIRED | E | field | нет города пересадки (кроме последнего) | seg{i}.toCity | Укажи город пересадки |

### 4.5 Service (авто/esim/страховка)
| code | Ур. | scope | Условие | field | Сообщение |
|---|---|---|---|---|---|
| SVC_NAME_REQUIRED | E | field | название пустое | name | Укажи название |
| SVC_PICKUP_ADDR_REQUIRED | E | field | адрес получения пуст (при создании) | pickup_address | Укажи адрес получения |
| SVC_PICKUP_REQUIRED | E | field | получение пусто / без времени | pickup_at_local | Укажи дату и время получения |
| SVC_DROPOFF_REQUIRED | E | field | возврат пуст / без времени | dropoff_at_local | Укажи дату и время возврата |
| SVC_ORDER | E | field | возврат ≤ получения | dropoff_at_local | Возврат должен быть позже получения |
| SVC_OUT_OF_TRIP | **W** | entity | получение/возврат вне дат трипа | pickup_at_local | Услуга вне дат путешествия |

### 4.6 City visit
> Якоря **start/finish** — даты null by design: `CITY_DATES_REQUIRED`/`CITY_ORDER` к ним **НЕ применяются**.

| code | Ур. | scope | Условие | field | Сообщение |
|---|---|---|---|---|---|
| CITY_DATES_REQUIRED | E | field | у transit нет start/end (НЕ для start/finish) | startDate/endDate | Укажи даты города |
| CITY_ORDER | E | field | конец < начало | endDate | Конец раньше начала |
| CITY_OVERLAP | **E** | structure | наложение с соседним городом **более чем на 1 день** | — | «{a}» и «{b}» сильно наслаиваются |
| CITY_GAP | **W** | structure | разрыв > 1 дня между городами | — | Разрыв больше дня между «{a}» и «{b}» |

> Наслоение ровно в 1 день — **допустимо** (общий стыковочный день), не issue.

### 4.7 Трип-уровень
| code | Ур. | scope | Условие | Сообщение |
|---|---|---|---|---|
| DUP_TRANSFER | **W** | structure | дубль переезда между той же парой | Дубликат переезда {a} → {b} ({n}) |

> `NO_TRANSFER` — **убрано из валидации** (это фронт-аффорданс, отключается в настройках трипа).

---

## 5. НЕструктурные формы (тот же Issue-контракт, тот же показ)

Здесь только L1 (поля). Цель — единый вид ошибок и закрытие тихих дыр (чат/FX/сервис).

### 5.1 Budget — трата (AddExpenseDialog)
| code | Ур. | field | Условие | Сообщение |
|---|---|---|---|---|
| EXP_TITLE_REQUIRED | E | title | пусто | Укажи описание |
| EXP_AMOUNT_REQUIRED | E | amount | пусто / 0 / ≤0 / не число | Укажи сумму больше 0 |
| EXP_CATEGORY_REQUIRED | E | categoryId | не выбрана | Выбери категорию |

> Сейчас один общий текст «Заполни обязательные поля» + 0 проходит как валидная сумма — чиним на per-field + `amount>0`.

### 5.2 Budget — категория (AddCategoryDialog)
| code | Ур. | field | Условие | Сообщение |
|---|---|---|---|---|
| CAT_NAME_REQUIRED | E | name | пусто | Введите название |

### 5.3 Budget — курсы (FxRatesDialog)
| code | Ур. | field | Условие | Сообщение |
|---|---|---|---|---|
| FX_RATE_INVALID | E | rate[code] | введено, но не число / ≤0 | Курс должен быть числом больше 0 |
| FX_RATE_MISSING | W | rate[code] | нет авто-курса и нет override | Курс не найден — введи вручную |

> Сейчас невалидный курс **молча отбрасывается** (GAP) — делаем явной field-ошибкой.

### 5.4 Documents (DocsLens)
| code | Ур. | field | Условие | Сообщение |
|---|---|---|---|---|
| DOC_TITLE_REQUIRED | E | title | пусто | Введи название документа |
| DOC_FILE_TOO_LARGE | E | file | файл > 10 МБ | Файл слишком большой (макс. 10 МБ) |

### 5.5 Members (MembersLens)
| code | Ур. | field | Условие | Сообщение |
|---|---|---|---|---|
| INV_EMAIL_INVALID | E | email | нет «@» / не email | Введи корректный e-mail |
| INV_NAME_REQUIRED | E | name | offline-участник без имени | Введи имя |
| INV_BACKEND | E | — | ошибка edge (already member, not admin…) | текст из edge (через единый разбор `.context`) |

> Сейчас invite=inline, remove/resend=`alert` — приводим к одному показу. Бэк-тексты — через общий хелпер разбора edge-ошибки (он же фиксит баг Pro.jsx).

### 5.6 Chat (ChatLens)
| code | Ур. | Условие | Показ |
|---|---|---|---|
| CHAT_EMPTY | — | пусто/нет chatId | кнопка отправки disabled (без текста) |
| CHAT_SEND_FAILED | E | insert упал | **показать** ошибку (сейчас GAP: только console) — единый показ |

### 5.7 Share (ShareDialog)
| code | Ур. | Условие | Сообщение |
|---|---|---|---|
| SHARE_TOKEN_FAILED | E | ensureShareToken упал | Не удалось создать ссылку |

### 5.8 Pro / оплата
| code | Ур. | Условие | Сообщение |
|---|---|---|---|
| PRO_IFRAME | E | внутри iframe | Открой приложение в новой вкладке |
| PRO_ALREADY_ACTIVE | E | бэк-код SUBSCRIPTION_ALREADY_ACTIVE | У тебя уже есть активная подписка… |
| PRO_RECENT_PENDING | E | бэк-код RECENT_CHECKOUT_PENDING | Недавний платёж ещё обрабатывается… |
| PRO_CHECKOUT_FAILED | E | прочее | Ошибка: {message} |

> Разбор бэк-кодов — через общий хелпер `.context` (см. баг Pro.jsx в TODO).

---

## 6. Подтверждения (confirm) — единый `ConfirmDialog`

Это НЕ валидация, но к единому показу. Все destructive-действия → один `ConfirmDialog` (title + текст + опасная кнопка). Убрать нативные `window.confirm`.

| code | Действие | Где | Сейчас (механизм / текст) | Цель: ConfirmDialog (title → текст) |
|---|---|---|---|---|
| CONFIRM_DELETE_EVENT | Удалить отель/активность/переезд | EventEditDialog | инлайн-confirm внутри модалки · «Удалить {тип}?» | «Удалить {тип}?» → «{название}. Действие необратимо.» |
| CONFIRM_DELETE_EVENT_VIEW | Удалить из карточки просмотра | EventModal | инлайн-confirm · «Удалить {тип}?» | то же (общий компонент) |
| CONFIRM_DELETE_SERVICE | Удалить услугу (авто/esim) | ServiceDialog | ConfirmDialog · «Ты уверены?» / «Удалить?» | «Удалить услугу?» → «{название}. Действие необратимо.» |
| CONFIRM_DELETE_EXPENSE | Удалить трату | BudgetLens · AddExpenseDialog | **НЕТ подтверждения (GAP)** — кнопка сразу удаляет | «Удалить трату?» → «{описание} · {сумма}.» |
| CONFIRM_DELETE_CATEGORY | Удалить категорию бюджета | BudgetLens · AddCategoryDialog | проверить (вероятно нет) | «Удалить категорию?» → «Траты останутся без категории.» |
| CONFIRM_DELETE_DOCUMENT | Удалить документ | DocsLens | window.confirm · «Удалить документ «{name}»?» | «Удалить документ?» → ««{name}». Действие необратимо.» |
| CONFIRM_REMOVE_MEMBER | Убрать участника | MembersLens | window.confirm · «Убрать участника из путешествия?» | «Убрать участника?» → «{имя} потеряет доступ к путешествию.» |
| CONFIRM_LEAVE_TRIP | Выйти из трипа | SettingsLens | window.confirm · «Выйти из путешествия? Ты перестанешь видеть его.» | «Выйти из путешествия?» → «Ты потеряешь доступ. Вернуться можно только по новому приглашению.» |
| CONFIRM_DELETE_TRIP | Удалить трип | SettingsLens | **два** window.confirm подряд · «Удалить путешествие? Это действие необратимо.» → «Ты уверены? Все данные будут удалены.» | один «Удалить путешествие?» → «Все данные ({N} городов, брони, бюджет) удалятся навсегда.» (+ опц. type-to-confirm названия) |
| CONFIRM_DELETE_CITY | Удалить город (Edit Mode) | TripStructureEdit | кастомная модалка · «Все привязанные брони… будут удалены» | привести к общему ConfirmDialog · «Удалить город?» → «Отели, активности и переезды этого города тоже удалятся.» |
| CONFIRM_UNLINK_TELEGRAM | Отвязать Telegram | TelegramUnlinkDialog | своя модалка · текст-кнопка «Отвязать» | «Отвязать Telegram?» → «Бот перестанет присылать уведомления по этому путешествию.» |

> Тексты — предварительные, пойдут через `t()`. Кнопка подтверждения — единый danger-стиль.

### 6.1 `alert()` — это ОШИБКИ, не подтверждения → в слой ошибок (toast/inline), НЕ ConfirmDialog
Сейчас в проде через `alert()`: save-ошибки (TripStructureEdit, SettingsLens ×4, SourceViewLoader, MembersLens invite/remove), «файл слишком большой» (EventModal), «прошлый трип» (TripFormDialog). Все они уходят в единый слой ошибок: сетевые сбои → **toast**; валидация поля → **field-error**. Нативный `alert` убираем полностью.

---

## 7. Изменения ред.2 (твой фидбэк)

- `HOTEL_OVERLAP` — удалено.
- `TR_DEP_DAY` / `TR_ARR_DAY` — допуск **±1 день** (рейсы на стыке суток, напр. 00:20).
- `SEG_MIN` — текст: «выбран переезд с пересадкой — нужно 2 сегмента, можно без пересадок».
- `CITY_DATES_REQUIRED` / `CITY_ORDER` — **не применяются** к якорям start/finish.
- `CITY_OVERLAP` — наслоение в 1 день допустимо; > 1 дня → **error**.
- `CITY_GAP` — **warning** (не блок).
- `NO_TRANSFER` — убрано из валидации (фронт-аффорданс, отключаемый в настройках).
- `DUP_TRANSFER` — **warning**.
- `SVC_OUT_OF_TRIP` — добавлено как **warning**.

---

## 8. Что меняется относительно «сейчас»

- Soft-плашки `hotelWarnings/activityWarnings/transferWarnings` (B1/B2/C1/C2/D2) → **error** в общем движке, единый показ.
- `canSave` = «нет error» (конец ad-hoc проверкам).
- Новые жёсткие `*_REQUIRED` на даты/время → закрывают дыры пустых дат.
- Тихие GAP (чат, FX, сервис save/delete) → явные issue/ошибки.
- `tripWarnings` + осиротевшие хелперы + мёртвые `CategoryBlock`/`ExpenseRow` — удаляются.
- Все тексты через `t()` (RU/EN/ES).

---

## 9. Предложения — что ещё взять в этот рефакторинг

Естественно ложится в ту же работу (один слой ошибок/показа):

1. **Единый разбор edge-ошибок** — один хелпер `parseEdgeError(error, data)` (читает `error.context.json()` → `{code, message}`). Чинит баг `Pro.jsx` (коды never fire), убирает дубль `edgeErrorMessage` в MembersLens, даёт коды `PRO_*`/`INV_*` из §5. Маленький, высокоценный.
2. **`useSaveMutation` обёртка** — единый `onError → toast`, чтобы НИ ОДНО сохранение не падало молча. Закрывает GAP системно (сейчас тихо: ServiceDialog save/delete, отправка чата), а не точечно.
3. **Единый компонент загрузки файла** — одна константа лимита + один текст ошибки. Сейчас вразнобой: обложка 4 МБ, AI-распознавание 5 МБ, вложения/документы 10 МБ. Свести (или явно обосновать разные лимиты в UI).
4. **Согласовать маркер `*` с enforcement** — сейчас у отеля даты помечены `*`, но не required (дыра). После рефактора `*` = реально обязательное поле, везде консистентно.
5. **Фокус на первую ошибку + a11y** — при блокировке сохранения скроллить/фокусить первое error-поле; `aria-invalid` на полях, роль alert у `IssuesPanel`. Без этого «кнопка не жмётся, а почему — непонятно».
6. **i18n-проход заодно** — все сводимые/новые тексты через `t()`; EN-плашки (`hotelWarnings` и т.п.) и RU-хардкод уходят. Большой, но это та же правка тех же строк.
7. **Dirty-guard при закрытии модалки** — предупреждать о несохранённых изменениях (опц., но дёшево на едином хуке).
8. **Чистка (Ф5)** — заодно выпил мёртвых `CategoryBlock`/`ExpenseRow`, осиротевших `tripWarnings`/`transferGroupWarnings`/`isDateOnlyMissingTime`/`timeWithTz`.
9. **Type-to-confirm для удаления трипа** — вместо двойного `confirm` ввод названия трипа (это необратимо + удаляет всё). Опц.

Рекомендую обязательно взять **1, 2, 4, 5** (прямо часть единообразия) + **8** (без неё дубли вернутся). **3, 6, 7, 9** — по решению.

---

## 10. Интеграция с Edit Mode (`computeTripValidation` = слой L3)

Edit Mode уже работает на структурном движке `computeTripValidation` (коды A1–E3) → он становится `validateTrip` (слой L3, строится поверх `validateEntity`). Чтобы новая схема легла без регресса, держим 3 контракта (проверено по `TripStructureEdit.jsx`):

1. **Ссылки на сущности в Issue** (R1). Edit Mode завязан на `cityId/hotelId/activityId/transferId/fromId/toId`:
   - `transferMismatch(t) = issues.some(i => i.transferId === t.id)` → оранжевая подсветка строки перелёта в сетке;
   - `cityConflicts(id) = issues.filter(i => i.cityId === id).length` → бейдж-счётчик у города;
   - `openConflict(c)` → открывает модалку сущности по `hotelId/activityId/transferId` с `warning: c.message`.
   Поэтому в едином Issue сохраняем `entityId/fromId/toId` (см. §1), не только `field`.

2. **`primaryIssue()` — анти-куча для таймлайна** (R2). `validateEntity` отдаёт полный список (модалке нужны все field-ошибки). Для сетки/плашек Edit Mode — чистый reducer «один issue на сущность по приоритету `structure > entity > field`». Для перелётов воспроизводит текущую иерархию `D6 → D5 → D2` (и `openTransferRow` сохраняет гарантию «≤1»). Обобщаем на отели/активности (сейчас отель может дать B1+B2 двумя плашками — у них иерархии нет).

3. **Гейт = errors-only** (R3). Сейчас `blocked = issues.length > 0` (блок на любом issue, в т.ч. warning). По единому правилу: `blocked = issues.some(i => i.level === 'error')`. Тогда `CITY_GAP`/`DUP_TRANSFER` (warnings) показываются, но НЕ блокируют — консистентно с модалкой. **Это единственное поведенческое изменение Edit Mode** (требует явного подтверждения, т.к. меняет прежнее «любой issue блокирует»).

Сетка перелётов в таймлайне продолжает подсвечиваться `primaryIssue` по `transferId` — поведение «перелёт с ошибкой = оранжевый» сохраняется.

---

## 11. Ф0.5 — Рефактор локалей/ключей (ДО локализации валидации)

Локали (ru/en/es) синхронны: по **1703** ключа в каждой. Из них **110** относятся к ошибкам/варнингам/confirm. Прогон usage по живому коду (pages+components, без redesign) показал: **~52 ключа — ОРФАНЫ (0 использований нигде, в т.ч. в мокапах)**. Их нельзя локализовать «вслепую» — половина переименуется/выпилится.

### Рекомендуемая схема ключей (code-aligned)

Ключ = код Issue/confirm, без разнобоя по неймспейсам:
- ошибки/варнинги: `validation.<CODE>` → `t('validation.' + issue.code, issue.ctx)` (напр. `validation.HOTEL_CHECKIN_OOB`);
- подтверждения: `confirm.<CODE>.title` + `confirm.<CODE>.body`.

Плюс: `validateEntity` отдаёт `code`, UI резолвит автоматически → ключи 1:1 с кодами, дрейф невозможен, покрытие видно сразу.

### Три корзины

**A. ВЫПИЛИТЬ (орфаны, 0 использований; ×3 языка ≈ 156 строк).** Группы:
- *Ключи мёртвых компонентов* (удалённые dialog'и; живой код хардкодит): `hotel.name_required/checkin_required/checkout_required/date_order_error/delete_confirm/delete_prompt`, `activity.title_required/date_order_error/delete_prompt`, `transfer.date_order_error/delete_confirm`, `visit.order_error/overlap_error/delete_confirm`, `service.car_name_required/car_address_required/car_pickup_address_required/car_date_order_error`.
- *Старые, перекрытые новой локализацией*: `budget.title_required/amount_required/category_name_required` (живут `budget.err_required/err_cat_name`), `budget.category_delete_confirm_*`, `budget.fx_*`/`missing_fx_warning`, `doc.title_required/tab_delete_confirm`, `common.time_required`, `ai.*`, `ai_plan.error_save/no_draft_error`, `chat.ai_error`, `calendar.update_failed`, `trip.copy_*/delete_pro_*/export_pdf_error/addon_pro_locked_alert`.
- *Дубликаты неймспейсов*: `members.remove_confirm/leave_confirm/offline_name_required` (живут `member.remove_confirm/err_name`, `settings.leave_confirm`), `telegram.connect_error/disconnect_confirm_*` (живёт `settings.tg_link_error`/`telegram.unlink_confirm`), `settings.plan_portal_error/plan_portal_iframe_error/plan_error_prefix` (живут `sub.iframe_alert/upgrade_error`), `trip.delete_confirm/delete_trip_confirm`, `trip_edit.delete_visit_confirm`.

**B. ПЕРЕИСПОЛЬЗОВАТЬ (живые ключи → переименовать в `validation.*`/`confirm.*` при разводке `validateEntity`).** Тексты годные:
- create-flow: `planner.err_no_cities/err_no_date/err_no_title/err_unrecognized` → TRIP_NO_CITIES / TRIP_START_REQUIRED / TRIP_TITLE_REQUIRED / TRIP_CITY_UNRESOLVED; `trip.cover_too_large` → TRIP_COVER_TOO_LARGE; `trip.form_past_alert` → TRIP_PAST_READONLY.
- события: `event.pickup_addr_required` → SVC_PICKUP_ADDR_REQUIRED; `event.err_layover_city` → SEG_CITY_REQUIRED; `event.save_failed/delete_failed` → toast.
- бюджет/доки/участники/sub: `budget.err_required` (split → 3 кода), `doc.err_title`/`doc.load_error`, `member.err_email/err_name/err_remove/err_send_invite`, `members.error_generic`, `sub.iframe_alert/upgrade_error`.
- confirm: `member.remove_confirm`, `settings.leave_confirm`, `settings.delete_confirm1/2`, `service.delete_confirm`, `doc.delete_confirm`, `telegram.unlink_confirm`, `common.delete_confirm_title`, `budget.expense_delete_confirm_title/msg`.

**C. ДОБАВИТЬ (планируемый код без ключа — сейчас хардкод в живом коде).**
- field-ошибки `EventEditDialog` (хардкод RU): HOTEL_ORDER, HOTEL_CHECKIN_OOB/CHECKOUT_OOB, ACT_ORDER, TR_ORDER, SVC_ORDER, SEG_ORDER, SEG_BACKSTEP, + *_REQUIRED на даты/время (новые правила).
- структурные: CITY_OVERLAP, CITY_GAP, TR_DEP_DAY/ARR_DAY, DUP_TRANSFER (тексты в `validation.js` сейчас по-английски).
- split `budget.err_required` → EXP_TITLE_REQUIRED / EXP_AMOUNT_REQUIRED / EXP_CATEGORY_REQUIRED.
- confirm-bodies нового формата (title→body) для CONFIRM_DELETE_CITY, CONFIRM_UNLINK_TELEGRAM и т.д.

### Что делать с текущей локализацией ПРЯМО СЕЙЧАС

- **Не тратить силы** на перевод 110 валидационных/confirm-ключей: ~52 удалим, остальные переименуем в `validation.*`/`confirm.*`.
- **Продолжать** локализовать стабильные UI-лейблы (не-валидационные ключи).
- Валидацию/confirm локализуем как часть Ф0.5→Ф2: фиксируем неймспейс `validation.*`/`confirm.*`, выпиливаем корзину A, заводим B (перенос текста) + C (новые), и `validateEntity` резолвит по коду.

### Порядок (Ф0.5)
1. Зафиксировать неймспейс `validation.*` / `confirm.*` (1:1 с кодами Issue/confirm).
2. Удалить корзину A (≈52 ключа ×3) — заодно с мёртвым кодом (Ф5).
3. Свести дубли неймспейсов к каноническим (`member.*`, `settings.*`, `sub.*`).
4. B: перенести тексты живых ключей под новые имена; C: завести новые из хардкода.
5. Прогон: каждый код из §4/§5/§6 имеет ключ во всех 3 языках; ноль орфанов.

> Полная таблица «код → текущий ключ → действие» строится автоматически из usage-отчёта (скрипт в чате аудита). Источник кодов — §4–§6.
