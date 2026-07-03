# Vendored Claude Code skills (TRIP-23)

These skills are **vendored copies** of upstream open-source Claude Code skill
packages, committed into the repo so our **self-hosted Cyrus** agent (no
dashboard) picks them up natively from the worktree. Each `SKILL.md` carries an
inline provenance comment (source repo + commit SHA + license) right after its
frontmatter. Directory names are namespaced `<source>-<skill>` to avoid
collisions (several packages ship a `code-review`); the `name:` frontmatter was
set to match the directory.

**Do not hand-edit vendored skills** — re-vendor from the source repo at the
pinned commit instead. To refresh: re-clone the source and re-copy the skill
directory.

## Sources, commits, licenses

| Package | Source repo | Commit | License | Skills (dirs) |
|---|---|---|---|---|
| ECC | github.com/affaan-m/ECC | `71d22d0` | MIT | ecc-react-patterns, ecc-git-workflow, ecc-gateguard, ecc-vite-patterns, ecc-security-review, ecc-security-scan, ecc-postgres-patterns, ecc-database-migrations, ecc-customer-billing-ops |
| superpowers | github.com/obra/superpowers | `896224c` | MIT | superpowers-test-driven-development, superpowers-systematic-debugging, superpowers-verification-before-completion |
| agent-skills | github.com/addyosmani/agent-skills | `e0d2e43` | MIT | agent-skills-code-review-and-quality, agent-skills-debugging-and-error-recovery, agent-skills-frontend-ui-engineering, agent-skills-security-and-hardening |
| web-quality-skills | github.com/addyosmani/web-quality-skills | `95d6e25` | MIT | web-quality-audit, web-quality-accessibility, web-quality-performance, web-quality-core-web-vitals, web-quality-seo, web-quality-best-practices |
| design | github.com/anthropics/knowledge-work-plugins | `17d56b6` | Apache-2.0 | design-design-critique, design-design-system, design-accessibility-review, design-ux-copy, design-design-handoff |
| engineering | github.com/anthropics/knowledge-work-plugins | `17d56b6` | Apache-2.0 | engineering-code-review, engineering-debug, engineering-system-design, engineering-architecture, engineering-tech-debt, engineering-testing-strategy |
| ui-ux-pro-max | github.com/nextlevelbuilder/ui-ux-pro-max-skill | `bdf1179` | MIT | ui-ux-pro-max (+ data/ + scripts/ reference assets) |
| example-skills | github.com/anthropics/skills | `5754626` | Apache-2.0 | example-frontend-design (ships its own LICENSE.txt) |
| marketingskills (Corey Haines) | github.com/coreyhaines31/marketingskills | `8bfcdff` | MIT | marketing-* (45 skills, see section below) |

Apache-2.0 sources (`design`, `engineering`, `example-frontend-design`) retain
their license/notice: `example-frontend-design` includes upstream `LICENSE.txt`;
`design` and `engineering` derive from the Apache-2.0 `knowledge-work-plugins`
repo (see inline provenance comments).

## ECC react-review / react-build / react-test / code-review / pr / plan

These six are **not** SKILL.md skills in ECC — upstream ships them as **slash
commands** (`commands/*.md`) and **subagents** (`agents/*.md`). They are vendored
into the natively-supported repo channels instead of `.claude/skills/`:

- `.claude/commands/ecc-{react-review,react-build,react-test,code-review,pr,plan}.md`
- backing agents: `.claude/agents/ecc-{react-reviewer,typescript-reviewer,react-build-resolver,tdd-guide,planner}.md`

All from `github.com/affaan-m/ECC @ 71d22d0` (MIT). Standalone copies — internal
`ecc:` cross-references between them may not resolve, but the methodology/body
is intact.

## code-simplifier (subagent, TRIP-147)

Standalone subagent vendored into `.claude/agents/code-simplifier.md` (an agent,
not a `SKILL.md`, so it lives on the guaranteed-loaded agents channel):

| Agent | Source repo | Commit | License | File |
|---|---|---|---|---|
| code-simplifier | github.com/anthropics/claude-plugins-official | `ceb9b72` | Apache-2.0 | `plugins/code-simplifier/agents/code-simplifier.md` |

**Adapted, not verbatim:** section 2 "Apply Project Standards" was localised to
our JS/Vite stack — the upstream TS-only bullets (explicit return-type
annotations, React Props types) were replaced by our design-system-reuse
(Hard rule #6) and i18n (Hard rule #4) conventions. Everything else is the
upstream text. The inline provenance comment records exactly what diverged from
the pinned commit; refresh by re-applying that same localisation on top of a
re-vendor.

## marketingskills — Corey Haines (TRIP-163)

45 marketing skills (`marketing-*`) vendored from
`github.com/coreyhaines31/marketingskills @ 8bfcdff` (MIT, plugin v2.5.1). The
upstream package ships each skill as `<skill>/SKILL.md` + `references/*.md`
(reference material the skill reads at runtime) + `evals/evals.json` (an eval
harness). We vendored the **`SKILL.md` + `references/`** of every skill and
**dropped `evals/`** (test fixtures, not needed at runtime). Directory + `name:`
frontmatter were namespaced `marketing-<skill>` to match the repo convention
(every other package is namespaced by source); the upstream skill names appear
as `marketing-skills:<skill>` in the plugin form, which our flat `.claude/skills/`
vendoring does not use.

Skills: marketing-ab-testing, marketing-ad-creative, marketing-ads,
marketing-ai-seo, marketing-analytics, marketing-aso, marketing-churn-prevention,
marketing-co-marketing, marketing-cold-email, marketing-community-marketing,
marketing-competitor-profiling, marketing-competitors, marketing-content-strategy,
marketing-copy-editing, marketing-copywriting, marketing-cro,
marketing-customer-research, marketing-directory-submissions, marketing-emails,
marketing-free-tools, marketing-image, marketing-launch, marketing-lead-magnets,
marketing-marketing-ideas, marketing-marketing-plan, marketing-marketing-psychology,
marketing-offers, marketing-onboarding, marketing-paywalls, marketing-popups,
marketing-pricing, marketing-product-marketing, marketing-programmatic-seo,
marketing-prospecting, marketing-public-relations, marketing-referrals,
marketing-revops, marketing-sales-enablement, marketing-schema, marketing-seo-audit,
marketing-signup, marketing-site-architecture, marketing-sms, marketing-social,
marketing-video.

**Cross-references caveat:** the skill bodies reference each other by their
original bare names (e.g. "For page-level conversion optimization, see cro."). With
the `marketing-` prefix these stay as prose — the agent resolves "cro" to
`marketing-cro` by description, same caveat as the ECC commands above.

## Caveat: does Cyrus load `.claude/skills/`?

Cyrus docs explicitly list `CLAUDE.md`, `.claude/agents/`, `.claude/commands/`,
`.claude/settings.json` as auto-loaded in the worktree. `.claude/skills/` is a
native Claude Code feature but is **not** named in that list — so skill pickup by
the self-hosted runtime is unverified and must be smoke-tested. The ECC
commands/agents above are on the guaranteed-loaded channels. See
`memory/triplanio-cyrus-skills-loading.md`.
