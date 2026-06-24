---
name: triplanio-es-titlecase-debt
description: "TODO: испанские локали повсеместно в Title Case — нужна полировка в sentence case (отдельно от RU-глоссария)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 872e6ab0-c317-4bdc-a9d0-6f3dd407b467
---

**TODO (отложено, отдельная задача от RU-локализации):** Испанские локали (`src/lib/i18n/locales/es/*.js`) повсеместно написаны в **Title Case**, что неправильно для испанского — он требует **sentence case** (заглавная только у первого слова и имён собственных).

Примеры из `es/ai_plan.js`: `Planificador de Viajes con IA`, `Guardar Viaje`, `Empezar de Nuevo`, `Ciudades y Fechas`, `Error al Planificar`, `Viaje Generado por IA`, `Planificar Viaje`. Аналогичная проблема, вероятно, в `es/account.js`, `es/settings.js` и других секциях, созданных пакетно.

**Почему отдельно:** это НЕ часть RU-глоссария (ты-тон/путешествие) — это орфографическая норма ES. Чинить точечно в одной секции бессмысленно (будет вперемешку с остальными). Нужен один проход по всем `es/*.js`: привести к sentence case, не трогая имена собственные (Triplanio, Pro, Telegram, Stripe, города/страны) и аббревиатуры (IA, PDF, FX).

**НЕ переведено машинно/слепо** — нужна аккуратная вычитка, т.к. автоматический lower() сломает имена собственные. Рекомендуется: extract все es-значения → ревью носителем/правило с белым списком проперов → apply.

Связано с [[triplanio-localization]] (основная инициатива). RU-глоссарий и серверная локализация — закрыты; это последний крупный остаток качества локали.
