---
name: triplanio-ponytail-vendored
description: TRIP-218 - ponytail (lazy-dev code-minimization ladder) вендорен в репо .claude/skills как 4 скилла + мандат в CLAUDE.md rule #6; /plugin install не работает в self-hosted Cyrus
metadata:
  type: project
---

★PR в dev 2026-07-09 (TRIP-218): «установили» плагин **ponytail** (github.com/DietrichGebert/ponytail @ `523e9dc`, MIT) - «ленивый сеньор», форсит минимальный код: лестница из 7 ступеней (YAGNI → уже в кодовой базе → stdlib → нативная фича → существующая зависимость → одна строка → минимальный код) + «удаление важнее добавления / фикс корня, не симптома».

**Почему НЕ через `/plugin install` (как в тикете):** в self-hosted Cyrus без дашборда команды `/plugin marketplace add` / `/plugin install` недоступны, и даже выполненные - кладут плагин в локальный `~/.claude`, НЕ в репо → невидим в каждой worktree-сессии Cyrus. Единственный рабочий канал = вендоринг в репо `.claude/` (тот же урок [[triplanio-cyrus-skills-loading]] / TRIP-23, как ECC).

**Что сделано (минимальный скоуп, выбор Ильи «максимальный реюз, минимизация»):**
- Вендорены **4 скилла** verbatim в `.claude/skills/ponytail*` с inline-провенансом: `ponytail` (ядро-лестница + lite/full/ultra), `ponytail-review` (ревью диффа на оверинжиниринг), `ponytail-audit` (репо-скан bloat), `ponytail-debt` (сбор `ponytail:`-комментов в реестр).
- **Мандат в `CLAUDE.md` rule #6** (reuse-first) - подпункт «Ponytail ladder»: обязателен на каждой кодовой задаче, но ЯВНО = именованная пошаговая форма уже-forced правила #6 + агента `code-simplifier` (rule #14), НЕ второй источник истины; при конфликте побеждают #6/#9 + approval-gate. Плюс строка-маршрут в rule #14. SoT остаётся `src/design/index.jsx` + токены.
- Запись в `.claude/skills/VENDORED.md` (строка таблицы + секция).

**Намеренно выброшено** (по ступени 1 самого ponytail «нужно ли существовать»): 8 Node-хуков (always-on инжект каждый ход - в Cyrus не исполнятся + лишняя поверхность атаки; мандат вместо них живёт в авто-загружаемом CLAUDE.md), `ponytail-gain` (бенч-скорборд) + `ponytail-help` (ссылается на хуки/режимы/`/plugin`, которых у нас нет = мёртвый контент), `AGENTS.md` + `.cursor/.windsurf/.kiro/.qoder/.clinerules` + плагин-манифесты (форматы других агентов).

**Обновление (refresh):** перекопировать четыре `skills/ponytail*/SKILL.md` с закреплённого коммита. Усиливает [[feedback-reuse-first-unification]] и [[triplanio-ecc-toolkit]].
