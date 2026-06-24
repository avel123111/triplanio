---
name: triplanio-login-css-token-leak
description: Баг тёмной темы — login.css глобальный :root перекрывал --ink на всех роутах; ИСПРАВЛЕНО (scoped to .auth)
metadata: 
  node_type: memory
  type: project
  originSessionId: bba198cd-d0b1-4a1f-a89f-4a8a6d2ede4b
---

**Симптом (2026-06-06):** в ТЁМНОЙ теме после входа заголовки диалогов (h2 `AlertDialogTitle`) и текст `Btn variant="ghost"` — тёмно-синие (#0F172A) на тёмном фоне = нечитаемы. Tailwind `text-foreground` элементы (напр. `AlertDialogCancel` outline) при этом норм.

**Причина:** `src/pages/login.css` объявлял ПОЛНЫЙ дубль токенов на ГЛОБАЛЬНОМ `:root` (`--ink:#0F172A`, `--surface:#fff`, `--brand`, `--muted`, `--line`… — фиксированные светлые, НЕ theme-aware). Vite инжектит этот `<style>` при mount `Login.jsx` (`import './login.css'`) и НЕ удаляет при unmount → после входа login.css `:root{--ink:#0F172A}` перекрывает theme-aware `--ink: hsl(var(--foreground))` из app.css на ВСЕХ роутах до перезагрузки. В light это незаметно, в dark — весь `color: var(--ink)` текст тёмно-синий. Дискриминатор: страдают только элементы с app.css `color: var(--ink)`; Tailwind `text-foreground` (index.css) — ок.

**Фикс:** в login.css `:root {` → `.auth {` (логин-страница = `<main className="auth">`, light-only, все её элементы внутри .auth → наследуют). Токены больше не текут глобально. Гард PASSED, postcss OK. Связано: [[triplanio-style-token-audit]] [[triplanio-lumo-gap]] (там login.css давно помечен как «ДУБЛЬ цвет-токенов»).

**Урок:** page-scoped CSS, импортируемый через JS, инжектится глобально и не снимается — НЕЛЬЗЯ класть в него глобальный `:root` с токенами. Всегда скоупить на контейнер страницы. Проверка: `grep -rln ":root" src --include=*.css` вне index.css/app.css должен быть пуст.
