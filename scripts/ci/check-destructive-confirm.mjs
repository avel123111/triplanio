#!/usr/bin/env node
/**
 * CI-гард 2af — деструктивное действие проходит через КАНОН подтверждения.
 *
 * ЧТО ЭТО ЗАКРЫВАЕТ. Гард 2ab проверяет качество ВНУТРИ канона (у каждого
 * `confirm({…})` есть заголовок и тело), но ничто не заставляло канон
 * ИСПОЛЬЗОВАТЬ. Поэтому в дереве годами жили три копии собственной
 * стейт-машины подтверждения (события и сервисы: `confirmDel` + подмена тела
 * окна баннером `<Severity>`) и несколько кнопок, которые удаляли вообще без
 * вопроса. Для 2ab всё это невидимо: там нет слова `confirm(`.
 *
 * ПРЕДИКАТ — ПРО ЗАПИСЬ, А НЕ ПРО ВИД. Гард не спрашивает «выглядит ли кнопка
 * опасной»: тон — это оформление, его можно забыть или поставить лишний раз.
 * Он спрашивает ДРУГОЕ: «эта кнопка ПИШЕТ?». Нарушение = элемент с
 * деструктивным тоном (`<Btn variant="danger"|"danger-solid">`,
 * `<IconBtn tone="danger">`), чей обработчик в ЭТОМ ЖЕ файле дотягивается до
 * шва записи (`invokeFn(`, `.mutate(`, `.mutateAsync(`, `budgetMutate(`,
 * `rpc…(`) и при этом НЕ проходит через `confirm(`.
 *
 * Отсюда три полезных следствия:
 *   • удаление файла из НЕСОХРАНЁННОЙ формы (DocumentsField, EventAiBlock,
 *     FeedbackProvider) гард не трогает сам собой — там правится локальный
 *     массив, шва записи нет. Белый список для этого не нужен;
 *   • кнопка, которая только открывает форму или переключает состояние, тоже
 *     проходит молча;
 *   • а вот `danger`-кнопка, бьющая прямо в мутацию, краснеет независимо от
 *     того, как красиво она подписана.
 *
 * ГРАНИЦЫ ЧЕСТНО. Разбор — по одному файлу и по имени обработчика: `onClick`
 * либо инлайновая стрелка, либо идентификатор, объявленный тут же. Обработчик,
 * ПРИШЕДШИЙ ПРОПОМ (`onRemove` у CityPanel), в этом файле не резолвится, и гард
 * его не судит — решение принимает вызыватель. Это дыра по построению, и она
 * названа, а не замазана: закрывать её значило бы строить межфайловый граф
 * потока, а он на этом объёме стоит дороже, чем ловит.
 *
 * ИНВАРИАНТ, НЕ ХРАПОВИК: цель — ноль. Долг, который решено не трогать сейчас,
 * стоит в ALLOW поимённо, с причиной, — так он виден и посчитан, а не растворён.
 *
 * A CI guard is code: у него есть тест — check-destructive-confirm.test.mjs.
 *
 * Exit: 0 ok, 1 нарушение, 2 внутренняя ошибка.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';
/** Швы записи. `.mutate(`/`.mutateAsync(` ловят react-query, остальное — прямые двери. */
const WRITE = /\.mutateAsync\s*\(|\.mutate\s*\(|invokeFn\s*\(|budgetMutate\s*\(|formWrite\s*\(|\brpc[A-Z]\w*\s*\(/;
/** Канон подтверждения: промис-обёртка `confirm({…})` (useConfirm → ConfirmDialog). */
const CONFIRM = /\bconfirm\s*\(/;
/** Деструктивный тон в разметке. */
const DANGER = /<(Btn|IconBtn)\b[^>]*?(variant="danger(-solid)?"|tone="danger")/gs;

/**
 * Осознанный долг. Каждая строка — «файл:обработчик — причина».
 * Пусто НЕ значит «всё хорошо»: значит, что долга нет.
 */
const ALLOW = new Map([
  ['src/pages/ScreenAccount.jsx:handleRemoveAvatar',
   'аватар перезаливается в один клик, потери нет — решение Pavel 28.08.2026, подтверждение не добавляем'],
  ['src/pages/ScreenAccount.jsx:performDeleteAccount',
   'удаление аккаунта — своя стейт-машина с вводом слова; переезд на канон отдельным PR (решение Pavel 28.08.2026)'],
]);

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.jsx')) files.push(p);
  }
})(ROOT);

/** Тело функции/стрелки, объявленной как `const NAME = …` / `function NAME`, —
 *  по БАЛАНСУ СКОБОК от объявления до его закрывающей `}`.
 *  ⚠ Первая редакция резала тело «до следующего объявления того же уровня»
 *  (`\n\s{0,4}const`), и это молча врало: у `handleRemoveAvatar` тело обрывалось
 *  на первой же вложенной строке `const prev = …`, то есть ДО шва записи — гард
 *  считал обработчик безобидным. Поймано собственным ALLOW: запись «больше
 *  ничего не гасит» и уронила прогон. Ради этого проверка на протухший ALLOW и
 *  заводилась — она ловит не только чужой долг, но и свою слепоту. */
function bodyOf(src, name) {
  const m = src.match(new RegExp(`\\b(?:const|let|function)\\s+${name}\\b`));
  if (!m) return null;
  const open = src.indexOf('{', m.index);
  if (open === -1) return null;
  let d = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}' && --d === 0) return src.slice(m.index, j + 1);
  }
  return src.slice(m.index);
}

/** Значение атрибута с балансировкой фигурных скобок: `onClick={…}`. */
function attrExpr(tag, attr) {
  const i = tag.indexOf(`${attr}={`);
  if (i === -1) return null;
  let d = 0;
  for (let j = i + attr.length + 1; j < tag.length; j++) {
    if (tag[j] === '{') d++;
    else if (tag[j] === '}' && --d === 0) return tag.slice(i + attr.length + 2, j);
  }
  return null;
}

const bad = [];
const usedAllow = new Set();

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(DANGER)) {
    // Полный тег: от `<Btn` до закрывающего `>` верхнего уровня.
    let d = 0, end = m.index;
    for (let j = m.index; j < src.length; j++) {
      if (src[j] === '{') d++;
      else if (src[j] === '}') d--;
      else if (src[j] === '>' && d === 0) { end = j; break; }
    }
    const tag = src.slice(m.index, end + 1);
    const expr = attrExpr(tag, 'onClick') ?? attrExpr(tag, 'onSelect');
    if (!expr) continue;                       // disabled-кнопка без обработчика

    // Инлайновая стрелка судится по себе; идентификатор — по своему объявлению.
    const ident = expr.trim().match(/^([A-Za-z_$][\w$]*)$/);
    const handler = ident ? ident[1] : null;
    const scope = handler ? bodyOf(src, handler) : expr;
    if (scope === null) continue;              // пропом пришёл — не наш файл, см. «границы»

    if (CONFIRM.test(scope)) continue;         // канон на месте
    if (!WRITE.test(scope)) continue;          // не пишет — не деструктив

    const key = `${file}:${handler ?? '<inline>'}`;
    if (ALLOW.has(key)) { usedAllow.add(key); continue; }
    const line = src.slice(0, m.index).split('\n').length;
    bad.push({ file, line, handler: handler ?? '<inline>' });
  }
}

