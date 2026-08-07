#!/usr/bin/env node
/**
 * РЕПОРТЁР обходов (TRIP-364, решение Pavel 2026-08-07 №3). НЕ ГАРД: ничего не
 * блокирует и всегда выходит нулём.
 *
 * ЗАЧЕМ. У каждого гарда есть законная дверь с причиной - и это правильно.
 * Не печатает их СУММУ никто. Десять законных строк за десять PR растворяют
 * гейт, и ни один прогон при этом не краснеет: каждый в отдельности обоснован,
 * а вместе они и есть та дыра, ради закрытия которой гарды писались. Смысл
 * репортёра в том, что цена стоит РЯДОМ С РЕЗУЛЬТАТОМ и видна в ревью.
 *
 * ★ ПОЧЕМУ НЕ ХРАПОВИК. Храповик на исключениях заблокировал бы легитимный ход:
 * фазы 04-09 состоят из намеренных правок, и объявлять их - работа, а не долг.
 * Число печатается, чтобы его увидели, а не чтобы им запретить.
 *
 * ★★ ЧИСЛА ДВА, И ОНИ ПРО РАЗНОЕ - это выяснилось ЗАМЕРОМ, а не чтением кода, и
 * первая редакция ТЗ делила маркеры ровно наоборот.
 *
 *   1. ПОТРАЧЕНО В ЭТОМ PR. Маркеры `floor-exempt`, `prefix-exempt`,
 *      `visual-diff-exempt`, `visual-diff-move` читаются своими гардами ИЗ
 *      ДОБАВЛЕННЫХ СТРОК ДИФФА и живут ровно один PR. Рабочее дерево у 2p -
 *      второй ИСТОЧНИК ДИФФА (чтобы локальный прогон не краснел на
 *      незастейдженной правке), а не «файл»: прогон 2p на чистом дереве не
 *      упоминает ни один из 271 маркера в `src`.
 *
 *   ⚠️ ЧИСЛА ПЕРЕСЕКАЮТСЯ И НЕ СКЛАДЫВАЮТСЯ: построчный маркер, добавленный
 *      ЭТИМ PR, честно попадает в оба - он и потрачен сейчас, и останется
 *      лежать. Это не двойной счёт, а два разных вопроса к одной строке.
 *
 *   2. НАКОПЛЕНО В ДЕРЕВЕ. Копятся только ПОСТРОЧНЫЕ, которые гард читает ИЗ
 *      ФАЙЛА при каждом прогоне: `inline-style-exempt` (2l),
 *      `design-token-exempt` (check-design-tokens), `orphan-exempt` (2n). Вот
 *      это и есть кандидат в шестую метрику пола - но сперва надо посмотреть,
 *      каким оно окажется.
 *
 * ⚠️ Строки `visual-diff-exempt`, оставшиеся в `src` от прошлых PR, ИНЕРТНЫ:
 * они уже не в диффе и ничего не гасят. Их много (сотни), они читаются как
 * активное подавление, и их судьба - отдельный вопрос. Репортёр печатает их
 * ТРЕТЬИМ, справочным числом и прямо называет инертными, чтобы никто не принял
 * его за счёт живых обходов.
 *
 * Env: BASE_REF (по умолчанию origin/dev).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const BASE_REF = process.env.BASE_REF || 'origin/dev';
const ROOT = process.env.AUDIT_ROOT || 'src';

/** Маркер → как он живёт. `perPr` читается из диффа (один PR), `inFile` - из
 *  файла (накапливается). Разделение НЕ косметика: по нему считаются оба числа. */
const MARKERS = [
  { name: 'floor-exempt', life: 'perPr' },
  { name: 'prefix-exempt', life: 'perPr' },
  { name: 'visual-diff-exempt', life: 'perPr' },
  { name: 'visual-diff-move', life: 'perPr' },
  { name: 'inline-style-exempt', life: 'inFile' },
  { name: 'design-token-exempt', life: 'inFile' },
  { name: 'orphan-exempt', life: 'inFile' },
];

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

const count = (text, name) => (text.match(new RegExp(`${name}\\s*:`, 'g')) || []).length;

/* --------------------------- 1. потрачено в этом PR ------------------------ */

let added = null;
try {
  added = [git(['diff', '--unified=0', `${BASE_REF}...HEAD`, '--', ROOT]), git(['diff', '--unified=0', 'HEAD', '--', ROOT])]
    .join('\n')
    .split('\n')
    .filter((l) => l.startsWith('+'))
    .join('\n');
} catch {
  // «Не смог измерить» и «измерил, ноль» обязаны печататься РАЗНЫМИ словами -
  // общее правило гардов этого репо. Репортёр при этом всё равно не блокирует.
  added = null;
}

/* --------------------------- 2. накоплено в дереве ------------------------- */

const files = [];
(function walk(dir) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else files.push(p);
  }
})(ROOT);
// Нечитаемый файл (битая символьная ссылка, права) НЕ должен ронять скрипт,
// который по определению ничего не блокирует: красная джоба у репортёра - это
// сломанный гейт по причине, к гейту отношения не имеющей.
const tree = files
  .map((f) => {
    try {
      return readFileSync(f, 'utf8');
    } catch {
      return '';
    }
  })
  .join('\n');

/* --------------------------------- печать --------------------------------- */

console.log('обходы гардов (репортёр, не блокирует)');

if (added === null) {
  console.log(`  потрачено в этом PR: не измерено — недостижим ${BASE_REF}`);
} else {
  const spent = MARKERS.map((m) => [m.name, count(added, m.name)]).filter(([, n]) => n);
  const total = spent.reduce((s, [, n]) => s + n, 0);
  const detail = spent.map(([n, c]) => `${n} ${c}`).join(' · ');
  console.log(`  потрачено в этом PR: ${total}${detail ? `  (${detail})` : ''}`);
}

const accrued = MARKERS.filter((m) => m.life === 'inFile').map((m) => [m.name, count(tree, m.name)]);
const accruedTotal = accrued.reduce((s, [, n]) => s + n, 0);
console.log(`  накоплено в дереве: ${accruedTotal}  (${accrued.map(([n, c]) => `${n} ${c}`).join(' · ')})`);
console.log('     ↑ только построчные: их гард читает ИЗ ФАЙЛА при каждом прогоне');

const inert = count(tree, 'visual-diff-exempt') + count(tree, 'visual-diff-move');
console.log(`  справочно: строк 2p, оставшихся в ${ROOT} от прошлых PR: ${inert} — ИНЕРТНЫ, ничего не гасят`);
