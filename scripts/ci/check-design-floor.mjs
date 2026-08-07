#!/usr/bin/env node
/**
 * CI guard 2o (TRIP-337 Ф0) — the design floor: no headline number may grow.
 *
 * WHY THIS IS THE FIRST THING BUILT. The previous attempt failed in a specific,
 * repeatable way: classes went down, namespaces went UP by 8, and the report
 * quoted the first number. Nobody lied — the metric that was watched improved.
 * A floor that ratchets EVERY number AT ONCE makes that failure mechanically
 * impossible, which is why it has to exist before a single class is touched.
 *
 * `audit-design.mjs` has been able to count all of this for a while. It just
 * printed a report, and a report is a thing you can decline to read.
 *
 * ── HOW THE CEILING IS ESTABLISHED ──
 * The SAME `audit-design.mjs` — the one sitting next to this file, resolved
 * from `import.meta.url`, never the base branch's copy — is run twice: once
 * against a detached worktree of BASE_REF, once against the working tree. One
 * instrument, both sides: change the instrument and BOTH numbers move together,
 * so simply lowering the counts buys nothing.
 *
 * That is ALMOST a closed door, and the gap is worth naming rather than
 * overclaiming: an edit that under-counts by a feature which exists only on
 * HEAD (say, "ignore classes in files added this PR") moves one side and not
 * the other, and would go green on real growth. What holds that shut is not
 * this guard — it is that the edit must appear in `audit-design.mjs`, in the
 * diff, under 43 tests. Cheap to see, hard to do by accident.
 *
 * Running this checkout's script also sidesteps the fact that the base worktree has no
 * `node_modules`: the script that executes is always this checkout's, so its
 * `acorn` import resolves from this checkout.
 *
 * NO COMMITTED BASELINE. A ceiling the PR can edit is not a ceiling — 2l
 * shipped green with three bypasses built on exactly that, and said so in its
 * own header: "a count alone is bypassable".
 *
 * ── THE METRIC SET IS A TABLE, NOT FOUR BRANCHES ──
 * The word "four" appears nowhere in the logic, which is why subtask 03 added
 * the fifth number as ONE ROW here and one field in `audit-design.mjs --json`.
 *
 * ── THE FIFTH NUMBER: CLASSES UNDER REVIEW (TRIP-340) ──
 * `src/design/catalog.json` files every class family as `canon` (the system's
 * language) or `triage` (under review); the ratchet is the number of CLASSES
 * living in `triage` families. Status on the family, count on the classes —
 * deliberately different units, because a family-level ratchet cannot see the
 * correct move until its LAST class leaves, while renaming `.bgt-row` onto
 * `.row` reads `-1` here immediately. The predicate that drafts the file, and
 * why the obvious one inverts the answer, is in `audit-design.mjs` §1d.
 *
 * Three things about the catalog are checked here rather than assumed, because
 * each of them produces a number that measured something other than what it
 * says: an unfiled family (understates), a stale entry (fiction), and an
 * invalid status — which is the nasty one, since a typo is not `triage` and so
 * the number FALLS. That is the epic's signature failure ("improve the number
 * you watch by changing what it counts") arriving for the fifth time.
 *
 * A `triage → canon` re-labelling lowers the number with no work done. It is a
 * legal move, so it is not blocked — it is PRINTED, every time, because the
 * defence is that it costs a visible line in front of a reviewer.
 *
 * ── THE TOKEN PREDICATE (Р8), AND THE HOLE IT LEAVES OPEN ON PURPOSE ──
 * A token is a name declared in `:root` — visible from everywhere. Not counted:
 * the 88 `:root[data-theme=dark]` re-pointings (zero new names), and a variable
 * on a variant (`.btn--primary{--x:…}`, `.tile--xl`, `.pt-itin{--num,--gap}`;
 * 40 such rules in app.css alone) — that is law 3 done right, and phases 04–06
 * produce them by the handful, so counting them would make the floor a brake on
 * the correct move.
 *
 * ⚠ THE KNOWN HOLE, STATED SO IT IS NOT SILENT: a private dictionary inside a
 * token island escapes the predicate — login.css `.auth` holds 4 names of its
 * own (`--font-body` is a private twin of `--font-sans`, both TRIP-165) and
 * PublicTrip.css `.pt-itin` 2. It is not this subtask's to close: login.css is
 * outside the perimeter until subtask 10, at which point those names either
 * collapse or move into `:root` and fall under this floor by themselves. Until
 * then the guard PRINTS them on every run without blocking.
 *
 * ── WHERE IT DIFFERS FROM 2l / 2m, DELIBERATELY ──
 * An unresolvable BASE_REF makes those guards SKIP, and that is right for them:
 * they judge a per-file diff, so with no base there is genuinely nothing to
 * judge. Here it is the opposite — with no base the floor is not holding, and
 * printing "OK" would say that it is. So: RED. Same for a tree the audit cannot
 * parse (`parseFailures`): unparsed JSX under-counts classes, which is a false
 * red on the base side and a false GREEN on the head side. "Nothing to check"
 * and "checked, clean" must never print the same verdict.
 *
 * ── ESCAPE ──
 * Same idiom as 2m's `prefix-exempt` — a marker carrying its reason, visible in
 * the diff at review time, because that visibility IS the approval flow:
 *
 *     floor-exempt: classes +3 — примитивы раскладки Ф3, апрув Pavel
 *
 * ★ ФОРМА ОДНА НА ВСЕ ДЕВЯТЬ ЧИСЕЛ, И ЗНАК СВЕРЯЕТСЯ. `+N` — это ВЕЛИЧИНА
 * РАЗРЕШЁННОГО НАРУШЕНИЯ, а не дельта метрики: у семи убывающих нарушение это
 * рост, у двух растущих (`axes`, `dsshare`) — падение, и обе пишутся `+N`.
 * Автор не обязан помнить направление каждого числа. `-N` и маркер БЕЗ знака
 * роняют гард с кодом 2 одинаково: знак ловится НЕОБЯЗАТЕЛЬНЫМ ровно затем,
 * чтобы `dsshare 25` не потерялся молча — иначе это тот же отказ «опечатка =
 * ноль бюджета», ради которого неизвестное ИМЯ метрики роняет гард, только на
 * шаг раньше.
 *
 * Read from the ADDED LINES of the diff, not from the file contents. That makes
 * the allowance last exactly one PR: once merged the line is no longer an
 * addition, so it cannot silently grant the same budget again. A marker naming
 * a metric that does not exist is an ERROR, not a no-op — a typo must not read
 * as "no exemption requested".
 *
 * NOTE the asymmetry, which only shows up locally: the NUMBERS come from the
 * working tree (so you can iterate without committing), the ALLOWANCES from the
 * committed diff (so an inherited marker cannot grant twice). In CI the two are
 * the same tree. Locally an uncommitted marker is not yet seen — the run goes
 * red until you commit it, which is the safe direction to be wrong in.
 *
 * Zero judgement calls live here: the counting is someone else's script, this
 * runs it twice and subtracts.
 *
 * Env: BASE_REF (default origin/dev). Exit: 0 ok, 1 violation, 2 cannot measure.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_REF = process.env.BASE_REF || 'origin/dev';
const EXEMPT = 'floor-exempt';
const AUDIT = fileURLToPath(new URL('./audit-design.mjs', import.meta.url));

/** key → the `audit-design.mjs --json` field it reads. The key is what an
 *  exemption marker names, so it is part of the contract and does not get
 *  renamed casually. Numbers on dev @ 6a659c8 (TRIP-337 §2) in the comments. */
