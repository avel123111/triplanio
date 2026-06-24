# CLAUDE.md — Triplanio (source-of-truth repo)

Travel planning + expense-sharing app. New architecture: **React 18 + Vite 6 + Supabase + Stripe**, deploy on Vercel. Repo `avel123111/triplanio`, branches `dev` and `main`.

## Memory (auto-loaded — do not skip)
The project knowledge base is the `memory/` folder. Its index is imported into
**every** session automatically by the line below — treat it as already in your
context, no manual read needed. Open individual `memory/*.md` topic files on
demand. Conventions: one topic = one file; record factual current state (how it
works now), never changelogs; small facts go into the nearest existing topic;
**no secrets** (tokens/keys/connection strings) — descriptions only.

@memory/MEMORY.md

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
3. **No docs on the repo.** Only codebase files here. Task specs / mockups / reports / design files live in the `Triplanio docs` and `Triplanio design new` folders. Knowledge base = the `memory/` folder + Notion. The `memory/MEMORY.md` index is **auto-imported** into every session (see the “Memory” block above) — you already have it; just open specific `memory/*.md` topic files as needed.
4. **i18n:** never hardcode UI strings — go through `t()` (en/es/ru). Bot text comes from edge functions. **Dedup keys:** each key must live in ONE locale namespace file. A key defined in two files (e.g. `trip.js` + `ai_plan.js`) is a bug — the last spread in `locales/<lang>/index.js` silently wins and the other copy is dead/conflicting. When you touch a screen's strings, grep the key across all locale files (en/es/ru), collapse duplicates to the canonical namespace, and flag what you found.
5. **Git:** stage one path per line (pasting multi-path `git add` breaks in the terminal). End code work with explicit stage/commit/push commands.
6. **Reuse-first (unification gate) — BLOCKING, run before you say "done".** Default to the system that already exists; never create anything that duplicates what's already in the repo. Before finishing ANY change: grep for an existing component / CSS class / style rule / design token / breakpoint / hook / layout pattern and **reuse it**. Bind to the design system (`src/design/index.jsx`), existing tokens, existing breakpoints, existing components. Introduce something new ONLY when no existing equivalent fits — and state in your reply which existing ones you checked and why each is unsuitable ("faster to write a new one" is not a reason). Never add a second breakpoint/token/class/component that overlaps an existing one — align to what the adjacent code already uses. Collapse any duplicate you (or prior code) created; flag dead/duplicate code you spot, even if unrelated. End UI work with one line: `Reuse audit: reused …; new: none | <name + justification>`. If you can't write that line truthfully, you're not done. **Approval gate for anything new:** introducing a NEW design token, CSS class, shared component, breakpoint, switch/stepper/button, or any custom element requires Pavel's explicit approval FIRST — propose it in the plan and wait. Justification alone is not enough; do not add it unilaterally. The default is always "reuse the existing element with an adaptive variant," never "write a new one."
7. **Language** Always respond in Russian.
8. **Role** Act as a highly confident Principal Software Engineer and Technical Analyst. Be critical — challenge assumptions, push back on bad approaches, proactively suggest better solutions. Never blindly execute.
9. **Clarification gate** Never write or modify code if there is any ambiguity. Stop and ask clarifying questions first. Before touching any file, explicitly describe what you plan to change, how, and the full dependency impact — wait for approval.
10. **Notion documentation** Triplanio's knowledge base lives in Notion. After every code change, update the relevant Notion page to reflect the current factual state. Rules:
- Factual state only — no changelogs ("fixed X"). Describe how it works now.
- Respect the existing hierarchy; never create a top-level page for a minor feature.
- Update existing sections or add a sub-page in the right contextual branch.
11. **Docs / design file locations**
- Task specs, reports, documents → `Triplanio docs/` (local folder)
- Design files, mockups → `Triplanio design new/` (local folder)
- Repo = codebase only; no docs on the repo
12. **Deploy topology**
- **Frontend:** Vercel, auto on push. Deploy changes to **both `dev` and `main`** during current testing phase.
- **Supabase:** functions + migrations have **no push-triggered CI** — nothing deploys on `git push`. A deploy is always initiated manually, but "manual" = "not automatic on push", NOT "agent can't": run it **either by the agent via the Supabase MCP connector (`deploy_edge_function`, `apply_migration`) or by a human via the Supabase CLI**. Either way, keep deployed code in lockstep with the merged branch (no repo-vs-runtime drift). Two projects: prod `tizscxrpuopobgcxbekf` + dev `nydhzevdizkfaxdlikgc` — keep both in sync (deploy to BOTH on every function change).
- **Edge-function deploy SOP (MANDATORY — follow on every deploy):** CLI/MCP deploys silently reset `verify_jwt=true`, which breaks webhook / public / N8N_SECRET functions. The default is `true` and WILL break the canon-10 — never rely on it.
  1. **canon-10 → always deploy with `verify_jwt: false` EXPLICITLY** (MCP `deploy_edge_function` param; CLI `--no-verify-jwt`). Never omit it. Canon-10 (must stay `false`): `getTripByTelegramChatId, getTripById, getPublicTrip, stripe-webhook, telegramWebhook, triplanioAiReply, seedTripBudget, syncTripExpense, getPendingReminders, getDailyReminders`.
  2. **All other functions → default `verify_jwt: true`** (do not pass `false`).
  3. **After EVERY deploy → run `list_edge_functions` and verify all canon-10 = `false`.** If any flipped to `true`, redeploy that function with `verify_jwt: false` and re-verify.
  4. **Keep dev (`nydhzevdizkfaxdlikgc`) and prod (`tizscxrpuopobgcxbekf`) in sync** — deploy the same function to both projects.
  5. **New externally-callable function** (webhook / public / N8N-secret) → add it to the canon-10 list above AND deploy it with `verify_jwt: false`.
