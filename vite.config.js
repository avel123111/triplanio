import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { stripCss, stripHtml } from './scripts/build/strip-comments.mjs'

// Source-map upload runs only on builds that have the auth token (i.e. Vercel CI).
// Local `npm run build` has no token → plugin is skipped and no maps are emitted.
const SENTRY_AUTH_TOKEN = process.env.SENTRY_AUTH_TOKEN;
// Tagged on both the JS bundle (via `define` below) and the uploaded release so
// stack traces line up with the exact commit. Empty outside Vercel.
const SENTRY_RELEASE = process.env.VERCEL_GIT_COMMIT_SHA || '';

// https://vite.dev/config/
export default defineConfig({
  logLevel: 'error', // Suppress warnings, only show errors
  define: {
    __SENTRY_RELEASE__: JSON.stringify(SENTRY_RELEASE),
  },
  resolve: {
    // `@/...` → `/src/...`. Previously provided by the base44 vite plugin;
    // now a plain native Vite alias so the app has no base44 build dependency.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // 'hidden' = maps are emitted for upload but NOT referenced from the served
    // JS, so they never become publicly fetchable. Off entirely without a token.
    sourcemap: SENTRY_AUTH_TOKEN ? 'hidden' : false,
    rollupOptions: {
      output: {
        /**
         * ЧЕТЫРЕ ВЕНДОРА — СВОИМИ ЧАНКАМИ (TRIP-445).
         *
         * ЧТО ЭТО НЕ ДЕЛАЕТ, ЧТОБЫ НИКТО НЕ ЗАСЧИТАЛ ЛИШНЕГО: `manualChunks`
         * только ИМЕНУЕТ чанки, граф импортов не трогает — синхронное остаётся
         * синхронным, динамическое динамическим. `mapbox-gl` в стартовый граф НЕ
         * входит: его единственный вход — `loadMapboxGl()` в `src/lib/mapbox.js`
         * (динамический `import('mapbox-gl')`), статического импорта нет нигде в
         * дереве, поэтому на лендинг он не приезжает. Этот чанк лишь даёт карте,
         * что и так грузится по требованию, собственное имя и собственный кэш.
         *
         * ЧТО ЭТО ДЕЛАЕТ. Замер на этой сборке: главный чанк 3824 КБ / 1123 КБ
         * gzip → 1712 КБ / 543 КБ, а вендоры уезжают в mapbox 486 КБ gzip ·
         * supabase 53 · luxon 22 · icons 11. Пока всё лежало одним файлом, любая
         * правка ЛЮБОЙ строки приложения меняла хэш этого файла — и повторный
         * визит выкачивал полмегабайта mapbox заново, хотя библиотека не
         * менялась месяцами. Вендоры версионируются своим темпом, поэтому и
         * кэшируются своим.
         *
         * ПОЧЕМУ ИМЕННО ЭТИ ЧЕТЫРЕ, А НЕ «весь node_modules в vendor». Общий
         * `vendor` — это тот же ком, только под другим именем: он инвалидируется
         * от обновления любой мелкой зависимости. Названы ровно те, у кого вес
         * измерен и заметен; всё остальное осознанно остаётся в главном чанке.
         */
        manualChunks(id) {
          if (id.includes('node_modules/mapbox-gl')) return 'mapbox';
          if (id.includes('node_modules/@supabase')) return 'supabase';
          if (id.includes('node_modules/luxon')) return 'luxon';
          if (id.includes('node_modules/lucide-react')) return 'icons';
          return undefined;
        },
      },
    },
  },
  plugins: [
    react(),
    /**
     * ЭКРАН ЗАПУСКА — ОДИН ИСТОЧНИК, ПОДСТАВЛЯЕМЫЙ В ДОКУМЕНТ (TRIP-478).
     *
     * Заставка обязана работать ДО бандла, поэтому в документе она может быть
     * только инлайном. Но «инлайн» не обязано значить «написано руками в
     * index.html»: источник правды лежит в дизайн-системе
     * (`src/design/splash.css` + `splash.html`), а сюда подставляется здесь.
     *
     * Что это покупает, помимо отсутствия второй копии: стили заставки
     * оказываются ОБЫЧНЫМ CSS-файлом в `src/design/`, то есть в периметре
     * гардов ДС (пол 2o считает её классы, 2m — namespace, 2p — объявления).
     * Пока они жили в HTML, заставка росла молча — ни один счётчик её не видел.
     * Тот же файл рисует витрина `/kit/splash`.
     *
     * `apply` не задан НАМЕРЕННО: подстановка нужна и в dev, иначе `npm run
     * dev` показывал бы приложение без заставки — то есть отлаживали бы одно,
     * а в прод уезжало другое.
     */
    {
      name: 'inline-splash',
      transformIndexHtml: {
        order: 'pre',
        handler(html) {
          const read = (f) => readFileSync(fileURLToPath(new URL(`./src/design/${f}`, import.meta.url)), 'utf8');
          const put = (marker, block) => {
            if (!html.includes(marker)) throw new Error(`inline-splash: в index.html нет ${marker}`);
            html = html.replace(marker, block);
          };
          put('<!--splash:style-->', `<style>\n${read('splash.css')}\n</style>`);
          put('<!--splash:markup-->', read('splash.html'));
          return html;
        },
      },
    },
    // Комментарии не уезжают в браузер. Vite чистит всё, что проходит через
    // сборку, но `public/` копирует байт в байт — а там лежит `site.css`,
    // единственная таблица стилей зоны: 373 КБ, из них 187 КБ комментариев.
    // Чистим НА ВЫХОДЕ, а не в исходнике: 778 из 920 комментариев несут
    // маркеры гардов, и CI читает их именно из исходника.
    {
      name: 'strip-shipped-comments',
      apply: 'build',
      closeBundle() {
        const out = fileURLToPath(new URL('./dist', import.meta.url));
        for (const [rel, strip] of [['index.html', stripHtml], ['site.css', stripCss]]) {
          const file = join(out, rel);
          if (!existsSync(file)) continue;
          writeFileSync(file, strip(readFileSync(file, 'utf8')));
        }
        // Внутри <style> живёт CSS, а не HTML, поэтому его комментарии
        // `stripHtml` не видит по построению. Раньше этого шага не было за
        // ненадобностью: инлайнового CSS в документе не существовало. С
        // приездом заставки (TRIP-478) он появился — и её докблоки уезжали бы
        // в прод целиком, ровно то, против чего заведён весь этот плагин.
        const indexFile = join(out, 'index.html');
        if (existsSync(indexFile)) {
          const html = readFileSync(indexFile, 'utf8');
          writeFileSync(indexFile, html.replace(
            /(<style[^>]*>)([\s\S]*?)(<\/style>)/g,
            (_, open, css, close) => open + stripCss(css).replace(/\n\s*\n/g, '\n').trim() + close,
          ));
        }
      },
    },
    // Must come last so it sees the final bundle. EU region is mandatory — the
    // org lives on de.sentry.io and the default (US) host would silently fail.
    SENTRY_AUTH_TOKEN && sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: SENTRY_AUTH_TOKEN,
      url: process.env.SENTRY_URL || 'https://de.sentry.io',
      release: { name: SENTRY_RELEASE || undefined },
      // Upload then delete so the .map files are never deployed to Vercel.
      sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
    }),
  ].filter(Boolean),
});