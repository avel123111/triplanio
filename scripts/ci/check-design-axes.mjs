#!/usr/bin/env node
/**
 * CI-гард 2q · ОСИ КАНОН-ОБЪЕКТА (TRIP-364, решение Pavel 2026-08-07 №1).
 *
 * ЧТО ЭТО. `src/design/catalog.json` объявляет у канон-семьи ОСИ - как объект
 * умеет выглядеть: «зазор», «поперёк», «вдоль», «перенос». Гард держит три
 * сверки между этим объявлением, CSS и разметкой.
 *
 * ЗАЧЕМ. Гард 2m блокирует новое СЕМЕЙСТВО (префикс). Новое обличье ВНУТРИ
 * существующего семейства - `.btn--compact`, `.tile--cozy` - проходит молча, а
 * `+1` класс в поле 2o закрывается одной строкой `floor-exempt`. Это ровно
 * записанный критерий провала эпика: «500 классов с сорока оттенками одной
 * кнопки - провал, формально уложившийся в цель». Оси переводят апрув на новое
 * обличье из слов в треде в СТРОКУ ДИФФА - тем же приёмом, каким `prefix-exempt`
 * сделал видимым апрув на новое семейство.
 *
 * ★ ВТОРАЯ ПОЛОВИНА, И ОНА ВАЖНЕЕ: ОСЬ БЕЗ ОБЪЯВЛЕНИЯ ПРОТЕКАЕТ МОЛЧА.
 * Лестница зазоров разрежена (`app.css`: ступени с нулём вызовов выпилены), и
 * цена записана там же: «тот, кто напишет `.row--g1`, не получит НИЧЕГО и не
 * узнает об этом - класса просто нет». Выстрелило ДВАЖДЫ: сперва `.col--g3`/
 * `.col--g8` тихо сели на дефолт 10px, потом `.row--g1`/`.col--g2`/`.grid--g1`.
 * Оба раза поймано ЗАМЕРОМ В БРАУЗЕРЕ, потому что несуществующий класс - это не
 * ошибка, а ТИШИНА, и её не видит ни один другой гард. Сверка C ниже делает эту
 * тишину красной.
 *
 * ТРИ СВЕРКИ (для семьи, объявившей оси):
 *   A. CSS → каталог. Класс `.<семья>--<хвост>` обязан быть значением
 *      объявленной оси либо стоять в `apart`. Иначе - новое обличье без апрува.
 *   B. каталог → CSS. Каждое объявленное значение обязано существовать
 *      правилом, иначе каталог врёт; а класс под ДЕФОЛТ существовать НЕ должен -
 *      он no-op и читается как «здесь особый отступ».
 *   C. разметка → каталог. Литерал `<семья>--<хвост>` в `.jsx/.tsx/.js/.ts/.html`
 *      обязан быть значением оси либо `apart`. Это и есть лечение тишины:
 *      `.grid--g1` в разметке теперь красный, а не молчаливый дефолт.
 *
 * ★ ПОЧЕМУ У 2q НЕТ МАРКЕРА-ОБХОДА. У всех соседних гардов выход - маркер в
 * диффе с причиной. Здесь обход И ЕСТЬ строка каталога: новое значение оси
 * добавляется в `catalog.json`, видно в диффе, обсуждается в ревью. Второй канал
 * («да, класс вне осей, но разрешите») вернул бы ровно ту дверь, ради закрытия
 * которой гард написан, и заодно рос бы в счётчике обходов.
 *
 * ★ ВХОД ДОБРОВОЛЬНЫЙ И ПОШТУЧНЫЙ. Семья без ключа в `axes` под сверку не
 * попадает вовсе. Это не дыра, а порядок работы: разбор обличий на оси -
 * содержательное решение по каждому объекту (`.btn--danger-solid` - это тон
 * `danger-solid` или тон + заливка?), и он делается с апрувом по одной семье за
 * PR. Гард обязан быть готов раньше, чем разобраны все четырнадцать.
 *
 * ⚠️ ГРАНИЦА, названную нельзя выдавать за большее: сверка C видит только
 * ЛИТЕРАЛЫ. Составное имя (`` `btn--${variant}` ``) собирается в рантайме, и
 * значение оси из него не прочитать - у `tile/sev/btn/avatar/dlg` такие есть, у
 * `row/col/grid` НЕТ НИ ОДНОГО (проверено прогоном). Поэтому раскладка идёт
 * первой: на ней механизм полон. Для семей с составными именами список значений
 * придётся брать из карты самого компонента - это работа 07, и она не
 * притворяется сделанной здесь.
 *
 * Env: AUDIT_ROOT (по умолчанию src) - периметр скана.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.env.AUDIT_ROOT || 'src';
const CATALOG = 'src/design/catalog.json';
const MARKUP = /\.(jsx|tsx|js|ts|html)$/;

const die = (msg, extra = []) => {
  console.error(`::error::check-design-axes: ${msg}`);
  extra.forEach((l) => console.error(`  ${l}`));
  process.exit(2);
};

/** Комментарии гасятся ПРОБЕЛАМИ той же длины (приём 2l/2n): длина и переводы
 *  строк сохраняются, поэтому номера строк остаются верными. `//` сразу после
 *  `:` или кавычки - это URL, а не комментарий (`https://…`, `src="//cdn…"`);
 *  ошибка здесь гасит остаток строки и прячет то, что за ним. */
