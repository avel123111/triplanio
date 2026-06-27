---
name: triplanio-button-loading-primitives
description: Канон лоудеров на кнопках/тогглах/диалогах (TRIP-130) — реюзать <Btn loading>, <Toggle busy>, async-confirm
metadata:
  type: project
---

★РЕАЛИЗОВАНО на ветке TRIP-130 (PR в dev), 2026-06-27. Появился единый канон
«операция в полёте» — реюзать ЕГО, не плодить ручные идиомы (раньше было 5
кустарных спиннеров + подмена текста).

**Примитивы (в `src/design/index.jsx`):**
- `<Btn loading>` — рендерит канонический спиннер дизайн-системы вместо левой
  иконки, ставит `disabled` + `aria-busy`. CSS: `.btn .spin` в `src/design/app.css`
  (16px, `currentColor`, keyframe `aispin` — взято 1:1 из вложенного
  `LUMO DESIGN SYSTEM.html`, секция B1). До TRIP-130 проп `loading` в `Btn`
  ВООБЩЕ не существовал → места с `loading={saving}` молча его игнорировали.
- `<Toggle busy>` — спиннер в кнопке-ползунке, блок интеракции; тогглы теперь
  НЕ оптимистичны (флипаются только после ответа сервера) — оптимизм на гейтящих
  флагах вводил в заблуждение (решение Pavel).
- **async-confirm**: `confirm({ title, variant, onConfirm: async () => {…} })`
  (`ConfirmProvider`/`ConfirmDialog`). Кнопка подтверждения крутит спиннер, диалог
  держится открытым до резолва, Esc/overlay/cancel залочены. Применять, когда
  подтверждённое действие зовёт небыструю edge-функцию (удаление/выход и т.п.).
  Без `onConfirm` поведение старое (резолв true/false).

**Где провязано:** копирование трипа (блокирующий оверлей-прогресс в
`CreateTripProvider`, т.к. меню/диалога к моменту `await` нет), удаление/выход
из трипа (async-confirm в `SettingsLens`+`MembersLens`), удаление участника
(async-confirm), display-тогглы + фичи + Telegram-активность/disconnect
(non-optimistic + busy), профиль/удаление аккаунта/биллинг-портал/инвайты/смена
роли (через `<Btn loading>`). resend инвайта — row-busy (`mbrow--busy`), т.к.
пункт ActionMenu спиннер хостить не может (Radix закрывает меню на select).

**Граница:** ActionMenu-пункт НЕ умеет показывать загрузку — для действий из «…»
лоудер идёт в confirm-диалоге (если есть confirm) или в busy-строке.
