# CLAUDE.md — Triplanio (source-of-truth repo)

Travel planning + expense-sharing app. New architecture: **React 18 + Vite 6 + Supabase + Stripe**, deploy on Vercel. Repo `avel123111/triplanio`, branches `dev` and `main`.

## Commands
- Build: `npx vite build`
- Dev server: `npm run dev` (vite)
- Lint: `npm run lint` (`eslint . --quiet`) / fix: `npm run lint:fix`
- Typecheck: `npm run typecheck` (`tsc -p ./jsconfig.json`)
- Tests: `npm test` (`node --test "src/**/*.test.js"`) — coverage is thin; add tests around Pro-gating and Stripe
- Design-token guard: `npm run check:design` (typography blocks, color reports)

## Hard rules (project conventions — do not violate)
1. **Analyze before code.** For any change: read the relevant base44 files + full dependency chain, check the redesign screen, write a plan, get Pavel's approval — *then* code. No guessing logic not found in code.
2. **Definition of Done = three axes:** (a) visual from the new design system (`src/design/index.jsx`: ModalHost, Dialog, Btn, Badge, Card, Avatar, EmptyState, Field…), zero leftover base44/shadcn `@/components/ui/*`; (b) functionality fully mirrors the base44 logic (validations, rules, side-effects); (c) **reuse audit passed** (rule 6).
3. **No docs on the repo.** Only codebase files here. Task specs / mockups / reports / design files live in the `Triplanio docs` and `Triplanio design new` folders. Knowledge base = the `memory/` folder + Notion.
4. **i18n:** never hardcode UI strings — go through `t()` (en/es/ru). Bot text comes from edge functions. **Dedup keys:** each key must live in ONE locale namespace file. A key defined in two files (e.g. `trip.js` + `ai_plan.js`) is a bug — the last spread in `locales/<lang>/index.js` silently wins and the other copy is dead/conflicting. When you touch a screen's strings, grep the key across all locale files (en/es/ru), collapse duplicates to the canonical namespace, and flag what you found.
5. **Git:** stage one path per line (pasting multi-path `git add` breaks in the terminal). End code work with explicit stage/commit/push commands.
6. **Reuse-first (unification gate) — BLOCKING, run before you say "done".** Default to the system that already exists; never create anything that duplicates what's already in the repo. Before finishing ANY change: grep for an existing component / CSS class / style rule / design token / breakpoint / hook / layout pattern and **reuse it**. Bind to the design system (`src/design/index.jsx`), existing tokens, existing breakpoints, existing components. Introduce something new ONLY when no existing equivalent fits — and state in your reply which existing ones you checked and why each is unsuitable ("faster to write a new one" is not a reason). Never add a second breakpoint/token/class/component that overlaps an existing one — align to what the adjacent code already uses. Collapse any duplicate you (or prior code) created; flag dead/duplicate code you spot, even if unrelated. End UI work with one line: `Reuse audit: reused …; new: none | <name + justification>`. If you can't write that line truthfully, you're not done. **Approval gate for anything new:** introducing a NEW design token, CSS class, shared component, breakpoint, switch/stepper/button, or any custom element requires Pavel's explicit approval FIRST — propose it in the plan and wait. Justification alone is not enough; do not add it unilaterally. The default is always "reuse the existing element with an adaptive variant," never "write a new one."

## Deploy topology
- **Frontend:** Vercel, auto on push. Deploy changes to **both `dev` and `main`** during current testing phase.
- **Supabase:** functions + migrations deployed **manually** (no CI). Two projects: prod `tizscxrpuopobgcxbekf` + dev `nydhzevdizkfaxdlikgc` — keep both in sync.
- **verify_jwt trap:** CLI/MCP batch deploys silently reset `verify_jwt=true` and break webhook/N8N_SECRET functions. Deploy the canon-10 with explicit `--no-verify-jwt` and re-verify via `list_edge_functions` after every deploy. Canon-10 (must stay false): `getTripByTelegramChatId, getTripById, getPublicTrip, stripe-webhook, telegramWebhook, triplanioAiReply, seedTripBudget, syncTripExpense, getPendingReminders, getDailyReminders`.

## Security-sensitive areas (highest review priority)
Stripe webhook + subscription/entitlement reconciliation; Pro/Premium tier gating; edge-function auth (known IDOR / fail-open risks on trip-read functions). Run a security review on any change here.

## ECC skills to reach for
`ecc:plan` (planning gate), `ecc:react-review` / `ecc:react-build`, `ecc:security-review`, `ecc:postgres-patterns` + `ecc:database-migrations`, `ecc:customer-billing-ops` (Stripe), `ecc:code-review` + `ecc:pr`. See `memory/triplanio-ecc-toolkit.md` for the full DAILY/LIBRARY map.
