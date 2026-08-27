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
         * ЧТО ЭТО НЕ ДЕЛАЕТ, ЧТОБЫ НИКТО НЕ ЗАСЧИТАЛ ЛИШНЕГО: граф импортов не
         * тронут, поэтому синхронные зависимости так и остаются синхронными —
         * `mapbox` по-прежнему запрашивается на ПЕРВОЙ странице, включая
         * лендинг. Разорвать это может только развязка `acquire` в MapProvider
         * (карта создаётся синхронно и её ждут 12 потребителей) — отдельная
         * работа, которую нельзя сдавать без стенда с живым токеном.
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