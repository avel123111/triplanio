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
5. **Git — ВСЕГДА заканчивай PR'ом, не голым пушем.** Stage one path per line (pasting multi-path `git add` breaks in the terminal). End **every** change by: stage → commit → push the working branch → **open or update a Pull Request into `dev`** (`gh pr create` / `gh pr edit`). Это относится к ЛЮБОМУ изменению, включая docs/`memory/` — не только код. **Никогда не завершай работу на `git push` без PR:** PR — это то, что привязывает работу к Linear-задаче (по `TRIP-NN` в имени ветки) и запускает CI-гейт; пуш без PR **невидим в Linear и проходит мимо ревью**. Агент сам **не мёрджит** — мердж (особенно в `main`) делает Pavel. Если изменение тривиальное (заметка в память) — это всё равно PR, а не исключение.
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
- **АГЕНТ НИКОГДА не деплоит бэкенд сам и НЕ предлагает Pavel'у задеплоить вручную.** Любой деплой (функции И миграции) идёт ТОЛЬКО через CI/CD: закоммить → PR → мердж в `dev` (затем `dev`→`main`) → GitHub Actions катит сам. НЕ вызывай MCP `apply_migration`/`deploy_edge_function`, CLI или Management API для наката в `dev`/`prod`; НЕ пиши «выполни эту команду руками». Финальная цель достигнута: функции и миграции деплоятся через один CI/CD одинаково. (Разовый bootstrap-reconcile TRIP-68 был осознанным исключением и завершён.)
- **Frontend:** Vercel, auto on push. **The agent pushes ONLY to its own working branch.** `dev` and `main` are touched **only with Pavel's explicit per-change approval** — never push, merge, or fast-forward into `dev`/`main` on your own initiative (standing rules do NOT pre-authorize it).
- **Supabase edge functions — AUTO-DEPLOY via GitHub Actions** (TRIP-73, live since 2026-06-25). Merge → `dev` deploys all functions to Supabase **dev** (`nydhzevdizkfaxdlikgc`); merge → `main` deploys to **prod** (`tizscxrpuopobgcxbekf`). Workflow `.github/workflows/supabase-deploy.yml` fires on push to dev/main when `supabase/functions/**` or `supabase/config.toml` change (+ manual `workflow_dispatch`). Deploy is **config-driven**: `supabase functions deploy --project-ref <ref>` (no slug → all functions), `verify_jwt` taken **only from `supabase/config.toml`** (never `--no-verify-jwt`). A final CI step asserts the pinned-false set via the Management API and fails on drift. **So the normal way to ship a function change is merge to `dev` (then `dev`→`main`) — not a hand deploy.** Each branch deploys its own target, so dev+prod stay in sync.
- **Supabase миграции — AUTO-DEPLOY via GitHub Actions** (TRIP-68 Ф3, с 2026-06-25, после reconcile истории). Тот же воркфлоу `supabase-deploy.yml`, job `migrate`: merge→`dev` → `supabase db push` в Supabase **dev**; merge→`main` → в **prod**; триггер по `supabase/migrations/**`. История схлопнута в единый baseline `supabase/migrations/20260625120000_baseline.sql`; репо↔dev↔prod журналы идентичны (1 запись). **Новые миграции — ТОЛЬКО `supabase migration new <name>` (таймстамп-имя `<YYYYMMDDHHMMSS>_*.sql`); нумерация `00NN` ЗАПРЕЩЕНА** — именно она порождала дрейф TRIP-68, а дубли версий ломают `db push`. Один логический change = один файл. `db push` катит только файлы новее журнала проекта. Требует секреты `SUPABASE_DB_URL_DEV`/`SUPABASE_DB_URL_PROD` (полный Postgres URI на проект).
- **Ручной деплой = АВАРИЙНЫЙ фолбэк, делает ТОЛЬКО человек (Pavel)**, не агент (хотфикс без мерджа). Должен совпадать с `config.toml` + веткой (no repo-vs-runtime drift); после — прогнать авто-деплой (`workflow_dispatch`), чтобы runtime == git. Агент в этот режим не уходит и его не предлагает (см. первый пункт правила 12).
- **Edge-function `verify_jwt` SOP — source of truth = `supabase/config.toml`.** Functions that authenticate themselves (webhook / public / N8N_SECRET / anon preflight) MUST be pinned `verify_jwt = false` there; everything else defaults `true`.
  1. **Pinned-false set (12)** = canon-9 (`getTripByTelegramChatId, getTripById, getPublicTrip, stripe-webhook, telegramWebhook, triplanioAiReply, seedTripBudget, getPendingReminders, getDailyReminders`) + `signupPrecheck` + `requestPasswordReset` + `telegramDisconnect`. (`syncTripExpense` удалена в TRIP-45 — была мёртвой, дублировала DB-триггер `sync_budget_expense()`.)
  2. **New externally-callable function** → add `[functions.<name>] verify_jwt = false` to `config.toml` (and to the set above) **before it merges**, else CI deploys it as `true` and breaks it.
  3. **CI enforces this automatically** (config-driven deploy + Management-API assert). You do NOT pass `--no-verify-jwt` in CI.
  4. **Manual MCP/CLI deploy still silently resets `verify_jwt=true`** — so for a manual/fallback deploy of a pinned-false function, pass `verify_jwt: false` (MCP) / `--no-verify-jwt` (CLI) explicitly, then verify via `list_edge_functions`.
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
- **After ANY code change — ALWAYS run the `code-simplifier` agent (MANDATORY).** Before saying "done" on a change that touched code, spawn the `code-simplifier` subagent (`.claude/agents/code-simplifier.md`) as a behaviour-preserving cleanup pass over the diff you just produced (the files you touched, not the whole repo). It only refines for clarity/consistency and must NOT change behaviour; anything structurally new it surfaces still goes through the rule #6/#9 approval gate. Skip ONLY for non-code changes (docs/`memory/`/config-only, e.g. this very file) and trivial one-liners. This is a hard step, not optional.
- Attribution manifest: `.claude/skills/VENDORED.md`. ⚠️ `.claude/commands/` + `.claude/agents/` are reliably auto-loaded by Cyrus; `.claude/skills/` is NOT named in the Cyrus "carries over" docs — if a session doesn't surface a skill, read its `SKILL.md` directly as a file. See `memory/triplanio-cyrus-skills-loading.md` + `memory/triplanio-ecc-toolkit.md`.
15. **Design / frontend skills (MANDATORY consult).** Self-hosted Cyrus does NOT auto-load `.claude/skills/` as Skill tools (smoke-tested — only `cyrus-skills:*` + `.claude/agents/` + `.claude/commands/` load). But the vendored skill files ARE on disk and readable. **On ANY frontend / design / redesign / UI task — before writing UI code — open and apply the relevant playbook(s) below via `Read`** (they are the design source-of-truth alongside `src/design/index.jsx` and the Lumo system; do not skip them, do not hand-edit them — re-vendor instead). For React/TS/build correctness keep using the loaded ECC agents (`ecc-react-reviewer`, `ecc-typescript-reviewer`, `ecc-react-build-resolver`).
- **Design critique / UX review** → `.claude/skills/design-design-critique/SKILL.md` (review a screen/mockup, hierarchy, usability)
- **Design system audit / extend** → `.claude/skills/design-design-system/SKILL.md` (naming/token consistency, document a component's variants/states)
- **Accessibility (WCAG 2.1 AA)** → `.claude/skills/design-accessibility-review/SKILL.md` (contrast, keyboard, touch targets, SR)
- **UX copy / microcopy** → `.claude/skills/design-ux-copy/SKILL.md` (buttons, errors, empty states, onboarding — pair with i18n rule 4)
- **Design→dev handoff spec** → `.claude/skills/design-design-handoff/SKILL.md` (layout, tokens, props, states, breakpoints)
- **Visual direction / distinctive UI** → `.claude/skills/example-frontend-design/SKILL.md`
- **Production-quality UI build** → `.claude/skills/agent-skills-frontend-ui-engineering/SKILL.md`
- **UI/UX intelligence (styles, palettes, font pairings, patterns)** → `.claude/skills/ui-ux-pro-max/SKILL.md`
- **Web quality (perf / a11y / SEO / CWV / best practices)** → `.claude/skills/web-quality-*/SKILL.md`
