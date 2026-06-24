---
name: triplanio-auth-isloadingauth-remount-trap
description: "AuthenticatedApp гейтит всё дерево под isLoadingAuth → любой checkUserAuth/loadUserProfile, флипающий флаг, ремаунтит всё приложение; фоновые рефреши держать silent"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6a8dad4c-e874-4d37-b6a8-ec59b45daf36
---

★ИСПРАВЛЕНО 2026-06-22 (FE-only, src/lib/AuthContext.jsx; lint+65 тестов+build зелёные; git dev+main ждут push владельцем).

**Капкан:** `AuthenticatedApp` (App.jsx:78) гейтит ВЕСЬ авторизованный поддерев под `isLoadingAuth` (`if (isLoadingAuth) return <spinner>`). `loadUserProfile` всегда делал `setIsLoadingAuth(true)`, поэтому ЛЮБОЙ `checkUserAuth()` (фоновый рефреш профиля/энтайтлмента) размонтировал+ремаунтил всё приложение — визуально «полная перезагрузка».

**Баг, который это вызвало:** глобальный `StripeReturnModals` (введён в T4, коммит 20b7489) после пуллинга звал `checkUserAuth()` → флэш `isLoadingAuth` → размонтаж → ремаунт стирал run-once guard `handledRef` (он component-local) → `stripe_status` ещё в URL (stripParams отложен) → эффект перезапускался → снова checkUserAuth → бесконечный цикл. Подписка: ~1 c (виден пуллинг, модалка успеха мигает). Pro-трип: несколько раз/сек без задержки, модалка не успевала прокраситься.

**Фикс:** `loadUserProfile(authUser, { silent })` + `checkUserAuth` зовёт с `silent:true` — обновляет `user`/`isAuthenticated` БЕЗ переключения `isLoadingAuth`; в silent-ошибке auth-состояние не трогается (reconcile-on-read покрывает). Сигнатура `checkUserAuth()` не изменилась. Бонус: убран флэш всего app при сохранении профиля/смене аватара в ScreenAccount (3 вызова checkUserAuth).

**Правило на будущее:** любой новый фоновый рефреш через checkUserAuth/loadUserProfile должен быть silent. НЕ флипать isLoadingAuth вне первичной загрузки/логина/логаута, иначе вернётся ремаунт всего дерева. Отложенная очистка stripe_status из URL — намеренная (кнопка апгрейда в Account читает флаг, анти-double-pay), не трогать. Связано: [[triplanio-payments-phase-status]].