/* Протухшая запись ALLOW = та, чей ФАЙЛ в просмотренном дереве ЕСТЬ, а гасить
   ей уже нечего. Запись про файл, которого в дереве нет, не «протухла» — она
   просто вне области этого прогона (так гард остаётся запускаемым на фикстуре
   из теста, где реальных экранов приложения не существует). */
const seen = new Set(files);
const stale = [...ALLOW.keys()].filter((k) => !usedAllow.has(k) && seen.has(k.split(':')[0]));

console.log('check-destructive-confirm (2af): деструктивная запись только через канон-confirm');
console.log(`  файлов просмотрено: ${files.length} · осознанный долг в ALLOW: ${ALLOW.size}`);
for (const k of usedAllow) console.log(`  · долг: ${k} — ${ALLOW.get(k)}`);

if (stale.length) {
  console.error('::error::записи ALLOW больше ничего не гасят — сними их, иначе список врёт:');
  for (const k of stale) console.error(`  ${k}`);
  process.exit(1);
}
if (bad.length) {
  console.error(`::error::деструктивная запись мимо канона подтверждения — ${bad.length}:`);
  for (const b of bad) console.error(`  ${b.file}:${b.line}  обработчик ${b.handler}`);
  console.error('');
  console.error('  Кнопка с деструктивным тоном, которая пишет, обязана спрашивать. Канон один:');
  console.error("    const confirm = useConfirm();");
  console.error("    confirm({ title, description, variant: 'destructive', onConfirm: () => mut.mutateAsync(vars) })");
  console.error('  Спиннер держит САМ confirm — своего `loading` у кнопки быть не должно.');
  console.error('  Осознанный долг — строкой в ALLOW этого файла, с причиной и датой решения.');
  process.exit(1);
}
console.log('  нарушений нет.');
