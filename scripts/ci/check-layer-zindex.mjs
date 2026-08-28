#!/usr/bin/env node
/**
 * CI guard 2af (TRIP-466) — полноразмерный слой обязан назвать свой уровень.
 *
 * ДЕФЕКТ, РАДИ КОТОРОГО ГАРД СУЩЕСТВУЕТ. `position: relative` НЕ создаёт стековый
 * контекст. Поэтому позиционированный слой-подложка без объявленного `z-index`
 * («растянут на весь кадр» = `position:absolute` + все четыре стороны) конкурирует
 * за порядок отрисовки не с содержимым СВОЕГО кадра, а с чужими соседями по первому
 * стековому контексту выше по дереву. По спеке положительный z-index соседа
 * выигрывает, и десктоп так и рисует — поэтому дефект невидим ровно там, где его
 * ищут. Но как только движок выносит слой в СВОЙ композитный слой (`<img>` с
 * декодированным битмапом внутри scroll-snap-скроллера, внутри тела с
 * `-webkit-overflow-scrolling`, внутри предка с `transform` — каждого признака
 * достаточно, и все три собраны в мобильном шите), слой всплывает над всем, у чего
 * своего контекста нет. z-index в этот момент не проигрывает — он не участвует.
 *
 * Живой инцидент: `.cover__img` (примитив <Cover>) не объявлял уровень, и на iOS
 * Safari обложка планировщика накрывала скрим, стрелки, кнопку загрузки и
 * НАЗВАНИЕ ТРИПА — то есть единственный ввод имени во всём флоу создания. Ровно
 * ПОСЛЕ подмены фоллбека реальным пресетом: фоллбек — это CSS-фон, не элемент,
 * композитить нечего. Семья карточки (`.tc__img { z-index: 0 }`, скрим 2, контент 3)
 * этот контракт несла с самого начала и дефекта не знала; при переносе обложки в
 * примитив перенесли скрим и контент, а слой картинки назвать забыли.
 *
 * ЧЕГО НИ ОДИН СУЩЕСТВУЮЩИЙ ГАРД НЕ ВИДЕЛ. 2p сравнивает объявления база↔HEAD — а
 * пропущенного объявления нет с ОБЕИХ сторон, для него ничего не менялось. 2o
 * считает классы/токены/инлайны — уровень слоя не число из его списка. 2k/2m/2n
 * про имена и значения, не про порядок отрисовки. Сборка зелёная, тесты зелёные,
 * скриншот на десктопе правильный — дефект видно ТОЛЬКО на устройстве, которое
 * решило композитить. Поэтому предикат и живёт в CI, а не в чьей-то голове.
 *
 * ПРЕДИКАТ. Правило считается ПОЛНОРАЗМЕРНЫМ СЛОЁМ, если у него есть
 * `position: absolute|fixed` И заданы все четыре стороны — через `inset` (одно
 * значение или четыре) либо через `top`+`right`+`bottom`+`left`. Такой слой обязан
 * объявить `z-index`. Значение неважно: `0` ничем не хуже `4` — важно, что уровень
 * НАЗВАН, потому что названный уровень создаёт стековый контекст и запирает
 * промоушен внутри.
 *
 * ХРАПОВИК, А НЕ АБСОЛЮТНЫЙ ИНВАРИАНТ. На момент заведения в дереве 29 таких слоёв
 * без уровня (14 в `src/design/app.css`, 15 в `public/site.css`) — половина из них
 * безобидна, потому что рядом просто нет оверлеев. Красить их все значит либо
 * править 26 мест вслепую одним PR, либо выключить гард. Поэтому счёт на изменённых
 * файлах не может ВЫРАСТИ относительно базы: новые слои рождаются названными,
 * старые чинятся по мере того, как их файлы трогают. Как 2l: потолок живёт на
 * базовой ветке, а не в файле, который PR может отредактировать.
 *
 * ЧЕГО ГАРД НЕ ЛОВИТ — названо честно, иначе «OK» печатается над непроверенным:
 *   • ВТОРУЮ половину инварианта — «кадр с оверлеями обязан быть их стековым
 *     КОРНЕМ» (`isolation: isolate`). Кто кому кадр, из CSS не выводится: это
 *     свойство ДЕРЕВА, а разметка живёт в JSX. Половина закрыта правилом в
 *     CLAUDE.md и разбором в комментарии у `.cover`/`.tcp__hero`;
 *   • слой, растянутый не сторонами, а `width/height: 100%` при одной точке
 *     привязки: он тоже слой, но признак «полноразмерности» у него не механический,
 *     и требование дало бы ложные срабатывания на тултипах и поповерах;
 *   • всё, что назначает `position` из JS.
 *
 * ОБХОД. Слой, которому уровень объявлять нечем (например, он единственный ребёнок
 * и кадр изолирован явно) — маркер в комментарии CSS на строке правила или на любой
 * из трёх строк над ним:
 *
 *     /* layer-exempt: .x — единственный слой изолированного кадра *\/
 *
 * Тот же приём, что `inline-style-exempt` (2l) и `design-token-exempt` (2k):
 * виден в диффе, несёт причину рядом с кодом.
 *
 * Env: BASE_REF (default origin/dev). Неразрешимый ref → skipped, не угадывается.
 * Exit: 0 ok, 1 нарушение, 2 внутренняя ошибка.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const BASE_REF = process.env.BASE_REF || 'origin/dev';
const EXEMPT = 'layer-exempt';
const SCANNED = /\.css$/;
// Периметр — те же две зоны, что у 2p: приложение и сайтовая зона. Зона, которую
// гард не видит, ничем не отличается от зоны без гарда.
const PATHSPEC = ['src/', 'public/'];
// Сколько строк НАД правилом просматривать в поисках маркера: правило в этом репо
// обычно стоит под своим блок-комментарием, а он кончается на строке выше.
const MARKER_LOOKBEHIND = 3;

const unknown = process.argv.slice(2).filter((a) => a !== '--');
if (unknown.length) {
  console.error(`::error::check-layer-zindex: неизвестный флаг ${unknown.join(' ')}.`);
  console.error('  Ни --write, ни baseline-файла нет: потолок — базовая ветка.');
  process.exit(2);
}

const git = (args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

/* ------------------------------- разбор ---------------------------------- */

