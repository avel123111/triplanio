---
name: triplanio-cyrus-skills-loading
description: "★ВАЖНО: у Pavel SELF-HOSTED Cyrus БЕЗ интерфейса/дашборда (app.atcyrus.com не его путь) — скиллы НЕ ставятся кликом из дашборда; единственный версионируемый канал = репо .claude/ (commands/agents/CLAUDE.md/skills), всё остальное = руками в конфиге cyrus-процесса на Railway; ECC/superpowers — плагины Cowork/CLI, в Cyrus НЕ грузятся"
metadata:
  type: reference
---

**Сетап Pavel: self-hosted Cyrus БЕЗ веб-интерфейса** (OSS cyrus-процесс на Railway, не продукт app.atcyrus.com). Прямая цитата: «у меня нет дашборда у меня self hosted cyrus без интерфейса». Значит:

- **Канала «дашборд Skills page»/«Install curated» НЕ существует** для этого инстанса. Любые советы «поставь с дашборда / app.atcyrus.com / Manage scope» — НЕРЕЛЕВАНТНЫ. Не предлагать.
- **Cyrus-native скиллы** в этой сессии: `cyrus-skills:debug/implementation/investigate/summarize/verify-and-ship` — дефолтный набор рантайма. Кастомные Cyrus-скиллы для OSS-инстанса добавляются только правкой конфига cyrus-процесса на хосте (Railway) + редеплой/рестарт — не версионируется в проекте, общий на все репо инстанса.

**Два реальных канала кастомизации для этого сетапа:**
1. **Репо `.claude/`** — ЕДИНСТВЕННЫЙ версионируемый, едет с worktree, виден в PR, работает для любого Cyrus. Cyrus гоняет Claude Code внутри worktree → нативно подхватывает `CLAUDE.md`, `.claude/agents/`, `.claude/commands/`, `.claude/settings.json` (это явно задокументировано как «carries over»). `.claude/skills/*/SKILL.md` — нативная фича Claude Code, в Cyrus-доках в списке «carries over» НЕ перечислена → подхват под вопросом, проверять; гарантированно работают commands/agents/CLAUDE.md.
2. **Хост-конфиг cyrus на Railway** — для кросс-проектных вещей на ВСЕ репо инстанса; руками + редеплой, не версионируется. Pavel по сути гоняет один продукт → канал 1 (репо) почти всегда выигрывает.

**Категориальная ошибка тикета TRIP-23:** ECC / superpowers / engineering / agent-skills / design / ui-ux-pro-max / web-quality-skills — это **плагины Claude Code из маркетплейсов**, рассчитанные на **desktop Cowork / CLI** (namespacing `ecc:*`, `/ecc:configure-ecc`; см. [[triplanio-ecc-toolkit]]). **Cyrus НЕ умеет ставить сторонние плагин-маркетплейсы** ни из репо, ни из конфига. Нативный аналог в Cyrus = отдельные `SKILL.md` (имя + description-триггер + тело). Поэтому «положить ECC в репо для Cyrus» не сработает; ценность — переписать наш плейбук как свои SKILL.md/.claude-ассеты.

**MCP для self-hosted:** конфигурится файлом `.mcp.json` в корне репо (версионируется, секреты через `${ENV_VAR}`) — это канал, аналогичный репо-`.claude/`. У нас уже есть `.mcp.json` (TRIP-20 Sentry).

**★РЕАЛИЗОВАНО (TRIP-23, PR #117): завендорено в репо `.claude/`** (реальный апстрим-контент, не дженерик; манифест атрибуции `.claude/skills/VENDORED.md`):
- **35 скиллов** в `.claude/skills/<source>-<skill>/SKILL.md` (неймспейс по источнику, чтобы не было коллизий `name:`): ECC×9 (affaan-m/ECC, MIT), superpowers×3 (obra, MIT), agent-skills×4 (addyosmani, MIT), web-quality×6 (addyosmani, MIT), design×5 (anthropics/knowledge-work-plugins, Apache-2.0), engineering×6 (там же, Apache-2.0), ui-ux-pro-max×1 (nextlevelbuilder, MIT, +data/scripts), example-frontend-design×1 (anthropics/skills, Apache-2.0).
- **6 ECC-команд + 5 агентов** в `.claude/commands/ecc-*.md` + `.claude/agents/ecc-*.md`: react-review/react-build/react-test/code-review/pr/plan — в ECC это НЕ SKILL.md, а commands/agents (совпало с тем, что память звала их `ecc:plan`/`ecc:pr` — это команды). Положены в гарантированно-загружаемые каналы.
- **Каждый файл** несёт inline-комментарий `<!-- Vendored from <repo> @ <sha>, license: ... -->`; правка = ре-вендор из источника, не руками.
- **ОТКРЫТО/смоук:** проверить, реально ли self-hosted рантайм видит `.claude/skills/` (в Cyrus-доках в «carries over» не перечислено; commands/agents — точно видит). Если skills не подхватываются — конвертить ценные в commands/agents.
