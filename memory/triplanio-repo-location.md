---
name: triplanio-repo-location
description: "ВАЖНО — локальная папка triplanio_new = source-of-truth клон GitHub (НЕ устаревший), корректировка инструкции проекта"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 872e6ab0-c317-4bdc-a9d0-6f3dd407b467
---

Инструкция проекта говорит «игнорировать triplanio_new как устаревший». Это **устарело**. Проверено 2026-05-31:
- Локальная папка `triplanio_new` имеет git remote = `github.com/avel123111/triplanio.git`, ветка main, коммиты сегодняшние. Это и есть source-of-truth репо нового приложения (Vercel/Supabase/Stripe).
- `triplanio_base44` — старое приложение base44.
- `Triplanio App 2` — статический прототип нового дизайна (HTML/CSS/JS: Auth.html, Triplanio Prototype.html, app.css), НЕ React-приложение.

Заметка про игнор относилась к старой одноимённой папке. Для анализа/кода нового приложения работать в `triplanio_new`.
