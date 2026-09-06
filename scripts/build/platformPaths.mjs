// Пути, которые на проде отдаёт ПЛАТФОРМА, а не каталог сборки (TRIP-520).
//
// Отдельным модулем от `prerenderPaths.mjs` НАМЕРЕННО: тот импортирует
// `middleware.js`, исполняемый на краю, где модулей Node нет, — а здесь нужен
// `node:fs`, чтобы прочитать конфиг. Пока это лежало вместе, выкладка падала
// уже после успешной сборки.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { SHELL_FILE } from './prerenderPaths.mjs';

/**
 * Пути, которые на проде отдаёт ПЛАТФОРМА, а не каталог сборки.
 *
 * Источник — `vercel.json`: всякое переписывание, ведущее НЕ в оболочку SPA,
 * уводит запрос наружу (аналитика, прокси-функция). Плюс `/_vercel/` — его
 * платформа обслуживает сама, в конфиге его нет.
 *
 * Из шаблона источника берётся литеральный префикс до первого параметра:
 * `/ingest/static/:path(.*)` → `/ingest/static/`. Этого достаточно — нам нужно
 * лишь понять, наш ли это файл.
 *
 * @returns {string[]}
 */
export function platformServedPrefixes() {
  const config = JSON.parse(readFileSync(fileURLToPath(new URL('../../vercel.json', import.meta.url)), 'utf8'));
  const fromConfig = (config.rewrites || [])
    .filter((rule) => rule.destination !== `/${SHELL_FILE}`)
    .map((rule) => rule.source.split('/:')[0])
    .filter((prefix) => prefix && prefix !== '/')
    .map((prefix) => `${prefix}/`);
  return [...new Set([...fromConfig, '/_vercel/'])];
}
