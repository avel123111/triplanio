#!/usr/bin/env node
/**
 * CI guard 2aa (TRIP-284, Блок 1) — каждая прямая ПИШУЩАЯ дверь Storage объявляет
 * свою судьбу при сбое.
 *
 * После эпика «единая дверь» Sentry ловит клиентский сбой, только если он прошёл
 * через шов. Байты Storage — намеренно РАЗРЕШЁННОЕ прямое обращение (аватары,
 * обложки, документы; handoff TRIP-374), швом они не оборачиваются. Значит их
 * сбой невидим, пока каждый сайт сам не решит: репортить (реальный сбой,
 * `report({ surface: 'storage' })`) или проглотить осознанно (best-effort снос
 * своих сирот). Немаркированная сырая запись — это ТРЕТЬЕ, неявное состояние
 * «сбой молча исчез», и его этот гард закрывает.
 *
 * ── ЕДИНЫЙ СПИСОК, НЕ ПАРАЛЛЕЛЬНЫЙ ─────────────────────────────────────────
 * Список пишущих дверей берётся из `storageWriteSites()` ТАБЛО `check-data-door.mjs`
 * (гард 2r) — тот же разбор (`blankComments` + `fromCalls`), что ловит и
 * многострочную цепочку `supabase.storage\n .from(b)\n .upload(`. Здесь НЕ
 * заводится второй детектор и второй перечень путей: гард читает ровно то, что
 * табло считает записью Storage (upload/update/move/copy/remove). Чтения
 * (`createSignedUrl`/`getPublicUrl`/`list`) в список не входят по построению —
 * их сбой ничего молча не рушит.
 *
 * ── КОНТРАКТ САЙТА (маркер, как `// sentry: manual` у 2h) ───────────────────
 * У каждой пишущей двери в окне ±3 строки обязан стоять РОВНО ОДИН маркер:
 *   // storage-report                      сбой уходит в report({surface:'storage'})
 *   // storage-soft-fail: <причина>        осознанный best-effort, НЕ репортим
 * Немаркированная запись = красный PR. `storage-report` без единого `report(` в
 * файле — тоже красный: маркер-обещание не должен лгать (та же логика, что у 2h,
 * где code-signal проверяется отдельно от opt-out-маркера).
 *
 * ── ГАРД = КОД, У НЕГО ТЕСТ ────────────────────────────────────────────────
 * `check-storage-seam.test.mjs` гоняет гард подпроцессом на временном дереве и
 * ловит код выхода; зелёный тест ничего не значит, пока не увиден КРАСНЫМ на
 * мутации (сырая запись без маркера). См. [[triplanio-ci-guard-is-code]].
 *
 * Env: измеряет `process.cwd()` (как `check-data-door --json`).
 * Выход: 0 ок · 1 нарушение · 2 не смог измерить.
 */
import { readFileSync } from 'node:fs';
import { storageWriteSites } from './check-data-door.mjs';

const SOFT = /storage-soft-fail:/;
const REPORT = /storage-report\b/;
const WINDOW = 3; // строк вверх/вниз от `.from(` — покрывает многострочную цепочку

// Гашение комментариев для проверки «файл реально зовёт report(»: упоминание в
// комментарии не должно засчитываться как вызов.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

try {
  const cwd = process.cwd();
  const sites = storageWriteSites(cwd);

  // Кэш содержимого файлов: и окно маркера, и проверку «есть report(» берём из
  // одного чтения.
  const fileLines = new Map();
  const fileCallsReport = new Map();
  const linesOf = (rel) => {
    if (!fileLines.has(rel)) fileLines.set(rel, readFileSync(rel, 'utf8').split('\n'));
    return fileLines.get(rel);
  };
  const callsReport = (rel) => {
    if (!fileCallsReport.has(rel)) {
      fileCallsReport.set(rel, /\breport\s*\(/.test(stripComments(readFileSync(rel, 'utf8'))));
    }
    return fileCallsReport.get(rel);
  };

  const unmarked = [];
  const lyingReport = [];
  for (const s of sites) {
    const lines = linesOf(s.file);
    // s.line — 1-based строка `.from(`; окно захватывает начало цепочки и ветку
    // `if (error)` под ней.
    const from = Math.max(0, s.line - 1 - WINDOW);
    const to = Math.min(lines.length, s.line - 1 + WINDOW + 1);
    const windowText = lines.slice(from, to).join('\n');

    if (SOFT.test(windowText)) continue; // осознанный best-effort
    if (REPORT.test(windowText)) {
      if (!callsReport(s.file)) lyingReport.push(s);
      continue;
    }
    unmarked.push(s);
  }

  if (unmarked.length || lyingReport.length) {
    console.error('::error::2aa storage-seam guard failed: прямая запись Storage без объявленной судьбы сбоя');
    for (const s of unmarked) {
      console.error(`  ✗ ${s.file}:${s.line} .${s.op}() — нет маркера`);
    }
    for (const s of lyingReport) {
      console.error(`  ✗ ${s.file}:${s.line} .${s.op}() — // storage-report, но файл не зовёт report()`);
    }
    console.error('');
    console.error('  Поставь в той же строке/рядом РОВНО ОДИН маркер:');
    console.error("    // storage-report                 — сбой уходит в report({ surface: 'storage' })");
    console.error('    // storage-soft-fail: <причина>   — осознанный best-effort, не репортим');
    console.error('');
    console.error('  Список дверей берётся из storageWriteSites() табло check-data-door.mjs (2r).');
    process.exit(1);
  }

  console.log(`check-storage-seam (2aa): все ${sites.length} пишущих дверей Storage объявили судьбу сбоя — OK`);
  process.exit(0);
} catch (e) {
  console.error(`::error::check-storage-seam internal error: ${e.message}`);
  process.exit(2);
}
