# Triplanio

Travel planning + expense-sharing app. **React 18 + Vite 6 + Supabase + Stripe**, deployed on Vercel.

## Local development

**Prerequisites:** Node 20+.

1. Clone the repository.
2. Install dependencies: `npm install`
3. Create an `.env.local` (see `.env.example` for the required keys: Supabase URL/anon key, Google client id, Mapbox token, bot user id, Sentry DSN).
4. Run the dev server: `npm run dev`

## Scripts

- `npm run dev` — Vite dev server
- `npm run build` — production build (`vite build`)
- `npm run preview` — preview the production build
- `npm run lint` / `npm run lint:fix` — ESLint
- `npm run typecheck` — `tsc -p ./jsconfig.json`
- `npm test` — `node --test "src/**/*.test.js"`
- `npm run check:design` — design-token guard

## Deploy

- **Frontend:** Vercel, auto-deploy on push (branches `dev` and `main`).
- **Backend:** Supabase edge functions + migrations are deployed manually; two projects (prod + dev) are kept in sync.