const URLISH_BEFORE_SLASHES = [':', '"', "'", '`'];
function blankComments(src, lineComments) {
  const out = src.split('');
  for (let i = 0; i < src.length; i += 1) {
    if (lineComments && src[i] === '/' && src[i + 1] === '/' && !URLISH_BEFORE_SLASHES.includes(src[i - 1])) {
      while (i < src.length && src[i] !== '\n') out[i++] = ' ';
    } else if (src[i] === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      for (; i < stop; i += 1) if (src[i] !== '\n') out[i] = ' ';
      i -= 1;
    }
  }
  return out.join('');
}

function walk(root, hit) {
  if (!existsSync(root)) return;
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(root, e.name);
    if (e.isDirectory()) walk(p, hit);
    else hit(p);
  }
}

/* ------------------------------- каталог ---------------------------------- */

let catalog;
try {
  catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));
} catch (e) {
  // Непрочитанный каталог = «осей никто не объявлял» = зелёный прогон над пустой
  // комнатой. Самый дорогой из неверных ответов для этого гарда.
  die(`не читается ${CATALOG}: ${e.message}`);
}

const axes = catalog.axes || {};
const apart = catalog.apart || {};
const families = catalog.families || {};

/** Значения оси → сама ось, чтобы в сообщении назвать, ЧЕМ хвост объявлен. */
const declaredOf = (fam) => {
  const byTail = new Map();
  const defaults = new Map();
  for (const [axis, spec] of Object.entries(axes[fam] || {})) {
    for (const v of spec.значения || []) byTail.set(String(v), axis);
    if (spec.дефолт !== undefined) defaults.set(String(spec.дефолт), axis);
  }
  return { byTail, defaults };
};

/* Структурные ошибки каталога - код 2. Гард, считающий по кривому объявлению,
 * печатает верный вердикт по неверному вопросу.                              */
const structural = [];
for (const [fam, spec] of Object.entries(axes)) {
  if (families[fam] !== 'canon') structural.push(`${fam}: оси объявлены у семьи со статусом "${families[fam] ?? 'нет в каталоге'}", а не canon`);
  const seen = new Map();
  for (const [axis, a] of Object.entries(spec)) {
    if (!Array.isArray(a.значения) || !a.значения.length) structural.push(`${fam}.${axis}: пустой список значений - ось без значений не ось`);
    for (const v of a.значения || []) {
      if (seen.has(String(v))) structural.push(`${fam}: хвост "${v}" объявлен и в оси "${seen.get(String(v))}", и в "${axis}" - обличье не может принадлежать двум осям`);
      seen.set(String(v), axis);
    }
  }
  // Дефолт сверяется ВТОРЫМ проходом: `seen` наполняется по ходу первого, и
  // проверка «на месте» видела только свою ось. Дефолт оси «поперёк», стоящий в
  // значениях оси «зазор», даёт НЕУДОВЛЕТВОРИМЫЙ каталог - B требует завести
  // класс, а другая B требует его снести; это структурная ошибка (код 2), а не
  // вердикт по коду.
  for (const [axis, a] of Object.entries(spec)) {
    if (a.дефолт !== undefined && seen.has(String(a.дефолт))) {
      structural.push(`${fam}.${axis}: дефолт "${a.дефолт}" объявлен значением оси "${seen.get(String(a.дефолт))}" - дефолт это то, чего класс НЕ имеет`);
    }
  }
  for (const tail of Object.keys(apart[fam] || {})) {
    if (seen.has(tail)) structural.push(`${fam}: хвост "${tail}" числится и значением оси "${seen.get(tail)}", и в apart`);
  }
}
for (const fam of Object.keys(apart)) {
  if (!axes[fam]) structural.push(`${fam}: apart объявлен без axes - список исключений без правил, из которых исключают`);
}
if (structural.length) die('каталог осей объявлен некорректно', structural);