const METRICS = [
  { key: 'classes', field: 'classes', label: 'классов' }, //                    1341
  { key: 'namespaces', field: 'namespaces', label: 'пространств имён' }, //      124
  { key: 'inline', field: 'inlineAll', label: 'инлайнов style={{…}}' }, //       694
  { key: 'tokens', field: 'rootTokens', label: 'токенов в :root' }, //           163
  // TRIP-340 PR1. `null` is legal on the BASE side and only there — see `bootstrap`.
  { key: 'triage', field: 'triageClasses', label: 'классов на разборе', bootstrap: true }, // 1127
  // TRIP-364. Экран дотянулся внутрь примитива и ОБЪЯВИЛ свойство (закон 3).
  // ТОЛЬКО «не расти»: убывание — работа 06, и фиксировать её объём этим числом
  // нельзя. Из числа вычтен со-селекторный канон типографики — иначе храповик
  // считал бы долгом собственный механизм ДС (см. audit-design.mjs, §12 Б).
  { key: 'reach', field: 'reachViolations', label: 'экран дотянулся в примитив' }, // 53
  /** TRIP-364 PR-I. Записи `apart` в каталоге — обличья, объявленные ВНЕ осей.
   *  ЗАЧЕМ СЕДЬМОЕ ЧИСЛО. apart не храповился ничем: он живёт внутри 2q, а пол
   *  про него не знал. Значит любое уникальное исполнение клалось туда с
   *  красивой причиной, и ни одно число не краснело - дверь ровно того класса,
   *  ради закрытия которого пол и написан (тот же провал, что «снизили классы,
   *  вырастили пространства имён на 8»). Шапка каталога сама обещает про этот
   *  список «обязан пустеть»; обещание без храповика и есть непроверяемая
   *  строка.
   *  ★ `bootstrap` стоит по той же причине, что у пятой: без каталога `apart`
   *  отдаётся `null`, а `null` без этого флага даёт вердикт «метрика и аудит
   *  разошлись» - сообщение про совсем другую поломку. Половина «на базе `null`
   *  законен» сегодня сработать уже НЕ МОЖЕТ (каталог есть на каждой базе с
   *  TRIP-340) - флаг покупает вторую половину: удаление каталога на HEAD
   *  краснеет своими словами, а не чужими. */
  { key: 'apart', field: 'apartEntries', label: 'обличий вне осей (apart)', bootstrap: true }, // 2
  /** TRIP-364 PR-I. Семьи, объявившие оси. ★ЕДИНСТВЕННАЯ МЕТРИКА «ТОЛЬКО ВВЕРХ»,
   *  и заведена она против дыры в СЕДЬМОЙ. `apart` понижается ДЕ-ДЕКЛАРАЦИЕЙ:
   *  убери семью из `axes` вместе с её записями в `apart` - apart упадёт, а оба
   *  гарда останутся зелёными (2q семью без ключа в `axes` не проверяет вовсе,
   *  2o увидит честный минус). Число понижалось бы изменением того, ЧТО ОНО
   *  СЧИТАЕТ - тот же провал, что «снизили классы, вырастили пространства имён»,
   *  только с третьей стороны. Печатать его мало: печатное число никто не
   *  смотрит, а храповик краснеет. */
  { key: 'axes', field: 'axesFamilies', label: 'семей под осями', bootstrap: true, up: true }, // 5
  /** ★ TRIP-337 §1. ГЛАВНОЕ ЧИСЛО ЭПИКА, ДЕВЯТОЕ по счёту: доля элементов
   *  интерфейса, взятых из ДС, в сотых долях процента. Предикат — в
   *  `audit-design.mjs` §1e, там же названы четыре границы, которых он не видит.
   *  Вторая метрика «только вверх» (первой была `axes`), поэтому направление
   *  здесь — то же поле `up`, а не второй флаг: два способа сказать одно в одной
   *  таблице разъезжаются ровно тогда, когда третий автор выберет не тот.
   *  `nullable` — знаменатель может быть нулём (дерево без единого элемента
   *  интерфейса); это законно на ОБЕИХ сторонах и проверяется ниже отдельно, а
   *  не флагом `bootstrap`: «мерить нечего» и «каталога нет» — разные факты. */
  { key: 'dsshare', field: 'dsShareBp', label: 'собрано из ДС (bp)', up: true, nullable: true }, // 2313
];

