#!/usr/bin/env node
// ГАРД 2ag (блокирующий, инвариант по всему дереву): МИНУТНАЯ/ЧАСОВАЯ АРИФМЕТИКА
// НАД ДАТАМИ ЖИВЁТ ТОЛЬКО В `src/lib/time.js`.
//
// ЗАЧЕМ. Хранение времени наивное: `start_datetime` — настенное время города
// ОТПРАВЛЕНИЯ, `end_datetime` — города ПРИБЫТИЯ. Поэтому «вычесть одно из
// другого» даёт верный ответ везде, кроме межпоясного переезда, — а там врёт на
// разницу смещений (Порту 16:05 → Мадрид 18:15 это 1 ч 10 мин, не 2 ч 10 мин).
// Ошибку не видно: она не падает, не логируется и выглядит правдоподобным
// числом. Правило чинили трижды и трижды теряли, потому что чинили ВЫЗЫВАЮЩЕГО:
// к третьему разу арифметика жила пятью копиями (две с поясами, три без), и
// редизайн панели трансфера написал шестую с нуля. Гард не даёт завести седьмую.
//
// Что ловит (в `src/**`, кроме `src/lib/time.js` и `*.test.*`):
//   • `.diff(…, 'minutes')` / `'hours'` — люксоновская разность в этих единицах
//   • деление разности на `60000` / `3_600_000` — те же минуты и часы вручную
//
// ★ГРАНИЦА ВСЛУХ. Ловит ЕДИНИЦЫ, В КОТОРЫХ ПОЯСА РЕШАЮТ, а не всякое вычитание
// дат. `'days'`/`'weeks'` и `/ 86_400_000` — мимо НАМЕРЕННО: границы суток
// (`day_span`, ночи, номер дня) считаются по календарным датам и через пояса их
// прогонять как раз НЕЛЬЗЯ (см. шапку `src/lib/validation.js`). Сортировочные
// компараторы (`new Date(b) - new Date(a)`) — тоже мимо: там нет длительности.
// Значит, гард держит ПЕРИМЕТР одного правила, а не «всю работу с датами».
//
// Периметр — только `src/**`, И ЭТО ГРАНИЦА ПО ПОСТРОЕНИЮ, а не недосмотр: дом
// правила фронтовый (`src/lib/time.js`), edge-функции его импортировать не могут,
// и своей длительности сегодня не считают (проверено грепом по
// `supabase/functions/**`). Появится там показ длительности — ему нужен свой дом
// и своя строка тут, а не расширение этого периметра на чужое дерево.
//
// Escape: `// time-arith-exempt: <причина>` в той же строке.
//
// Стандартная библиотека, без git и `npm ci` (джоба `guards`).
// Exit: 0 чисто / 1 арифметика вне дома / 2 не смог измерить (нет дома, нет файлов).
//
// Гард — код, у него есть тест: `check-time-arithmetic.test.mjs` (temp-дерево,
// подпроцесс, код выхода). Зелёный тест ничего не значит, пока не увидел красным.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// argv[2] — необязательный корень скана (для теста гарда); по умолчанию `src`.
const TARGET = process.argv[2] ? resolve(process.argv[2]) : join(ROOT, 'src');
// Дом правила — относительный путь ВНУТРИ корня скана, чтобы тест мог поднять
// такой же дом у себя, а прод-запуск не зависел от совпадения имён файлов.
const HOME = 'lib/time.js';

// Люксоновская разность в минутах/часах. Единицу ищем до конца ВЫРАЖЕНИЯ, а не
// до первой закрывающей скобки: у первого аргумента запросто есть своя пара
// (`e.diff(s.startOf('hour'), 'minutes')`), и предикат «до первой `)`» такую
// строку молча пропускал — та же тихая дыра, ради которой гард и написан.
const UNIT_DIFF = /\.diff\b[^;\n]*['"](?:minutes|hours)['"]/;
// Те же минуты/часы, посчитанные делением миллисекунд руками.
const MS_DIV = /\/\s*(?:60_?000|3_?600_?000)\b/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx?|tsx?)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

const die = (msg) => { console.error(`::error::[check-time-arithmetic] ${msg}`); process.exit(2); };

if (!existsSync(TARGET)) die(`корень скана не найден: ${TARGET}`);
if (!existsSync(join(TARGET, HOME))) {
  die(`дом правила ${HOME} не найден под ${TARGET}. Если файл переехал — правь HOME в гарде, ` +
      `иначе инвариант измеряется не там, где живёт правило.`);
}

const files = walk(TARGET).filter((f) => relative(TARGET, f) !== HOME);
// «Нечего проверять» ≠ «проверено, чисто»: пустой скан = сломанный предикат.
if (!files.length) die(`под ${TARGET} нечего сканировать — предикат сломан.`);

const violations = [];
for (const file of files) {
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    if (line.includes('time-arith-exempt')) return;
    if (UNIT_DIFF.test(line) || MS_DIV.test(line)) {
      violations.push(`${relative(ROOT, file)}:${i + 1}: ${trimmed}`);
    }
  });
}

if (violations.length) {
  console.error(
    `[check-time-arithmetic] ${violations.length} мест(о) считает минуты/часы между датами ` +
    `мимо дома правила (src/${HOME}). Зови durationMinutes()/transferDuration() — они знают ` +
    `про пояса концов; если пояса тут ни при чём, пометь строку ` +
    `\`// time-arith-exempt: <причина>\`:\n`,
  );
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}

console.log(`[check-time-arithmetic] OK — минутная/часовая арифметика только в src/${HOME} (${files.length} файлов проверено).`);