if (!Object.keys(axes).length) {
  // Осей нет вовсе - это законное состояние (гард приехал раньше разбора), но
  // печатать его надо словами, а не «OK» над пустой комнатой.
  console.log('check-design-axes (2q): ни одна семья не объявила оси — сверять нечего.');
  process.exit(0);
}

/* ------------------------- три источника фактов ---------------------------- */

const cssFiles = [];
const markupFiles = [];
walk(ROOT, (p) => {
  if (p.endsWith('.css')) cssFiles.push(p);
  else if (MARKUP.test(p)) markupFiles.push(p);
});
if (!cssFiles.length) die(`в ${ROOT} не найдено ни одного .css - периметр скана пуст`);

/** Классы, ОБЪЯВЛЕННЫЕ правилом (селектор), с первым местом. Комментарии сняты:
 *  иначе `.row--g1`, упомянутый в комментарии `app.css` про выпиленные ступени,
 *  сойдёт за существующий класс - та же грабля, что `--sp-9` на полу 2o. */
const cssClasses = new Map();
const cssStandalone = new Set();
for (const path of cssFiles) {
  const css = blankComments(readFileSync(path, 'utf8'), false);
  for (const rule of css.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    /** ★ ЗАХВАТ СЕЛЕКТОРА НАЧИНАЕТСЯ СРАЗУ ЗА ПРЕДЫДУЩИМ `}`, поэтому в него
     *  попадает и БЕСБЛОЧНОЕ at-правило - `@import './design/fonts.css';` стоит
     *  первой строкой `index.css`. Без среза по последнему `;` вердикт
     *  `startsWith('@')` выбрасывал ПРАВИЛО, ИДУЩЕЕ ЗА ИМПОРТОМ, целиком: его
     *  классы не видела ни сверка A (новое обличье прошло бы молча), ни сверка B
     *  (объявленное значение читалось бы как несуществующее). У `@media` блок
     *  есть, `;` в прелюдии нет - срез его не трогает и он по-прежнему пропущен. */
    const cut = rule[1].lastIndexOf(';') + 1;
    const head = rule[1].slice(cut);
    const sel = head.trim();
    if (!sel || sel.startsWith('@')) continue;
    /** ★★ СВЕРКА B СПРАШИВАЕТ «СТУПЕНЬ СУЩЕСТВУЕТ?», А ЭТО НЕ «ИМЯ ГДЕ-ТО ЕСТЬ».
     *  Правило `.te-x .row--g1 {}` работает ТОЛЬКО внутри `.te-x`: элемент с этим
     *  классом в любом другом месте молча получит дефолт - ровно та тишина, ради
     *  которой гард и написан. Поэтому существованием считается объявление БЕЗ
     *  КОНТЕКСТА ПРЕДКА: селектор из ОДНОЙ составной части (`.row--g4`,
     *  `.row.row--g3` - это один элемент). A и C по-прежнему считают по ВСЕМ
     *  вхождениям: там вопрос «законно ли такое имя вообще», и контекст на него
     *  не влияет.
     *  ★ Первая правка брала «последнюю составную часть» (подсказка ревью) и была
     *  КРАСНОЙ на своём же тесте: подлежащее у `.te-x .row--g1` - это и есть
     *  `.row--g1`. Предикат обязан отвечать на вопрос сверки, а не выглядеть
     *  правдоподобно. */
    for (const one of sel.split(',')) {
      const parts = one.trim().split(/\s*[>+~]\s*|\s+/).filter(Boolean);
      if (parts.length !== 1) continue;
      for (const c of parts[0].matchAll(/\.([A-Za-z][\w-]*)/g)) cssStandalone.add(c[1]);
    }
    for (const c of head.matchAll(/\.([A-Za-z][\w-]*)/g)) {
      if (cssClasses.has(c[1])) continue;
      /** ★ Строка считается до САМОГО КЛАССА, а не до начала матча: `[^{}]+`
       *  тянет и перевод строки после предыдущего `}`, и погашенный комментарий
       *  перед правилом, - отсчёт от `rule.index` уезжает ВВЕРХ (на `app.css` -
       *  на десятки строк, в середину чужого комментария). Гард, весь вывод
       *  которого «сходи посмотри на эту строку», обязан называть её точно. */
      const line = css.slice(0, rule.index + cut + c.index).split('\n').length;
      cssClasses.set(c[1], `${path}:${line}`);
    }
  }
}