/** Гасим комментарии, сохраняя длину и переводы строк — смещения остаются
 *  валидными, а номера строк считаются по исходнику. Без этого журнальные
 *  комментарии `app.css`, которые ЦИТИРУЮТ селекторы и объявления, читались бы
 *  как правила: файл на 90% состоит из таких разборов. */
function blankComments(src) {
  const out = src.split('');
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      for (; i < stop; i++) if (src[i] !== '\n') out[i] = ' ';
      i--;
    }
  }
  return out.join('');
}

const has = (body, prop) => new RegExp(`(^|[;{\\s])${prop}\\s*:`).test(body);
/** Значение свойства (последнее объявление выигрывает, как в каскаде). */
const valueOf = (body, prop) => {
  const m = [...body.matchAll(new RegExp(`(?:^|[;{\\s])${prop}\\s*:([^;}]*)`, 'g'))].pop();
  return m ? m[1].trim() : null;
};

/**
 * Растянут ли слой по ОБЕИМ осям — через `inset` или через четыре стороны.
 *
 * `auto` хотя бы в одной позиции означает «привязан, а не растянут»: `inset: 0 0
 * auto 0` — это полоса сверху, `inset: 50% auto auto 50%` — точка. Такие слои
 * подложками не являются, и требовать у них уровень значило бы красить тултипы
 * и метки (в дереве их сегодня 8 — они бы раздули базу храповика, то есть
 * ОСЛАБИЛИ его: чем больше «нарушений» в базе, тем больше можно добавить,
 * не превысив её).
 */
const STRETCHED = (v) => v !== null && !/\bauto\b/.test(v);
function isFullBleed(body) {
  if (has(body, 'inset')) return STRETCHED(valueOf(body, 'inset'));
  return ['top', 'right', 'bottom', 'left'].every((p) => STRETCHED(valueOf(body, p)));
}

/**
 * Полноразмерные слои без объявленного уровня. Возвращает { count, hits } —
 * hits нужны только для сообщения об ошибке, судит счёт.
 */
