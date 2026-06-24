---
name: triplanio-chat-caret-drift
description: РЕШЕНО — почему в чат-композере каретка уезжала вперёд текста на узкой ширине (overlay/textarea рассинхрон по font-size из-за iOS-zoom правила)
metadata: 
  node_type: memory
  type: project
  originSessionId: fcecf8eb-0d12-4f8b-aae2-2d267cad4dfd
---

Баг: в чат-композере (ChatLens.jsx + ChatWidget.jsx, общие классы `.chat-ov`/`.chat-ta`, `highlightMentions`) каретка уходила далеко вперёд от видимого текста — **только на узкой ширине (≤640px), с тегом и без**.

Архитектура композера: видимый оверлей `<div class="chat-ov">` (рендерит @triplanio болдом) лежит ПОД прозрачным `<textarea class="textarea chat-ta">` (источник каретки). Их glyph-advance ОБЯЗАНЫ совпадать, иначе каретка дрейфует.

**Истинная причина** (app.css): глобальное правило против iOS zoom-on-focus
`@media (max-width:640px){ .input,.select,.textarea{ font-size:16px } }`
поднимает textarea до 16px на узкой ширине, а `.chat-ov` — это `<div>`, под `.textarea` не попадает → остаётся 14px. 16 vs 14 = текст в textarea на ~14% шире → каретка вперёд. Замерено: "@triplanio выаыва" = 135.2px@16 vs 118.3px@14, зазор 16.9px.

**Фикс:** `@media (max-width:640px){ .chat-ov,.chat-ta{ font-size:16px } }` — оба слоя 16px на мобиле (textarea оставлен 16px чтобы не вернуть iOS-зум). Деплой dev+main.

Тупиковые гипотезы (отвергнуты замером в браузере, НЕ повторять):
- font-weight 500 vs 400 — у Nunito advance на 400 и 500 ИДЕНТИЧНЫ, вес на ширину не влияет.
- `-webkit-text-stroke` мента — на advance не влияет (так и задумано).
- iOS системный шрифт fallback — Pavel тестирует НЕ на телефоне, а узкой шириной в десктоп-браузере, так что это не про реальный iOS.

Урок: «мобильный» баг тут = media-query по ширине, а не iOS-рендер. Сначала искать @media-правила, бьющие по одному из двух слоёв оверлей/textarea.
