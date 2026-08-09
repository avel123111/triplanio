#!/usr/bin/env node
/**
 * CI guard 2s (TRIP-377, Ф0.1 эпика TRIP-374) — храповик ВВЕРХ: файл, у которого
 * прагма `// @ts-check` ДЕЙСТВОВАЛА на базовой ветке, не может её потерять.
 *
 * ЗАЧЕМ. Эпик «единая дверь в данные» переносит запись и чтение на контракт
 * (endpoint + типы ответа). Единственный слой, который поймает расхождение
 * «сервер отдаёт не то, что читает экран», — типы; но `checkJs` в проекте
 * ВЫКЛЮЧЕН, поэтому единственный вход в проверку — поштучная прагма в файле.
 * Прагма при этом ничем не удерживается: она снимается одной строкой, а прогон
 * `npm run typecheck` от этого ЗЕЛЕНЕЕТ (ошибок стало меньше — их стало
 * ноль), то есть регресс покрытия выглядит как успех. Это и есть предмет 2s.
 *
 * ЦЕНА `checkJs: true` — ЗАМЕР, а не оценка (пинованный `node_modules/.bin/tsc`
 * 5.9.3, `-p ./jsconfig.json --checkJs --noEmit`, замер 2026-08-09):
 *   · на периметре `jsconfig.json` (214 файлов программы) — 420 ошибок в 155 файлах;
 *   · на всём `src/` (include `src/**`, exclude только `node_modules`/`dist`) — 401 в 147.
 * Числа НАЗВАНЫ ОБА намеренно: «сколько стоит включить checkJs» не определено без
 * периметра, и подставить одно вместо другого легко. В постановке задачи стояло
 * 1366 — это ЗАМЕР ДРУГОГО ДЕРЕВА (до TRIP-388, где 21 компонент ДС получил
 * аннотации и снял сотни TS2739/TS2741). Отсюда же режим работы: `checkJs`
 * включается не флагом, а файлами — каждый обязан быть зелёным ПОСЛЕ настоящей
 * типизации, поэтому прагмы не ставятся пачкой «раз уж мы здесь».
 *
 * ★ ПРЕДИКАТ РАНЬШЕ ЧИСЛА. «Файл с `@ts-check`» тремя способами даёт ТРИ разных
 * числа на одном дереве, и никто при этом не ошибается:
 *   · греп по тексту                              — 22
 *   · греп + ведущий комментарий любого вида      — 10
 *   · СЕМАНТИКА TS (то, что реально проверяется)  —  9
 * Разница не хвостовая: 12 файлов лишь УПОМИНАЮТ `// @ts-check` в прозе
 * комментария (`AppHeader.jsx`, `icons.jsx`, `resolveAuthor.js`, …), а
 * `css-custom-props.d.ts` держит упоминание в БЛОЧНОМ комментарии, который TS
 * прагмой не считает вовсе. Считать текстом значило бы захраповить число, у
 * которого 13 единиц ничего не проверяют, и одновременно ПРОПУСТИТЬ настоящий
 * регресс: сдвинуть живую прагму под первый импорт — проверка выключена,
 * текстовое число не шелохнулось. Это ровно тот класс дефекта, что «понижение
 * метрики инлайнов без снятия инлайна» (TRIP-388 PR 4): предикат, чувствительный
 * к ФОРМЕ ЗАПИСИ, — дыра по построению.
 *
 * ПОЭТОМУ ПРЕДИКАТ ПОВТОРЯЕТ TS, а не грепает. Правило TS (`processCommentPragmas`
 * → `getLeadingCommentRanges(text, 0)`, `PragmaKindFlags.SingleLine`, «последняя
 * директива побеждает») проверено ПРОБОЙ на живом tsc 5.9.3 — файл с заведомой
 * ошибкой типов и прагмой в разных написаниях:
 *   `// @ts-check` первой строкой                      → ПРОВЕРЯЕТСЯ
 *   `//@ts-check` / `/// @ts-check` / `//   @ts-check`  → ПРОВЕРЯЕТСЯ
 *   `// @ts-check` после блочного комментария и пустой строки → ПРОВЕРЯЕТСЯ
 *   `// @ts-check` с текстом после                     → ПРОВЕРЯЕТСЯ
 *   `@ts-check` внутри БЛОЧНОГО комментария            → НЕ проверяется
 *   `// @ts-check` НИЖЕ первой строки кода             → НЕ проверяется
 *   `// TODO @ts-check` (не в начале комментария)      → НЕ проверяется
 *   `// @ts-check-foo`                                 → НЕ проверяется
 *   `// @ts-check` + ниже `// @ts-nocheck`             → НЕ проверяется (последняя побеждает)
 *
 * ЧТО СВЕРЯЕТСЯ. Правило одно и оно ПОФАЙЛОВОЕ: файл из базового набора, который
 * на HEAD ещё существует, обязан остаться в наборе HEAD. Агрегатное «число не
 * упало» СЛАБЕЕ и потому не блокирует, а печатается: его держат плоским, потеряв
 * прагму на одном файле и поставив на другом, — то есть регресс покрытия
 * закрывается новой работой. Пофайловое правило это называет поимённо.
 *
 * УДАЛЕНИЕ И ПЕРЕИМЕНОВАНИЕ. Переименование распознаётся (`--find-renames`), и
 * прагма проверяется по новому пути. Удаление файла из набора ВЫЧИТАЕТСЯ и
 * печатается отдельной строкой: снос экрана — законная работа, а «удали файл,
 * чтобы храповик не заметил» бессмысленно (вместе с файлом уходит и код).
 *
 * МАРКЕРА-ОБХОДА НЕТ НАМЕРЕННО — как у 2q. Законных поводов снять действующую
 * прагму ровно два, и оба закрыты механикой: переезд файла (рename) и его
 * удаление. Всё остальное — разговор, а не строка в диффе.
 *
 * ГРАНИЦЫ, названные вслух:
 *   · Прагма на файле, который tsc НЕ ЗАГРУЖАЕТ, инертна (программа = `include`
 *     из `jsconfig.json` + граф импортов). Гард этого не проверяет — для этого
 *     нужен прогон tsc, а джоба `guards` намеренно живёт без `npm ci`. Замер на
 *     вводящем PR: все 9 файлов набора программой загружены (`tsc --listFiles`).
 *   · Считаются только JS-семейные расширения. У `.ts`/`.d.ts` прагма не нужна
 *     (проверяются всегда), и их учёт раздувал бы храповик даром.
 *   · Сторона HEAD читается из РАБОЧЕГО ДЕРЕВА (отслеживаемые файлы), сторона
 *     базы — из `BASE_REF`. Локально это судит то, что у тебя на диске.
 *
 * Env: BASE_REF (по умолчанию origin/dev). Недостижимая база — КРАСНЫЙ (код 2), а
 * не пропуск: храповик, который ничего не измерил, не должен печатать «OK»
 * (урок пола 2o). Ноль файлов на HEAD — тоже код 2 по той же причине.
 * Exit: 0 ok, 1 нарушение, 2 внутренняя ошибка.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const BASE_REF = process.env.BASE_REF || 'origin/dev';
const SCANNED = /\.(jsx?|mjs|cjs)$/;
const ROOT = 'src/';

const unknown = process.argv.slice(2).filter((a) => a !== '--');
if (unknown.length) {
  console.error(`::error::check-ts-check: unknown flag ${unknown.join(' ')}.`);
  console.error('  Флагов у гарда нет: потолок живёт на базовой ветке, а не в файле, который правит PR.');
  process.exit(2);
}

const git = (args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

/* ------------------------------ the predicate ----------------------------- */

