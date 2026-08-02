# Triplanio: визуальная проверка UI-правок через Playwright (без логина)

★2026-08-02, TRIP-282. Отговорка «скриншот сделать не могу, роут под логином»
НЕВЕРНА и запрещена. Геометрия и стили - это чистый CSS, авторизация для их
проверки не нужна.

**Рабочий способ (проверен):**

1. `cp src/design/app.css /tmp/vis/app.css` + `/tmp/vis/index.html` с
   `<link rel="stylesheet" href="./app.css">`, `<html data-theme="light">`
   (тёмная - `data-theme="dark"`) и **дословной разметкой** правленого куска
   (те же классы и инлайны, что в JSX).
2. Поднять статику: `node -e '…http.createServer…'` на свободном порту.
   **`file://` в Playwright заблокирован** - только HTTP.
3. `mcp__playwright__browser_navigate` → `browser_resize` →
   `browser_take_screenshot` (`fullPage: true`). Файл падает в **корень
   рабочей директории** (`<worktree>/имя.png`) плюс каталог `.playwright-mcp/`
   - и то и другое надо унести в `/tmp` и удалить, иначе попадёт в git.
4. Картинку в тред - `mcp__cyrus-tools__linear_upload_file`
   (`makePublic: true` для изображений).

**Мерить, а не только смотреть.** `browser_evaluate` с `getComputedStyle` +
`getBoundingClientRect` даёт цифры, по которым видно расхождение, незаметное
глазом. Приём «а как было?»: найти своё правило в `document.styleSheets`,
погасить (`rule.style.padding = ''`) и померить снова - получаешь до/после в
одном прогоне без отката кода.

**Грабли окружения:** `pthread_create: Resource temporarily unavailable` при
старте Chromium = машина забита процессами. Обычно это МОИ зомби-прогоны
`node --test` (глоб `src/**/*.test.js` порождает воркер на файл, а параллельные
запуски выбивают друг друга в SIGABRT и выглядят как «тесты упали», хотя ни
одного проваленного ассерта нет). Лечится: прибить свои процессы и гонять тесты
одним прогоном с `--test-concurrency=1` (флага `--concurrency` у Node 20 НЕТ).

Зачем: ось (a) в DoD - визуал, и это единственная ось без машинного гейта;
lint/typecheck/build/тесты ничего не рисуют. См.
[[feedback-look-at-the-whole-section-after-editing]].
