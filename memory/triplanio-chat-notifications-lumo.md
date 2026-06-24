---
name: triplanio-chat-notifications-lumo
description: Lumo-редизайн экранов Чат и Уведомления (Входящие + поповер колокольчика) — макеты
metadata: 
  node_type: memory
  type: project
  originSessionId: 8b311266-6bc1-4ae1-a434-7e4f1a15faa1
---

★ Полный редизайн с нуля под Lumo экранов **Чат** и **Уведомления** (макеты, в код НЕ перенесено). 3 новых файла в «Triplanio design new»:
- `Notifications screen.html` — глоб. app-header + поповер колокольчика (открыт, origin top-right) + полный экран Входящие. Сохранено всё из NotificationsBell+Inbox: unread рельс+точка/счётчик, mark-all-read, иконка+цвет по типу, invite Принять/Отклонить→Принято/Отклонено, view-trip, группы дат (Сегодня/Вчера/Эта неделя/Ранее), фильтры Все/Непрочитанные·N/Приглашения·N, empty/loading/filter-empty (переключатель состояний в preview).
- `Chat screen.html` — в реальной trip-оболочке (сайдбар+thead+lensbar). Сохранено из ChatLens: онлайн-счётчик, разделители дат, пузыри me/участник/AI с группировкой, markdown+@-упоминания, попап @Triplanio (действует только ассистент), thinking-strip, композер Enter/Shift+Enter (живое демо: @triplanio→thinking→ответ), рейл участников + «что умеет ИИ». Мобайл: рейл→**bottom-sheet** участников.
- `LUMO ADDENDUM — Chat & Notifications.html` — канон новых компонентов (notif-row, sticky date-group, bell-popover, chat-bubbles, AI-аватар xs/sm/md, mention-popover, thinking-strip, presence-pill, bottom-sheet) + спек-таблицы. Ссылка на него добавлена в hero `LUMO DESIGN SYSTEM.html`.

Свет+тьма, 4 палитры, адаптив, prefers-reduced-motion, GPU-only анимации (Emil-craft). Все самодостаточны (только шрифты). JS прошёл node --check; живой браузер-рендер в песочнице невозможен (Chrome download заблокирован сетью).

ОТКРЫТО для Pavel: (1) в коде реально шлётся только 3 in-app типа (invite/member_joined/pro_activated); в макет добавлены forward-looking «голосование»+«обновление маршрута» (их предполагают notifMeta и empty-copy) — оставить/убрать? (2) реальные табы Inbox = all/unread/invites, хотя строки notif.votes/updates есть — при выпуске голосований/обновлений нужны табы. Связано: [[triplanio-overlay-pro-unification]], [[triplanio-inapp-chat-sync-idea]], [[triplanio-frontend-repo]].