/* ★ НАПРАВЛЕНИЕ - ПОЛЕ ТАБЛИЦЫ (`up`), А НЕ ВЕТКА `if`, И ПОЛЕ РОВНО ОДНО.
 * Семь метрик отвечают на вопрос «не выросло ли», две (`axes`, `dsshare`) - на
 * обратный. Второй флаг того же смысла был написан и снят при ребейзе:
 * `direction: 'up'` рядом с `up: true` разъезжается ровно тогда, когда третий
 * автор выберет не тот, а таблица метрик - место, где этого никто не заметит.
 *
 * ★★ ФОРМА МАРКЕРА ОТ НАПРАВЛЕНИЯ НЕ ЗАВИСИТ: `+N` = величина разрешённого
 * НАРУШЕНИЯ. Обратный вариант («у растущей объявляется падение, значит `-N`»)
 * был реализован и отвергнут: он заставляет автора помнить направление каждого
 * числа, а это тот самый класс ошибки, который пол и закрывает. Строгость от
 * этого не пострадала - см. `allowances()`: и `-N`, и маркер БЕЗ знака роняют
 * гард с кодом 2, то есть «опечатка = тихий ноль бюджета» закрыта с обеих сторон.
 *
 * ★★★ И СЛЕДСТВИЕ, КОТОРОЕ НАДО ЗНАТЬ ЗАРАНЕЕ: `dsshare` - первая метрика,
 * которая краснеет на ОБЫЧНОЙ продуктовой работе. Новый экран, написанный сырой
 * разметкой, опускает долю, даже если он безупречен. Для эпика это цель; для
 * соседнего PR - строка `floor-exempt: dsshare +N` с причиной. */