function scan(src) {
  if (!src) return { count: 0, hits: [] };
  const masked = blankComments(src);
  const lines = src.split('\n');
  const lineOf = (idx) => src.slice(0, idx).split('\n').length - 1;

  const hits = [];
  for (const m of masked.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const body = m[2];
    if (!/position\s*:\s*(absolute|fixed)/.test(body)) continue;
    if (!isFullBleed(body)) continue;
    if (has(body, 'z-index')) continue;

    const at = lineOf(m.index + m[1].length); // строка с `{`
    const from = Math.max(0, at - MARKER_LOOKBEHIND);
    if (lines.slice(from, at + 2).some((l) => l.includes(EXEMPT))) continue;

    // Селектор печатаем из ИСХОДНИКА: в masked он затёрт пробелами, если стоял
    // после комментария на той же строке.
    const sel = src.slice(m.index, m.index + m[1].length).split('\n').pop().trim();
    hits.push({ line: at + 1, sel: sel.slice(0, 90) });
  }
  return { count: hits.length, hits };
}

/* --------------------------- что тронул этот PR --------------------------- */

try {
  git(['rev-parse', '--verify', `${BASE_REF}^{commit}`]);
} catch {
  console.log(`check-layer-zindex: BASE_REF ${BASE_REF} не разрешается — пропуск (shallow clone / свежий форк).`);
  process.exit(0);
}

// Всё ниже — относительно корня репо. Запуск из подкаталога без этого нашёл бы
// ноль файлов и напечатал OK: «нечего проверять» не должно выглядеть как «чисто».
process.chdir(git(['rev-parse', '--show-toplevel']).trim());

let touched;
try {
  touched = git(['diff', '--name-status', '--find-renames', `${BASE_REF}...HEAD`, '--', ...PATHSPEC])
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, a, b] = line.split('\t');
      if (status.startsWith('R')) return { path: b, base: a };
      if (status.startsWith('D')) return null;
      return { path: a, base: status === 'A' ? null : a };
    })
    .filter((f) => f && SCANNED.test(f.path));
} catch (e) {
  console.error(`::error::check-layer-zindex: не могу сдиффить против ${BASE_REF}: ${e.stderr || e.message}`);
  process.exit(2);
}

const baseContent = (path) => {
  if (!path) return null;
  try {
    return git(['show', `${BASE_REF}:${path}`]);
  } catch {
    return null;
  }
};

/* -------------------------------- вердикт --------------------------------- */

const errors = [];
let scanned = 0;

for (const file of touched) {
  if (!existsSync(file.path)) continue; // удалён между HEAD и рабочим деревом
  const now = scan(readFileSync(file.path, 'utf8'));
  const was = scan(baseContent(file.base));
  scanned++;

  if (now.count > was.count) {
    // Печатаем РАЗНИЦУ по селектору, а не «последние N хитов»: слой, добавленный
    // в начало файла, назывался бы чужим именем, и разработчик шёл бы чинить не
    // ту строку. Вранущий вывод в этом репо считается дефектом наравне с молчанием.
    const before = new Set(was.hits.map((h) => h.sel));
    const fresh = now.hits.filter((h) => !before.has(h.sel));
    const added = fresh.length ? fresh : now.hits;
    errors.push(
      `${file.path}: ${now.count} полноразмерн. слоёв без z-index, ` +
      `${file.base ? `${was.count} на ${BASE_REF}` : 'новый файл (база 0)'}` +
      added.map((h) => `\n      ${file.path}:${h.line}  ${h.sel}`).join('') +
      '\n    → назови уровень слоя: `z-index: 0` для подложки (как `.tc__img`), свой номер для оверлея.' +
      '\n      Слой без уровня объявлен в ЧУЖОМ стековом контексте и на мобильном движке' +
      '\n      всплывает над кадром, как только его промоутят в композитный слой.' +
      `\n      Если уровень объявлять нечем — /* ${EXEMPT}: <причина> */ рядом с правилом.`,
    );
  }
}

if (errors.length) {
  console.error('::error::check-layer-zindex: полноразмерных слоёв без объявленного уровня стало больше');
  errors.forEach((e) => console.error(`  ✗ ${e}`));
  process.exit(1);
}

console.log(
  scanned
    ? `check-layer-zindex: ${scanned} изменённых CSS-файл(ов) сверено с ${BASE_REF} — OK`
    : `check-layer-zindex: CSS против ${BASE_REF} не тронут — проверять нечего`,
);
