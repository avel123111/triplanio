// Где в сборке лежит файл испечённого адреса (TRIP-520).
//
// Отдельным модулем от самой выпечки НАМЕРЕННО: ответ на вопрос «какие
// документы получились» нужен и чистке комментариев в `vite.config.js`, и
// гарду, и самой выпечке. Живи он внутри `prerender.mjs`, каждый читатель тащил
// бы за собой playwright — то есть браузер грузился бы там, где нужен список
// строк. Зависимость здесь одна и чистая: перечень адресов.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { prerenderedUrls } from '../../src/lib/routePaths.js';

/**
 * Оболочка SPA — тот же документ, но БЕЗ содержимого: её отдают все адреса,
 * кроме испечённых (фолбэк в `vercel.json`). `index.html` занимает лендинг,
 * потому что именно он обязан приехать по `/`.
 */
export const SHELL_FILE = 'app.html';

/**
 * Файл адреса внутри каталога сборки.
 *
 * Каталог + `index.html`, а не `<имя>.html`, и это несущее: так `/es` и `/es/`
 * оказываются ОДНИМ адресом. С плоским именем второй из них не нашёл бы файла и
 * ушёл бы в SPA-фолбэк — то есть ровно та ссылка, которую набирают руками,
 * молча теряла бы всю выпечку.
 *
 * @param {string} url адрес страницы (`/`, `/es`, `/ru/d/…`)
 * @returns {string} путь относительно каталога сборки
 */
export function fileFor(url) {
  return url === '/' ? 'index.html' : `${url.replace(/^\/+|\/+$/g, '')}/index.html`;
}

/** Все документы выпечки — по файлу на адрес. @returns {string[]} */
export function prerenderedDocPaths() {
  return prerenderedUrls().map(fileFor);
}

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
