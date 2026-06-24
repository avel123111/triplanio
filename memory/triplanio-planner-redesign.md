---
name: triplanio-planner-redesign
description: "Редизайн manual+AI планнеров в единый create-flow (большая карта + колонка), решения Pavel по скоупу 2026-06-02"
metadata: 
  node_type: memory
  type: project
  originSessionId: 31679c36-2583-4aba-92b5-8485f27c3597
---

Редизайн manual + AI планнеров под «единый create-flow» (прототип загружен 2026-06-02: index.jsx=ScreenCreateFlow/ScreenCreateMethod, flow-map=FlowMap, flow-panels=PanelAi, flow-bookings=BookingsEntry, flow-progress=FlowProgress). Прототип — standalone (глобалы Icon/Btn/MPStep*, window.__navigate, SVG-карта, хардкод RU), в живом репо этих компонентов НЕТ — net-new.

Живое состояние: `pages/ManualPlanner.jsx` (5 шагов home→cities→return→transport→review, лейаут .planner-grid с маленькой Mapbox-картой-превью 320px сбоку, сохраняет city_visits+transfers через RPC create_trip). `pages/AiTripPlanner.jsx` (НЕ мастер, 50/50, состояния empty/generating/draft/saving, planTripWithAi edge→n8n отдаёт города+активности по дням, сохраняет city_visits+activities, всё на t()). Вход — модалка NewTripDialog в Trips.jsx, 2 кнопки (manual/ai). Роуты /new-trip, /plan-trip-ai.

РЕШЕНИЯ Pavel (2026-06-02):
1. Шаг «Транспорт» — УБРАТЬ из создания. transfers/transport_type при создании не пишем; переезды добавляются позже в таймлайне/Edit Mode.
2. AI-активности — СОХРАНИТЬ. AI по-прежнему генерит activities; в едином флоу их надо провести через ручное редактирование скелета и сохранить (отклонение от прототипа, где AI отдаёт только скелет). ⚠️ОТКРЫТО: что с activities при reorder/правке городов в скелете.
3. Прикрепление отелей/переездов на этапе создания (hotelApi/transferApi прототипа) — НЕ включать. Брони как сейчас — позже в TripView.
4. Bookings-вход — НЕ делать сейчас. Только 2 входа (manual, AI).

Итог скоупа: единый flow-shell (full-bleed sticky Mapbox + flow-edit колонка + FlowProgress топ-бар), новые CSS-классы, сменный entry (manual=home / ai=prompt-panel), сошедшиеся шаги skeleton→[return]→review (без transport).

РЕАЛИЗОВАНО 2026-06-02 (билд+lint зелёные, UX в браузере НЕ прогнан):
- `ManualPlanner.jsx` = единый CreateFlow(initialMethod='manual'|'ai'); обслуживает ОБА роута. `/new-trip`=manual, `/plan-trip-ai`=<ManualPlanner initialMethod="ai"/>. `AiTripPlanner.jsx` превращён в shim (можно git rm).
- Новые файлы: `src/pages/create/FlowProgress.jsx`, `FlowMap.jsx` (full-bleed Mapbox, badge+плашка), `PanelAi.jsx` (AI-промпт-панель, i18n ai_plan.*).
- AI: planMut→edge planTripWithAi (контракт sessionId/prompt/language → output.draft.cities[]+activities) перенесён из старого AiTripPlanner. applyAiDraft конвертит драфт в cities[] (резолв coords/tz через searchCities/getTimezone) + activitiesByCity[cityId]=[{title,dayOffset,start_time,end_time,location_address}]. Активности хранят dayOffset внутри стоянки; при save дата=addDays(city.startDate,dayOffset) → авто-пересчёт под даты города (luxon+tz). handleSave вставляет activities (currency 'EUR' обяз.), transfers НЕ создаёт.
- storageKey теперь per-method (triplanio-planner-{method}-{uid}) — драфты manual/ai не мешаются.
- Удалён мёртвый код manual: Stepper/PlannerMap/StepTransport/TRANSPORT_KINDS/computeLegs/transport-стейт.
- TODO/полировка: для AI home=null → в StepCities «Старт: не указан» и в Review home='—' (косметика); orphan-активности удалённого города игнорятся при save; ScreenAiPlanner/ScreenManualPlanner-мокапы не трогали; обновить Notion-доку create-flow.

