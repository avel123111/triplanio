---
name: triplanio-pro-jsx-error-code-bug
description: "TODO-баг: Pro.jsx читает код ошибки checkout из неверного места (.response.data.code), у supabase-js он в .context"
metadata: 
  node_type: memory
  type: project
  originSessionId: 04367216-99ed-48e2-b1f8-40b4becc1de4
---

**✅ ИСПРАВЛЕНО (Ф3c).** Создан `src/lib/edgeError.js` (`parseEdgeError`/`edgeErrorMessage`, читает `error.context.json()` → `{code, message}`); `Pro.jsx` теперь берёт `code` через него → ветки already_active/recent_pending работают. `MembersLens` переключён на тот же хелпер. Историческое описание ниже.

---

**БАГ (был).** В `src/pages/Pro.jsx` (handleUpgrade, ~стр. 72) код ошибки checkout читается как `error?.response?.data?.code`. Но у supabase-js (`functions.invoke`) ошибка — это `FunctionsHttpError`, и реальный payload лежит в `error.context` (нужно `await error.context.json()`), как уже сделано в `MembersLens.edgeErrorMessage`. 

Следствие: ветки `SUBSCRIPTION_ALREADY_ACTIVE` и `RECENT_CHECKOUT_PENDING` (стр. 73, 82) скорее всего НИКОГДА не срабатывают → пользователь всегда получает общий `t('sub.upgrade_error')` = «Ошибка: {message}», а не корректные «уже активна подписка»/«платёж обрабатывается». Фоллбэк в billing portal при уже-активной подписке тоже не отрабатывает.

**Why:** ломает UX оплаты Pro (важная зона — платежи/Stripe). Бэк (`createStripeCheckout`) возвращает коды 409 правильно, но фронт их не видит.

**How to apply:** вынести разбор edge-ошибки в общий хелпер (как `edgeErrorMessage`), читать `error.context` (json) → `code`/`error`; переиспользовать и в Pro.jsx, и в UpgradePlan-потоке. Связано с [[triplanio-stripe-integration]].
