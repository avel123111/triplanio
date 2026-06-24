---
name: triplanio-trip-settings-display
description: "Trip settings — display bag (booking_warnings, chat_widget), addon-gated sections, safeStorageName upload convention"
metadata: 
  node_type: memory
  type: project
  originSessionId: 71f48150-f34f-405f-b915-c43f152841ea
---

SettingsLens (`lens=settings`) + связанные правки (2026-05-31, dev):

- `trip.details.display` — расширяемый bag булевых флагов уровня трипа, пишется через edge `updateTripSettings` (shallow-merge). Все флаги default ON при отсутствии ключа (`!== false`). Флаги: `booking_warnings`, `chat_widget`.
- Виджет группового чата показывается только если: аддон `chat` включён (`isLensVisible`) И `display.chat_widget !== false` И линза не `chat`. Аддон важнее флага. Полная линза «Групповой чат» доступна всегда. Гейт в TripView у монтирования `<ChatWidget>`.
- Карточка «Виджет чата» в настройках рендерится только при включённом аддоне `chat`. Карточка «Telegram-мост» — только при `telegram_assistant`.
- `safeStorageName(name)` в `src/lib/storage.js` — единый санитайзер ключей Supabase Storage (кириллица/пробелы → `Invalid key`). Применён во ВСЕХ точках загрузки: EventModal, DocumentsField, DocsLens, EventAiBlock, TripCoverPicker. Раньше дублировалось и расходилось → баг возвращался. `file_name` (отображение) хранит оригинал, санитизируется только `storage_path`.
- Док в Notion: «Настройки трипа — аддоны, отображение, вложения» (id 3712c9f1-427e-8158-83c2-cce18d59a344) под корнем Triplanio.

★РЕДИЗАЙН экрана (2026-06-07, dev): контейнер `.settings-lens` (max-width 1040, центр) вместо левой 720-колонки (пустая правая половина). Структура: (1) карточка «Основное» = ИДЕНТИЧНОСТЬ трипа на всю ширину — сетка `.settings-identity` (обложка `TripCoverPicker` слева | название+описание+валюта+заметки справа), кнопка **Сохранить** в шапке карточки (слот `action` у `Card`), disabled пока `!dirty`; (2) `.settings-grid` 2-кол→1 (≤900px): «Доп.функции» | «Виджет чата»/«Telegram»/«Предупреждения»; (3) «Опасная зона» на всю ширину. `saveSettings` теперь шлёт title+description+notes+cover_image_url+cover_gradient (whitelisted в updateTripSettings) + main_currency; оптимистичный патч shell-кэша → шапка обновляет название/обложку мгновенно. КОНСОЛИДАЦИЯ: модалка `TripFormDialog` (пункт «Изменить данные» в «…») УПРАЗДНЕНА, файл TripFormDialog.jsx = dead code (не смог удалить из sandbox — нужен `git rm`). Тогглы по-прежнему автосейв; Сохранить — только для ручных полей идентичности.
- ★ФОН всех экранов → нейтральный `#fcfcfc` (было лавандовое `#FAFAFF`): токены `--bg` (app.css) + `--background: 0 0% 99%` (index.css) + `.auth` (login.css); тёмная тема не тронута. `.card` получил `box-shadow: var(--shadow-soft)` чтобы белые карточки читались на нейтральном фоне.

Связано: [[triplanio-pro-model]] (аддоны/Pro), [[triplanio-i18n-no-hardcode]] (SettingsLens захардкожен RU — новые строки тоже RU, долг).