/**
 * Действует ли в файле `// @ts-check` — ровно по правилам TypeScript.
 *
 * TS смотрит ТОЛЬКО ведущие комментарии (до первого токена) и ТОЛЬКО
 * однострочные; из встреченных директив побеждает ПОСЛЕДНЯЯ. Каждое из этих
 * трёх условий проверено пробой на живом tsc (список написаний — в шапке).
 */
export function tsCheckEnabled(src) {
  let enabled = false;
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      i++;
    } else if (c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      const end = nl === -1 ? src.length : nl;
      // `@(\S+)` — как в singleLinePragmaRegEx у TS: имя директивы кончается на
      // первом пробеле, поэтому `@ts-check-foo` директивой НЕ является, а
      // `// @ts-check и почему` — является.
      const m = /^\/\/\/?\s*@(\S+)/.exec(src.slice(i, end));
      if (m && (m[1] === 'ts-check' || m[1] === 'ts-nocheck')) enabled = m[1] === 'ts-check';
      i = end + 1;
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
    } else {
      break; // первый токен — дальше TS директивы не ищет, и мы тоже
    }
  }
  return enabled;
}

/** Упоминание есть, а директива не действует — самый интересный вид регресса. */
const mentionsButInert = (src) => !tsCheckEnabled(src) && src.includes('@ts-check');

/* --------------------------------- sides ---------------------------------- */

try {
  git(['rev-parse', '--verify', `${BASE_REF}^{commit}`]);
} catch {
  console.error(`::error::check-ts-check: BASE_REF ${BASE_REF} не разрешается — измерить храповик нечем.`);
  console.error('  Это КРАСНЫЙ, а не пропуск: гард, который ничего не измерил, не должен печатать OK.');
  process.exit(2);
}

// Всё ниже — от корня репо (pathspec `src/`, чтение файлов). Запуск из
// подкаталога без этого нашёл бы ноль файлов и напечатал бы «OK».
process.chdir(git(['rev-parse', '--show-toplevel']).trim());

