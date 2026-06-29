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

Verbatim copy (only an inline provenance comment added after the frontmatter).
It reads our own `CLAUDE.md` standards at runtime; the upstream body keeps its
original TS-flavoured examples — do not hand-edit, re-vendor at the pinned commit.

## Caveat: does Cyrus load `.claude/skills/`?

Cyrus docs explicitly list `CLAUDE.md`, `.claude/agents/`, `.claude/commands/`,
`.claude/settings.json` as auto-loaded in the worktree. `.claude/skills/` is a
native Claude Code feature but is **not** named in that list — so skill pickup by
the self-hosted runtime is unverified and must be smoke-tested. The ECC
commands/agents above are on the guaranteed-loaded channels. See
`memory/triplanio-cyrus-skills-loading.md`.