ПРАВКИ 2026-06-02 (батч 2, билд зелёный):
- Карта в create-flow 50/50 (flow-shell 1fr 1fr); убран плейсхолдер пустой карты (всегда Mapbox, центр Европа); fitToPoints получил opts.animate → камера анимированно подлетает к маршруту при изменении. Анимация включена и в MapView (trip view/edit) — первый фит мгновенный, последующие плавные.
- AI-активности ОТМЕНЕНЫ полностью (реверс решения от 2026-06-02 батч1): фронт (applyAiDraft/handleSave/persist) активности не трогает; n8n-схема + системный промпт обновлены (Structured Output Parser убрал activities, AI Agent промпт без активностей) — ⚠️ВНИМАНИЕ: n8n меняется ВРУЧНУЮ в UI (MCP update_workflow регенерит весь workflow и теряет credentials Gemini/Postgres — небезопасно); Notion-доку обновил (AI Features → новый раздел «AI Trip Planner»).
- StepHome: дата старта предзаполняется defaultStartISO() = сегодня+1мес; «Дальше» заблокирован без даты.
- StepCities приведён к логике TripStructureEdit: единый верхний контролл даты старта (‹ дата ›), даты городов derived (read-only, city N = конец city N-1, всё от старта трипа; старт не двигается от правок городов), nights-степпер, gap-DnD с DropLine-индикатором (recompute после дропа), гейт «Дальше» если город не из справочника (latitude==null → красная рамка).
- Review: убран стат «Бюджет — Можно указать позже».
- AiTripPlanner.jsx — shim (rm заблокирован sandbox EPERM, нужен git rm). Мокапы pages/redesign/* не трогал (используются /ui DesignPreview).

ДРЕЙФ + ПРАВКИ n8n 2026-06-12 (AI Trip Planner воркфлоу `U9nM2nTiIkYk6g9O`, n8n MCP):
- ⚠️ДРЕЙФ: правка 06-02 «убрать activities из n8n» в реальности НЕ применена — живой workflow на 2026-06-12 ВСЁ ЕЩЁ содержит activities и в системном промпте AI Agent, и в Structured Output Parser schema. Фронт (applyAiDraft) их игнорирует → мёртвый payload. Удаление безопасно (нет потребителя).
- Pavel заказал 3 правки: (1) активности удалить из промпта И схемы полностью + явный запрет «не планируй и не предлагай»; (2) дефолт пребывания 2–4 дня на город (меньше малые / больше крупные), если юзер явно не задал длительность/темп/число городов; (3) гео-порядок — логичная последовательность, город между двумя ставить между ними (2-1-3 а не 1-2-3).
- Модель: решено поднять AI Agent с `models/gemini-3.1-flash-lite` → `models/gemini-3.1-flash` (гео-рассуждение на lite слабое); output-parser остаётся lite. `pro` в запасе.
- Validate Draft (code-нода) НЕ трогаем: ветки с activities станут безвредными no-op.
- Применять ВРУЧНУЮ в n8n UI (3 поля): AI Agent systemMessage, Google Gemini Chat Model modelName, Structured Output Parser inputSchema. MCP update_workflow = полная регенерация workflow → риск потери привязок кредов (Triplanio key/Postgres account/JWT Auth account), хотя по типу они однозначны. Готовые тексты — в сессии 2026-06-12.

Связано: [[triplanio-edit-mode]] [[triplanio-frontend-repo]] [[triplanio-code-analysis-rule]] [[triplanio-ai-booking-parse]] [[triplanio-deploy-topology]] [[triplanio-migration-naming-drift]]