/** Файлы, где ВООБЩЕ встречается текст прагмы, — дешёвый отбор кандидатов. */
function candidates(rev) {
  try {
    const args = ['grep', '-l', '-I', '--fixed-strings', '@ts-check'];
    if (rev) args.push(rev);
    return git([...args, '--', ROOT])
      .split('\n')
      .filter(Boolean)
      .map((line) => (rev ? line.slice(rev.length + 1) : line))
      .filter((p) => SCANNED.test(p));
  } catch (e) {
    // git grep выходит 1, когда совпадений нет; всё остальное — авария.
    if (e.status === 1) return [];
    throw e;
  }
}

let baseSet;
let headSet;
let headInert;
try {
  baseSet = new Set(
    candidates(BASE_REF).filter((p) => tsCheckEnabled(git(['show', `${BASE_REF}:${p}`]))),
  );
  const head = candidates(null).filter((p) => existsSync(p));
  headSet = new Set(head.filter((p) => tsCheckEnabled(readFileSync(p, 'utf8'))));
  headInert = head.filter((p) => mentionsButInert(readFileSync(p, 'utf8')));
} catch (e) {
  console.error(`::error::check-ts-check: не смог прочитать дерево: ${e.stderr || e.message}`);
  process.exit(2);
}

/** Переименования: прагму спрашиваем по НОВОМУ пути, иначе переезд файла красный. */
let renamed = new Map();
let deleted = new Set();
try {
  for (const line of git(['diff', '--name-status', '--find-renames', `${BASE_REF}...HEAD`, '--', ROOT])
    .split('\n')
    .filter(Boolean)) {
    const [status, a, b] = line.split('\t');
    if (status.startsWith('R')) renamed.set(a, b);
    else if (status.startsWith('D')) deleted.add(a);
  }
} catch (e) {
  console.error(`::error::check-ts-check: не смог сравнить с ${BASE_REF}: ${e.stderr || e.message}`);
  process.exit(2);
}

/* -------------------------------- verdict --------------------------------- */

if (!headSet.size) {
  console.error('::error::check-ts-check: на HEAD не найдено НИ ОДНОГО файла с действующей прагмой `// @ts-check`.');
  console.error('  «Нечего проверять» и «проверено, чисто» не должны печатать один вердикт (TRIP-282).');
  process.exit(2);
}

const lost = [];
for (const path of baseSet) {
  const now = renamed.get(path) ?? path;
  if (deleted.has(path) || !existsSync(now)) continue; // удаление вычитается, см. шапку
  if (headSet.has(now)) continue;
  lost.push({ path, now, inert: mentionsButInert(readFileSync(now, 'utf8')) });
}

const gone = [...baseSet].filter((p) => deleted.has(p) || !existsSync(renamed.get(p) ?? p));
// Набор НОВЫХ путей: `headSet` состоит из них, а `renamed` ключуется СТАРЫМИ —
// сверка с ключами всегда ложна, и переехавший файл печатался бы «+ новым».
// Число при этом верное, врёт только строка, а ложное сообщение хуже пропуска.
const renamedTo = new Set(renamed.values());
const added = [...headSet].filter((p) => !baseSet.has(p) && !renamedTo.has(p));

console.log(
  `check-ts-check: файлов с действующей прагмой // @ts-check — ${baseSet.size} на ${BASE_REF} → ${headSet.size} на HEAD` +
    ` (${headSet.size - baseSet.size >= 0 ? '+' : ''}${headSet.size - baseSet.size})`,
);
if (added.length) console.log(`  + ${added.join(' · ')}`);
if (gone.length) console.log(`  − удалено вместе с файлом (не регресс): ${gone.join(' · ')}`);
if (headInert.length) {
  console.log(
    `  i упоминают «@ts-check» в прозе, но директивы не несут (${headInert.length}): ${headInert.join(' · ')}`,
  );
}

if (lost.length) {
  console.error('::error::check-ts-check: покрытие типами упало — файл потерял действующую прагму `// @ts-check`');
  for (const l of lost) {
    console.error(
      `  ✗ ${l.now}${l.now === l.path ? '' : ` (был ${l.path})`}: на ${BASE_REF} прагма действовала, на HEAD — нет.` +
        (l.inert
          ? '\n    → текст `@ts-check` в файле ЕСТЬ, но директивой не является: TS читает только ОДНОСТРОЧНЫЕ' +
            '\n      комментарии ДО первого токена, и побеждает ПОСЛЕДНЯЯ из @ts-check/@ts-nocheck.' +
            '\n      Верни `// @ts-check` первой строкой файла.'
          : '\n    → верни `// @ts-check` и почини типы, а не наоборот: прагма — единственный вход в' +
            '\n      проверку, пока `checkJs` выключен (цена включения записана в шапке гарда).'),
    );
  }
  process.exit(1);
}

process.exit(0);
