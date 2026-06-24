---
name: triplanio-pro-audit
description: "Предрелизный аудит платного функционала Triplanio — уязвимости enforcement, расхождения миграции и визуала Pro"
metadata: 
  node_type: memory
  type: project
  originSessionId: b3f57dcb-0e3d-4ac9-971d-65614dc54ab6
---

# Triplanio: аудит Pro-функционала (2026-05-29)

Полный отчёт: `triplanio_new/PRO_AUDIT_2026-05-29.md`. Все ключевые выводы проверены по коду.

## Главный вывод
Платёжная цепочка корректна и идемпотентна. Но **ценность Pro почти не защищена на сервере** — гейтинг в UI, обходится прямым вызовом edge-функций/RPC. Большинство дыр — наследие base44 (не регрессии).

## Уязвимости (приоритет до платного запуска)
- **V1 🔴 `getTripDetails` (verify_jwt=false)**: проверка доступа под `if(user)`, без заголовка Authorization → полный трип (бюджет/доки/участники) по tripId анониму. Утечка данных, не про Pro. Чинить: verify_jwt=true или 401 при !user.
- **V2 🟠 `planTripWithAi`**: только auth, без Pro/лимита/rate-limit → безлимитный ИИ-планировщик бесплатно.
- **V3 🟠 лимит «1 активный трип» только на клиенте**: `create_trip` RPC (migrations/0008) без проверки → обход прямым вызовом.
- **V4 🟠 `callTriplanioAi`**: auth+членство, без Pro/addon `chat`.
- **V5 🟡 `getTripDetails`** отдаёт budget/docs любому участнику — «замки» линз косметические.
- **V6 🟠 вебхук не обрабатывает `charge.refunded`/dispute** → после возврата `pro_trip` остаётся is_pro_trip=true навсегда.
- **V7 🟡** `isProActive` (клиент, subscription.js) считает null end_date активным; сервер `getUserPlan` — нет.
- **V8 🟡 регрессия**: `TripView` использует `isProActive(user)` (только смотрящий) вместо owner-aware `checkSubscriptionStatus({tripId})` как в base44.

## Модель Pro — УТОЧНЁННЫЕ ПРАВИЛА (решение Pavel 2026-05-29, эталон)
1. Трип «про» ⇔ у ВЛАДЕЛЬЦА активная подписка ИЛИ `is_pro_trip=true` → Pro-фичи всем активным участникам.
2. Только владелец поднимает трип до Pro. Участникам апгрейд НЕ предлагаем.
3. Личная подписка участника НЕ открывает чужой трип. Free-трип = у участника нет Pro даже со своей подпиской.
Единственный корректный предикат — `checkSubscriptionStatus({tripId})` (owner-aware, возвращает isPro+isOwner). Весь in-trip гейтинг вести от него, НЕ от `isProActive(user)`.
PRO_ONLY_ADDONS={budget,telegram_assistant,chat}; calendar/ai/docs/hotels_selection НЕ Pro.

## Критический класс: участника ведут к кассе и ничего не дают (P1–P4)
Не-владелец на free-трипе видит «Перейти к Pro» в: P1 сайдбар «Апгрейд трипа» (TripView.jsx:357, showUpgrade не проверяет роль), P2 SettingsLens тоггл→ProLockedDialog (settings виден всем, нет гейта роли), P3 EventAiBlock locked CTA (EventEditDialog:442), P4 Pro.jsx с tripId. Итог: pro_trip→403 (сервер) или подписка куплена, но трип не открыт. Деньги списаны, объяснения нет.
Решение: единая инфо-модалка для участников («Pro подключает владелец, обратитесь к нему»), owner-aware гейтинг (tripIsPro+isOwner из checkSubscriptionStatus), Pro-тогглы только владельцу.

## Несоответствие замков (SettingsLens.FEATURES) реальным аддонам
calendar pro:true (НЕВЕРНО), ai pro:true (аддона ai нет), docs locked «Скоро» (НЕВЕРНО — работает). budget/chat/telegram — верно. Привести FEATURES к PRO_ONLY_ADDONS.

## Прочее (base44 как эталон)
- Бюджет-виджет в таймлайне: base44 — всегда показан, клик при выкл. аддоне → модалка «включите аддон»; в новом нет.
- Прошлые трипы: base44 — правка только pro-трип/владелец-с-подпиской (pastLocked); в новом ограничения НЕТ (только роль). Добавить.

## Визуал/чистота
- V9: мёртвый/мок Pro-UI в репо (`ScreenPro.jsx` хардкод-цены, `Settings.jsx`, `UserMenu` isPro=false) — не зароучены, удалить.
- V10: две модалки успеха (`WelcomeToProDialog` в Layout + `PaymentSuccessDialog` в TripView) могут показаться вместе.
- Цвет Pro-бейджа рассинхронизирован (orange ProBadge vs warm pill vs amber chip) — и в base44 тоже.
- ⚠️ Проверить: есть ли в новом блок редактирования прошлых трипов (в base44 pastLocked был).
