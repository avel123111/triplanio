#!/bin/sh
# Обёртка запуска Playwright MCP для агента (Cyrus).
#
# Зачем она нужна. Бинарники браузеров лежат на персистентном томе
# ($PLAYWRIGHT_BROWSERS_PATH) и передеплой переживают, а системные библиотеки
# хромиума (glib, nss, cups, ...) - это apt-пакеты на оверлее контейнера, и они
# стираются вместе с ним. Симптом на свежем контейнере:
#   chrome: error while loading shared libraries: libglib-2.0.so.0
# Поэтому один раз на контейнер доставляем и браузер, и его зависимости.
#
# Проверка - наличие одной библиотеки-часового: на живом контейнере это
# мгновенный тест файла, apt дёргается только на свежем.
set -e

MCP_VERSION=0.0.78
SENTINEL_LIB=/usr/lib/x86_64-linux-gnu/libglib-2.0.so.0
AUTH_STATE="${PLAYWRIGHT_AUTH_STATE:-/data/.cyrus-playwright-auth.json}"
AUTH_SCRIPT="$PWD/scripts/agent/playwright-auth.mjs"

export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/data/.cache/ms-playwright}"

if [ ! -f "$SENTINEL_LIB" ]; then
  echo "playwright-mcp: системных библиотек хромиума нет, доставляю" >&2
  npx -y "@playwright/mcp@$MCP_VERSION" install-browser --with-deps chrome-for-testing >&2
fi

# Состояние сессии: кука обхода Vercel Deployment Protection + залогиненный
# тестовый пользователь dev. Протухает вместе с refresh-токеном Supabase, поэтому
# пересоздаём сами - если файла нет или он старше недели, а креды есть в окружении.
# Пароль живёт ТОЛЬКО в окружении: memory/ лежит в гите, туда секреты нельзя.
if [ -n "$VERCEL_BYPASS_SECRET" ] && [ -n "$PW_TEST_EMAIL" ] && [ -n "$PW_TEST_PASSWORD" ] &&
   { [ ! -f "$AUTH_STATE" ] || [ -n "$(find "$AUTH_STATE" -mtime +7 2>/dev/null)" ]; }; then
  echo "playwright-mcp: обновляю сессию dev" >&2
  # NODE_PATH берём из дерева, которое npx только что развернул: playwright-core
  # оттуда гарантированно той же версии, что и браузер, ожидаемый сервером.
  npx -y -p "@playwright/mcp@$MCP_VERSION" sh -c \
    'NODE_PATH=$(echo "$PATH" | cut -d: -f1 | sed "s#/\.bin\$##") node "$0"' \
    "$AUTH_SCRIPT" >&2 || echo "playwright-mcp: обновить сессию не вышло, работаю с тем, что есть" >&2
fi

if [ -f "$AUTH_STATE" ]; then
  set -- --storage-state "$AUTH_STATE"
else
  echo "playwright-mcp: $AUTH_STATE отсутствует, стартую без сессии" >&2
  set --
fi

# Артефакты (снимки, логи консоли) - в одну папку внутри воркгри, она в .gitignore.
# Важно: на скриншоты это НЕ распространяется - относительный filename сервер
# считает от корня воркспейса, а не от --output-dir и не от рабочей папки. Поэтому
# имя скриншота задавать как `.playwright-mcp/<имя>.png`; на случай, если забыли,
# в .gitignore стоит сетка на картинки в корне.
ARTIFACTS="$PWD/.playwright-mcp"
mkdir -p "$ARTIFACTS"

exec npx -y "@playwright/mcp@$MCP_VERSION" \
  --headless --isolated --browser chromium \
  --output-dir "$ARTIFACTS" "$@"