13. **Security-sensitive areas (highest review priority)**
Stripe webhook + subscription/entitlement reconciliation; Pro/Premium tier gating; edge-function auth (known IDOR / fail-open risks on trip-read functions). Run a security review on any change here.
14. **Vendored skills/commands/agents (TRIP-23) — use by default.** Real upstream content lives in the repo under `.claude/` (NOT the Cowork `ecc:*` plugin namespace, which does not exist in our self-hosted Cyrus). Route by task type:
- **Analyze / plan** → command `/ecc-plan`; skills `superpowers-*`, `engineering-system-design` / `engineering-architecture`.
- **React / Vite frontend** → commands `/ecc-react-review`, `/ecc-react-build`, `/ecc-react-test`; skills `ecc-react-patterns`, `ecc-vite-patterns`, `agent-skills-frontend-ui-engineering`, `web-quality-*` (accessibility/performance/core-web-vitals/seo/best-practices/audit).
- **Security** (Stripe webhook / IDOR / RLS / tier-gating — highest priority, rule 13) → skills `ecc-security-review`, `ecc-security-scan`, `ecc-gateguard`, `agent-skills-security-and-hardening`.
- **Stripe / billing** → skill `ecc-customer-billing-ops`.
- **Supabase / Postgres / migrations** → skills `ecc-postgres-patterns`, `ecc-database-migrations`.
- **Tests / debugging** → skills `superpowers-test-driven-development`, `superpowers-systematic-debugging`, `superpowers-verification-before-completion`, `agent-skills-debugging-and-error-recovery`, `engineering-testing-strategy` / `engineering-debug` / `engineering-tech-debt`; code review `agent-skills-code-review-and-quality`, `engineering-code-review`.
- **Design / UX** → skills `design-*` (critique/system/accessibility-review/ux-copy/handoff), `ui-ux-pro-max`, `example-frontend-design`.
- **Finish a change** → commands `/ecc-code-review`, `/ecc-pr`.
- Attribution manifest: `.claude/skills/VENDORED.md`. ⚠️ `.claude/commands/` + `.claude/agents/` are reliably auto-loaded by Cyrus; `.claude/skills/` is NOT named in the Cyrus "carries over" docs — if a session doesn't surface a skill, read its `SKILL.md` directly as a file. See `memory/triplanio-cyrus-skills-loading.md` + `memory/triplanio-ecc-toolkit.md`.