/** Литералы разметки. Пробег МАКСИМАЛЬНЫЙ (`[A-Za-z_][\w-]*`), а не «начинается
 *  с имени семьи»: `te-row--plan` содержит `row--plan`, и предикат по подстроке
 *  назвал бы шесть чужих классов обличьями ряда. Проверено: именно так и вышло
 *  на первом прогоне. */
const markupUse = new Map();
for (const path of markupFiles) {
  const src = blankComments(readFileSync(path, 'utf8'), true);
  const lines = src.split('\n');
  lines.forEach((text, i) => {
    for (const m of text.matchAll(/[A-Za-z_][\w-]*/g)) if (!markupUse.has(m[0])) markupUse.set(m[0], `${path}:${i + 1}`);
  });
}

/* -------------------------------- сверки ---------------------------------- */

const problems = [];
let checkedValues = 0;
let checkedClasses = 0;
let checkedUses = 0;

for (const fam of Object.keys(axes)) {
  const { byTail, defaults } = declaredOf(fam);
  const held = new Set(Object.keys(apart[fam] || {}));
  const known = (tail) => byTail.has(tail) || held.has(tail);
  const prefix = `${fam}--`;

  // A. CSS → каталог
  for (const [cls, at] of cssClasses) {
    if (!cls.startsWith(prefix)) continue;
    checkedClasses += 1;
    const tail = cls.slice(prefix.length);
    if (known(tail)) continue;
    problems.push(
      defaults.has(tail)
        ? `A · ${at}  .${cls} — это ДЕФОЛТ оси «${defaults.get(tail)}»: объект несёт его сам, класс под него no-op и врёт, будто здесь особый случай`
        : `A · ${at}  .${cls} — обличье вне объявленных осей ${fam}. Либо значение оси в ${CATALOG}, либо apart с причиной`,
    );
  }

  // B. каталог → CSS
  for (const [tail, axis] of byTail) {
    checkedValues += 1;
    if (!cssStandalone.has(prefix + tail)) {
      problems.push(`B · ось «${axis}» объявляет ${fam}--${tail}, а правила .${prefix}${tail} нет — каталог обещает то, чего в CSS не существует`);
    }
  }
  for (const [tail, axis] of defaults) {
    if (cssClasses.has(prefix + tail)) {
      problems.push(`B · ${cssClasses.get(prefix + tail)}  .${prefix}${tail} объявлен, хотя это ДЕФОЛТ оси «${axis}» — класс-no-op читается как «здесь особый случай»`);
    }
  }

  for (const tail of held) {
    // apart обещает существующее ровно так же, как ось: иначе число «ждут
    // разбора», про которое сказано «обязано пустеть», становится фикцией.
    if (!cssStandalone.has(prefix + tail)) {
      problems.push(`B · apart числит ${fam}--${tail}, а правила .${prefix}${tail} нет — список исключений обещает несуществующее`);
    }
  }

  // C. разметка → каталог
  for (const [name, at] of markupUse) {
    if (!name.startsWith(prefix)) continue;
    checkedUses += 1;
    const tail = name.slice(prefix.length);
    if (known(tail)) continue;
    problems.push(
      defaults.has(tail)
        ? `C · ${at}  ${name} в разметке — это ДЕФОЛТ оси «${defaults.get(tail)}»: класса нет и не будет, элемент и так его получает`
        : `C · ${at}  ${name} в разметке — значения нет ни на одной оси ${fam}. Класс не существует: элемент МОЛЧА получит дефолт`,
    );
  }
}

const nAxes = Object.values(axes).reduce((n, spec) => n + Object.keys(spec).length, 0);
const nApart = Object.values(apart).reduce((n, o) => n + Object.keys(o).length, 0);
console.log('check-design-axes (2q): оси канон-объектов');
console.log(`  семей с осями: ${Object.keys(axes).length} · осей: ${nAxes} · значений: ${checkedValues}`);
console.log(`  сверено: классов ${checkedClasses} · имён в разметке ${checkedUses}`);
console.log(`  обличий вне осей (apart, ждут разбора): ${nApart}`);

if (problems.length) {
  console.log('');
  problems.sort().forEach((p) => console.log(`  ${p}`));
  console.error(
    `::error::check-design-axes: расхождений ${problems.length}. ` +
      `Апрув на новое обличье — это строка в ${CATALOG}, а не слова в треде; маркера-обхода у 2q нет намеренно.`,
  );
  process.exit(1);
}
console.log('  оси, CSS и разметка сходятся.');
