import base44 from "@base44/vite-plugin"
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { sentryVitePlugin } from '@sentry/vite-plugin'

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
  build: {
    // 'hidden' = maps are emitted for upload but NOT referenced from the served
    // JS, so they never become publicly fetchable. Off entirely without a token.
    sourcemap: SENTRY_AUTH_TOKEN ? 'hidden' : false,
  },
  plugins: [
    base44({
      // Support for legacy code that imports the base44 SDK with @/integrations, @/entities, etc.
      // can be removed if the code has been updated to use the new SDK imports from @base44/sdk
      legacySDKImports: process.env.BASE44_LEGACY_SDK_IMPORTS === 'true',
      hmrNotifier: true,
      navigationNotifier: true,
      analyticsTracker: true,
      visualEditAgent: true
    }),
    react(),
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