/* ★ WHAT `bootstrap: true` ABOVE BUYS, AND ONLY FOR THE SIDE THAT NEEDS IT.
 * `null` means "there is no catalog", and that is a different fact from 0.
 * On the PR that introduces the catalog the base branch has no file, so the
 * fifth metric has no ceiling yet — that run prints "пол установлен этим PR"
 * instead of a delta, and passes. On HEAD `null` is always RED: after the
 * catalog merges, "no catalog" can only mean someone deleted it, and deleting
 * the file must not be a way to switch a metric off. Same rule as everywhere
 * in this guard: "nothing to check" and "checked, clean" get different words. */

const die = (msg, extra = []) => {
  console.error(`::error::check-design-floor: ${msg}`);
  extra.forEach((l) => console.error(`  ${l}`));
  process.exit(2);
};

const unknown = process.argv.slice(2).filter((a) => a !== '--');
if (unknown.length) {
  die(`unknown flag ${unknown.join(' ')}.`, [
    'There is no baseline to refresh and no --write: the ceiling is the base branch.',
  ]);
}

const git = (args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

/* ------------------------------- measuring -------------------------------- */

/** Run the audit over `<cwd>/src`. AUDIT_ROOT stays the RELATIVE 'src' and the
 *  cwd moves instead, so both sides see identical relative paths — the audit's
 *  OUT_OF_SCOPE test matches on the path, and an absolute temp path could
 *  otherwise classify files differently on the two sides. */
function measure(cwd, side, isBase, canonFamilies) {
  const r = spawnSync(process.execPath, [AUDIT, '--json'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    // ★ HEAD меряется КАНОН-НАБОРОМ БАЗЫ (TRIP-364). Шестая метрика — «экран
    // дотянулся внутрь примитива» — зависит от каталога по построению: перевод
    // семьи `triage → canon` расширяет язык и тем самым ПОДНИМАЕТ число, хотя
    // не стоит ни строки CSS. Такая переклейка объявлена легальной, бесплатной
    // и никогда не блокируемой, поэтому храповик по «своему» каталогу краснел
    // бы на правильном ходе — а красный на правильном ходе гард выключают.
    // Одна мерка на обе стороны оставляет под наблюдением ровно правки CSS.
    env: { ...process.env, AUDIT_ROOT: 'src', ...(canonFamilies ? { AUDIT_CANON_FAMILIES: canonFamilies.join(',') } : {}) },
  });
  if (r.error) die(`cannot run audit-design.mjs on ${side}: ${r.error.message}`);
  if (r.status !== 0) die(`audit-design.mjs failed on ${side} (exit ${r.status})`, (r.stderr || '').split('\n'));

  let json;
  try {
    json = JSON.parse(r.stdout);
  } catch (e) {
    die(`audit-design.mjs printed unparseable JSON on ${side}: ${e.message}`);
  }

  // An unparsed file looks exactly like a file with no classes in it.
  if (json.parseFailures?.length) {
    die(`${side}: audit-design.mjs could not parse ${json.parseFailures.length} file(s), so the counts are understated`,
      json.parseFailures);
  }
  // A catalog that exists but cannot be read must NOT degrade into "no catalog":
  // that would make a stray brace a way to turn the fifth metric off.
  if (json.catalogError) die(`${side}: ${json.catalogError}`, ['Каталог есть, но не читается - это не «каталога нет».']);

  for (const m of METRICS) {
    const v = json[m.field];
    if (typeof v === 'number') continue;
    // `nullable` = «мерить нечего» - законное состояние ОБЕИХ сторон (дерево без
    // единого элемента интерфейса). Что это не способ метрику ВЫКЛЮЧИТЬ,
    // проверяется ниже, когда известны обе стороны: живая база + пустой HEAD.
    if (v === null && m.nullable) continue;
    if (v === null && m.bootstrap) {
      if (isBase) continue; // no ceiling yet — see the note under METRICS
      die(`HEAD: каталога нет (src/design/catalog.json), метрика «${m.label}» не измеряется`, [
        'На базе это законно ровно один раз - на PR, который каталог вводит.',
        'На HEAD это значит, что файл удалили, а удаление метрики - не способ её пройти.',
      ]);
    }
    die(`${side}: audit-design.mjs does not report \`${m.field}\` — the metric table and the audit have drifted apart`);
  }
  return json;
}

/* -------------------------------- exemptions ------------------------------ */

/** `floor-exempt: <key> +N — reason`, read from the lines this PR ADDS **under
 *  `src/`** — the same tree every metric is measured over, so the allowance sits
 *  next to the code it excuses, which is what makes it reviewable.
 *
 *  ★ THE PATHSPEC IS LOAD-BEARING, AND THIS GUARD PROVED IT ON ITSELF. Without
 *  it the whole repo is scanned, so ANY line mentioning the marker counts — and
 *  the very first thing that trips over that is this guard's own test file,
 *  which builds fixtures out of strings like `floor-exempt: klasses +9`. Guard
 *  2o therefore failed with exit 2 on the PR that introduced it. Milder half of
 *  the same hole: a marker in `memory/`, a doc or a script would have granted
 *  real budget over a tree it does not describe. 2l and 2m are immune for
 *  exactly this reason — they read markers only out of the files they scan. */
function allowances() {
  let diff;
  try {
    diff = git(['diff', '--unified=0', `${BASE_REF}...HEAD`, '--', 'src/']);
  } catch (e) {
    die(`cannot diff against ${BASE_REF}: ${e.stderr || e.message}`);
  }
  const byKey = new Map(METRICS.map((m) => [m.key, m]));
  const out = Object.create(null);
  /** ★ ОДНА ФОРМА МАРКЕРА НА ВСЕ ДЕВЯТЬ ЧИСЕЛ: `+N` — это ВЕЛИЧИНА РАЗРЕШЁННОГО
   *  НАРУШЕНИЯ, а не дельта метрики. У метрики «только вверх» нарушение — падение,
   *  поэтому `+N` там означает «падение на N согласовано». Автор не обязан
   *  помнить направление каждого числа — а это ровно тот класс ошибки, который
   *  пол и закрывает.
   *
   *  ★★ ЗНАК НЕОБЯЗАТЕЛЕН ДЛЯ РАЗБОРА И ОБЯЗАТЕЛЕН ДЛЯ ЗАЧЁТА, и разница
   *  принципиальная: требуй регулярка `\+`, маркеры `dsshare 25` и `dsshare -25`
   *  не находились бы ВОВСЕ — ноль бюджета МОЛЧА, то есть тот же отказ, ради
   *  которого неизвестное ИМЯ метрики роняет гард, только на шаг раньше. Поэтому
   *  знак ловится необязательным, а всё, что не `+`, роняет гард с кодом 2. */
  const re = new RegExp(`${EXEMPT}:\\s*([a-zA-Z][\\w-]*)\\s*([+-]?)(\\d+)`, 'g');
  for (const line of diff.split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    for (const m of line.matchAll(re)) {
      const metric = byKey.get(m[1]);
      if (!metric) {
        die(`exemption names an unknown metric \`${m[1]}\` — a typo must not read as "no exemption".`, [
          `known metrics: ${[...byKey.keys()].join(', ')}`,
          `the marker was: ${line.slice(1).trim()}`,
        ]);
      }
      if (m[2] !== '+') {
        const what = m[2] ? `не тот ЗНАК: ${m[2]}${m[3]}` : `НЕ НАЗВАН ЗНАК: ${m[3]}`;
        const dir = metric.up
          ? 'метрика может только РАСТИ, и `+N` тут означает согласованное ПАДЕНИЕ на N'
          : 'метрика может только УБЫВАТЬ, и `+N` означает согласованный РОСТ на N';
        die(`у исключения для \`${m[1]}\` ${what}: ${dir}.`, [
          `нужно: ${EXEMPT}: ${m[1]} +${m[3]} — причина + апрув`,
          `маркер был: ${line.slice(1).trim()}`,
          'Форма одна на все метрики: +N = величина разрешённого НАРУШЕНИЯ, а не дельта числа.',
          'Знак с ошибкой - это опечатка, а опечатка не должна читаться как «исключения не просили».',
        ]);
      }
      out[m[1]] = (out[m[1]] ?? 0) + Number(m[3]);
    }
  }
  return out;
}

/* --------------------------------- verdict -------------------------------- */

try {
  git(['rev-parse', '--verify', `${BASE_REF}^{commit}`]);
} catch {
  // NOT a skip — see the header. With no base there is no floor.
  die(`BASE_REF ${BASE_REF} is not resolvable, so the floor cannot be measured.`, [
    'This guard needs the full base branch: `git fetch --no-tags origin <base>` and',
    'actions/checkout with `fetch-depth: 0`. It deliberately does NOT skip: a floor',
    'that reports OK when it did not measure anything is worse than no floor.',
  ]);
}

// Everything below resolves from cwd — the worktree path, `src`, the diff
// pathspec. Run from a subdirectory without this and the guard measures nothing
// and calls it clean, which is precisely how 2l printed `0 changed file(s) — OK`
// on any amount of dirt.
const root = git(['rev-parse', '--show-toplevel']).trim();
process.chdir(root);

const exempt = allowances();

// `git worktree add` requires a path that does not exist yet, hence the child.
const holder = mkdtempSync(join(tmpdir(), 'design-floor-'));
const basePath = join(holder, 'base');

/** ★ CLEANUP HANGS OFF `exit`, NOT OFF `finally`. `die()` calls `process.exit`,
 *  and that does NOT unwind the stack — a `finally` is skipped on exactly the
 *  failure paths that leak (unparseable JSON, `parseFailures`, a missing metric
 *  field, the audit crashing on either side). The first version used `finally`
 *  and its test only covered the exit-1 path, which runs AFTER the block — so
 *  the test passed while the invariant it was named for was false. A leaked
 *  worktree poisons every later run in the same clone, and this repo is checked
 *  out once with a dozen long-lived sibling worktrees. */
process.on('exit', () => {
  try {
    git(['worktree', 'remove', '--force', basePath]);
  } catch {
    /* the add may never have happened */
  }
  rmSync(holder, { recursive: true, force: true });
});

try {
  git(['worktree', 'add', '--detach', basePath, BASE_REF]);
} catch (e) {
  die(`cannot check out ${BASE_REF} into a worktree: ${e.stderr || e.message}`);
}
const base = measure(basePath, `${BASE_REF} (base)`, true);
// Проверка стоит ДО замера HEAD: иначе HEAD успевает измериться СВОИМ каталогом,
// то есть ровно той меркой, которую этот `die` и объявляет негодной.
if (!Array.isArray(base.canonFamiliesUsed)) {
  die('base: audit-design.mjs не отдал `canonFamiliesUsed` — шестую метрику нечем мерить одной меркой');
}
const head = measure(root, 'HEAD', false, base.canonFamiliesUsed);

/** «Мерить нечего» законно только тогда, когда мерить нечего ОБЕИМ сторонам.
 *  Живая база и пустой HEAD - это не пустое дерево, это метрика, выключенная
 *  правкой: тот же закон, по которому удаление каталога роняет пятое число. */
for (const m of METRICS.filter((x) => x.nullable)) {
  if (typeof base[m.field] === 'number' && head[m.field] === null) {
    die(`HEAD: метрика «${m.label}» больше не измеряется, а на базе была ${base[m.field]}`, [
      'Пустое дерево - законное состояние, но не тогда, когда на базе элементы были.',
      'Выключить метрику правкой нельзя: «мерить нечего» и «померили, чисто» - разные вердикты.',
    ]);
  }
}

const rows = METRICS.map((m) => {
  const was = base[m.field];
  const now = head[m.field];
  const allowed = exempt[m.key] ?? 0;
  // `was === null` = this PR establishes the ceiling; there is nothing to be over.
  // ★ `up: true` меняет ЗНАК нарушения, а не смысл маркера: у метрики «только
  // вверх» проступок - ПАДЕНИЕ, а `floor-exempt: <key> +N` по-прежнему выдаёт
  // бюджет в N единиц движения В ЗАПРЕЩЁННУЮ сторону, какая бы она ни была.
  // `now === null` - «мерить нечего» у `nullable`-метрики: нарушения тут нет,
  // а что это не способ метрику ВЫКЛЮЧИТЬ, проверено выше сверкой обеих сторон.
  const moved = m.up ? was - now : now - was;
  return { ...m, was, now, allowed, over: was === null || now === null ? 0 : moved - allowed };
});

const width = Math.max(...rows.map((r) => r.label.length));
console.log(`check-design-floor (2o): HEAD vs ${BASE_REF}`);
for (const r of rows) {
  if (r.was === null && r.now === null) {
    console.log(`  ${r.label.padEnd(width)}  ${'—'.padStart(5)} → ${'—'.padStart(5)}  мерить нечего (это НЕ ноль)`);
    continue;
  }
  if (r.was === null) {
    console.log(`  ${r.label.padEnd(width)}  ${'—'.padStart(5)} → ${String(r.now).padStart(5)}  пол установлен этим PR`);
    continue;
  }
  const delta = r.now - r.was;
  const sign = delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : '=';
  const arrow = r.up ? '  ↑ может только расти' : '';
  const note = r.allowed ? `  (floor-exempt +${r.allowed})` : '';
  console.log(`  ${r.label.padEnd(width)}  ${String(r.was).padStart(5)} → ${String(r.now).padStart(5)}  ${sign}${note}${arrow}`);
}

/** ★ EVERY STATUS CHANGE IS PRINTED, ALWAYS. Re-labelling a family
 *  `triage → canon` drops the fifth number without a line of work being done —
 *  it is the one move that makes this metric look good for free. It is a legal
 *  move (an object CAN graduate into the system's language), so it is not an
 *  error; what it must never be is quiet. The whole defence is that it costs a
 *  line in `catalog.json` and a line here, in front of the reviewer.
 *
 *  The reverse (`canon → triage`) needs no policing: it RAISES the number and
 *  the ratchet catches it by itself. It is printed for symmetry, because a
 *  reviewer reading "why did triage grow" should not have to diff the file. */
const wasStatus = base.catalogStatuses ?? {};
const nowStatus = head.catalogStatuses ?? {};
const moved = Object.keys(nowStatus)
  .filter((f) => Object.hasOwn(wasStatus, f) && wasStatus[f] !== nowStatus[f])
  .sort();
if (moved.length) {
  console.log(`  ─ смена статуса в каталоге (${moved.length}):`);
  for (const f of moved) console.log(`      ${f}: ${wasStatus[f]} → ${nowStatus[f]}`);
  if (moved.some((f) => nowStatus[f] === 'canon')) {
    console.log('    Повышение в канон снижает «классов на разборе» БЕЗ работы над кодом.');
    console.log('    Это законно, но должно быть видно: сверь, что объект действительно стал языком системы.');
  }
}

/** The catalog must describe the tree it is measured over. All three ways it can
 *  stop doing that end in a number that measured something else — and one of
 *  them (an invalid status) makes it go DOWN, i.e. look like progress. Fixed by
 *  editing the catalog in this PR, so: a violation, not an "internal error". */
const catalogFaults = [
  ['семейство не размечено в каталоге', head.catalogMissing, 'добавь строку со статусом canon или triage'],
  ['в каталоге есть семейство, которого больше нет', head.catalogStale, 'удали строку'],
  ['неверный статус (не canon и не triage)', head.catalogInvalid, 'опечатка в статусе НЕ считается разбором - число падает само собой'],
].filter(([, list]) => list?.length);
if (catalogFaults.length) {
  console.error('::error::check-design-floor: каталог разошёлся с деревом - пятое число измерило не то, что называет');
  for (const [what, list, fix] of catalogFaults) {
    console.error(`  ✗ ${what} (${list.length}): ${list.join(' · ')}`);
    console.error(`      → ${fix} (src/design/catalog.json)`);
  }
  process.exit(1);
}

/** ★ ЕДИНСТВЕННЫЙ СПОСОБ ПОДНЯТЬ ДОЛЮ «СОБРАНО ИЗ ДС» БЕЗ РАБОТЫ - СВАЛИТЬ
 *  РАЗМЕТКУ ЭКРАНА В `design/**`: её теги уходят из знаменателя, доля растёт. Храповить
 *  это число НЕЛЬЗЯ - система законно растёт, и каждый новый примитив собран из
 *  сырых тегов; храповик тормозил бы ровно правильный ход. Поэтому оно
 *  ПЕЧАТАЕТСЯ рядом с долей: рост доли при скачке этого числа виден в одной
 *  строке. Обещание «2o напечатает переклейку каталога» тут не работает -
 *  разметка без классов каталогу невидима целиком. */
const implWas = base.dsShare?.implHost;
const implNow = head.dsShare?.implHost;
if (typeof implWas === 'number' && typeof implNow === 'number' && implWas !== implNow) {
  console.log(`  ─ сырых тегов внутри ДС (репорт, не блокирует): ${implWas} → ${implNow}`);
  if (implNow > implWas) {
    console.log('    Рост тут поднимает долю «собрано из ДС» БЕЗ работы над экранами: сверь,');
    console.log('    что это новый примитив системы, а не разметка экрана, уехавшая в design/.');
  }
}

// Non-blocking: names declared outside `:root` that `:root` does not have. Not
// vocabulary (a variant's own variable is law 3 done right), not this subtask's
// problem (login.css is outside the perimeter until subtask 10) — but printed,
// so the hole is not silent.
const priv = head.privateTokens ?? [];
if (priv.length) {
  const byFile = new Map();
  for (const t of priv) {
    for (const f of t.files) {
      if (!byFile.has(f)) byFile.set(f, []);
      byFile.get(f).push(t.name);
    }
  }
  const wasPriv = new Set((base.privateTokens ?? []).map((t) => t.name));
  const fresh = priv.filter((t) => !wasPriv.has(t.name)).map((t) => t.name);
  console.log(`  ─ вне :root (репорт, не блокирует): ${priv.length}${fresh.length ? `, новых: ${fresh.join(' · ')}` : ''}`);
  for (const [f, names] of [...byFile].sort()) console.log(`      ${f}: ${[...new Set(names)].sort().join(' · ')}`);
}

/** ★ A DEMOTION IS A VIOLATION EVEN THOUGH THE COUNT WENT DOWN.
 *  Move `--accent` from `:root` onto `.card` and the token line reads
 *  `163 → 162  -1` — a minus, i.e. progress. The vocabulary did not shrink by
 *  one; the NAME HID. This is precisely the failure the floor exists to stop
 *  ("lower the one being watched, grow the one that is not"), transposed onto
 *  the token axis, and a count-only ratchet cannot see it by construction.
 *
 *  The predicate is exact and cannot false-positive: the name was in `:root` on
 *  the base, is NOT in `:root` on HEAD, and STILL EXISTS in src/ under a class
 *  scope. Deleting a token outright is not a demotion (it stops existing —
 *  green, and it is the direction the epic wants). Moving it between two
 *  `:root` files is not one either. A name also defined in the dark `:root`
 *  cannot be demoted by touching only the light one — the set is keyed by name,
 *  so 88 of the 163 hold each other up; only "light-only" names can demote.
 *
 *  NO ESCAPE MARKER, DELIBERATELY. Under the 04–10 plan this is never a legal
 *  move: the direction is the opposite one, islands collapse INTO `:root` or
 *  disappear. And §5 of the epic says the composition of L0 does not change —
 *  so a real case for demoting a token is an argument about the epic, not
 *  something a line comment should be able to wave through. */
const headPrivate = new Set((head.privateTokens ?? []).map((t) => t.name));
const demoted = (base.rootTokenNames ?? []).filter((n) => headPrivate.has(n));
if (demoted.length) {
  console.error('::error::check-design-floor: токен ушёл из :root на класс — словарь не сократился, имя спряталось');
  for (const n of demoted) {
    const files = (head.privateTokens.find((t) => t.name === n)?.files ?? []).join(' · ');
    console.error(`  ✗ ${n}: был в :root на ${BASE_REF}, теперь только на классе (${files})`);
  }
  console.error('');
  console.error('  Число токенов при этом ПАДАЕТ, то есть выглядит как прогресс — это тот самый');
  console.error('  провал «снизили одно, вырастили другое» (TRIP-337 §4), только на токенной оси.');
  console.error('  По плану 04-10 такой ход не бывает легальным: направление обратное, островки');
  console.error('  схлопываются В :root или исчезают, а §5 говорит, что состав L0 не меняется.');
  console.error('  Поэтому escape-маркера здесь намеренно нет — случай обсуждается в эпике.');
  console.error('  Если токен больше не нужен - удали его, а не переноси на класс: это зелёный путь.');
  process.exit(1);
}

const broken = rows.filter((r) => r.over > 0);
if (broken.length) {
  console.error('::error::check-design-floor: пол пробит — см. TRIP-337 §4 и правило #6 в CLAUDE.md');
  for (const r of broken) {
    // У метрики «только вверх» проступок - падение, и печатать его как «+N»
    // значило бы соврать в единственной строке, которую читают.
    const moved = r.up ? r.was - r.now : r.now - r.was;
    console.error(
      `  ✗ ${r.label}: ${r.was} → ${r.now} (${r.up ? `упало на ${moved}` : `+${moved}`}${r.allowed ? `, разрешено +${r.allowed}` : ''})`,
    );
    if (r.key === 'dsshare') {
      console.error('      Эта метрика может только РАСТИ: экран, написанный сырой разметкой,');
      console.error('      опускает долю, даже если он безупречен (TRIP-337 §1, главное число эпика).');
    }
  }
  console.error('');
  console.error('  Пол храповит ВСЕ числа сразу именно затем, чтобы «классы снизили, пространства');
  console.error('  имён вырастили» перестало быть возможным (TRIP-337 §4). Снизить одно за счёт');
  console.error('  другого нельзя — это не размен, это тот самый провал прошлого захода.');
  console.error('');
  console.error('  Если рост согласован — пометь строку в этом же PR, причина и апрув в тексте:');
  console.error(`      /* ${EXEMPT}: ${broken[0].key} +${broken[0].over} — причина + апрув Pavel */`);
  process.exit(1);
}

console.log('  пол держится.');
process.exit(0);
