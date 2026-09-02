/**
 * РАСЩЕПЛЕНИЕ САЙТОВОЙ ДС НА ДВА СЛОЯ — ПРОВЕРКА ТОГО, ЧТО ОНО ЦЕЛО (TRIP-505).
 *
 * ПОЧЕМУ У ЭТОГО ЕСТЬ ТЕСТ, А НЕ ОДНА ЛИШЬ ВНИМАТЕЛЬНОСТЬ. Ломается это
 * АСИММЕТРИЧНО: на страницах зоны `.site` висит на `<html>`, поэтому
 * НЕСКОУПЛЕННОЕ правило там работает ровно так же, как скоупленное, — лендинг,
 * демо и юр-страницы остаются правильными до последнего пикселя. Платит за
 * него ДРУГОЙ экран: `.btn`, `.badge`, `.sheet`, `.err`, `.t-label` — 56 имён
 * пересекаются с `app.css`, и site.css грузится позже, то есть выигрывает.
 * Одно забытое правило перекрашивает кнопки гостевого планировщика, и увидит
 * это только тот, кто откроет именно его.
 *
 * Поэтому инвариант machine-checked: КАЖДОЕ правило `public/site.css` либо
 * скоуплено компонентным слоем, либо названо здесь как документное.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ZONE_SCOPE, ZONE_SCOPE_WEIGHTED, unscope, scopeTraces } from './zone-scope.mjs';

const CSS = readFileSync('public/site.css', 'utf8');

/**
 * ДОКУМЕНТНЫЙ СЛОЙ — исчерпывающий список. Это правила, которым нужен сам
 * документ: они включаются только там, где страницу целиком рисует сайтовая ДС
 * (`html.site`), и на экране приложения их быть не должно.
 */
const DOCUMENT_LAYER = new Set([
  'html:where(.site)',                                  // прокрутка, отступ под фикс-шапку
  ':where(html.site) body',                             // гарнитура, вес, цвет, фон страницы
  'html.site[data-theme]',                              // защита токенов зоны от тёмной темы приложения
  'html.site main',                                     // появление страницы зоны
  'body.pt-open',                                       // замок прокрутки под открытым меню
  'body.pt-open .main-nav',
  'body.pt-open .mobile-menu a[href^="#"]',
  // Состояние бургера живёт КЛАССОМ НА `<body>` (его вешает `SiteHeader`), а
  // `<body>` потомком острова `.site` не бывает — на экране приложения остров
  // лежит ВНУТРИ него. Скоупни эти правила — и на любой поверхности приложения,
  // попросившей `variant="full"`, бургер открывал бы пустоту, причём молча: с
  // точки зрения расщепления правило «скоуплено», просто невыполнимо.
  '.mobile-open .mobile-menu',
  '.mobile-open .burger .l1',
  '.mobile-open .burger .l2',
  '.mobile-open .burger .l3',
  ':is(html.site,.site)',                               // токены — оба хоста
  '.site:not(html)',                                    // основа текста острова
]);

/** Разбить список селекторов по запятым ВНЕ скобок: `:is(html.site,.site)` —
 *  одна часть, а не две. */
function splitTopLevel(head) {
  const out = [];
  let cur = '', depth = 0;
  for (const c of head) {
    if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

/** Селекторные заголовки всех правил (кроме кадров `@keyframes`). */
function ruleSelectors(src) {
  const out = [];
  let i = 0, start = 0, seen = false;
  const stack = [];
  const inKeyframes = () => stack.includes('kf');
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
    if (c === '"' || c === "'") { seen = true; const q = c; i += 1; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i += 1; i += 1; } i += 1; continue; }
    if (c === '{') {
      const head = src.slice(start, i).replace(/\/\*[\s\S]*?\*\//g, '').trim();
      if (head.startsWith('@')) stack.push(/^@keyframes/i.test(head) ? 'kf' : 'at');
      else { stack.push('rule'); if (!inKeyframes() && head) out.push(head); }
      i += 1; start = i; seen = false; continue;
    }
    if (c === '}' || c === ';') { if (c === '}') stack.pop(); i += 1; start = i; seen = false; continue; }
    if (!seen && !/\s/.test(c)) { start = i; seen = true; }
    i += 1;
  }
  return out;
}

/** Селекторы файла, разобранные на части, в нормальной форме. */
const PARTS = ruleSelectors(CSS)
  .flatMap(splitTopLevel)
  .map((x) => x.trim().replace(/\s+/g, ' '))
  .filter(Boolean);

test('★★★ каждое правило site.css скоуплено — иначе сайтовая ДС течёт на экран приложения', () => {
  const loose = PARTS.filter((sel) => !(
    sel.startsWith(`${ZONE_SCOPE} `)                      // компонентный слой
    || sel.startsWith(`${ZONE_SCOPE_WEIGHTED} `)         // он же, с весом (заголовки)
    || DOCUMENT_LAYER.has(sel)                           // документный слой, назван поимённо
  ));
  assert.deepEqual(loose, [],
    `правила site.css без скоупа: ${loose.join(' · ')}\n`
    + '  → компонентное правило пишется как `:where(.site) <селектор>`;\n'
    + '  → документное (ему нужен сам документ) добавляется в DOCUMENT_LAYER здесь, с обоснованием.');
});

test('★★ ВЕСОМЫЙ скоуп заведён РОВНО под заголовки и никуда больше не расползся', () => {
  // Калитка предыдущей проверки пропускает `:is(html.site,.site) …` без счёта,
  // а этот скоуп ТЯЖЁЛЫЙ: он и заведён затем, чтобы выигрывать. Расползись он
  // дальше заголовков — сайтовая ДС начнёт бить компоненты ПРИЛОЖЕНИЯ на
  // страницах зоны, то есть вернётся ровно та регрессия, ради которой написан
  // весь этот файл, и предыдущая проверка её не увидит (она ищет литерал
  // `.site `, а тяжёлая форма выглядит иначе).
  const tails = PARTS
    .filter((sel) => sel.startsWith(`${ZONE_SCOPE_WEIGHTED} `))
    .map((sel) => sel.slice(ZONE_SCOPE_WEIGHTED.length + 1));
  assert.deepEqual([...new Set(tails)].sort(), ['h1', 'h2', 'h3', 'h4'],
    `весомый скоуп ${ZONE_SCOPE_WEIGHTED} применён не только к заголовкам: ${tails.join(' · ')}\n`
    + '  → нужен вес ради чего-то ещё — это отдельное решение, а не расширение этого списка.');
});

test('★★ скоуп НЕ добавляет специфичности — иначе зона начнёт выигрывать у приложения', () => {
  // `:where()` весит ноль. Напиши `.site ` — и каждое правило зоны станет на
  // класс тяжелее, то есть перебьёт компоненты ПРИЛОЖЕНИЯ, живущие на
  // страницах зоны (баннер согласия, экран запуска). Замер первой редакции:
  // виджет согласия потерял свою заливку и рамку, и увидел это только
  // попиксельный диф.
  assert.equal(ZONE_SCOPE, ':where(.site)');
  assert.ok(!/(^|[\s,{])\.site\s+[.:[a-zA-Z]/m.test(CSS.replace(/\/\*[\s\S]*?\*\//g, '')),
    'в site.css появился скоуп `.site ` вместо `:where(.site) ` — он поднимает специфичность всему файлу');
});

test('★★ ОСТРОВ И `body` ГОВОРЯТ ОДНО И ТО ЖЕ — дубль основы текста не разъехался', () => {
  // На странице зоны основу текста задаёт `body`, на экране приложения — сам
  // остров `<div class="site">` (`body` там принадлежит приложению и трогать
  // его нельзя). Это ДУБЛЬ ВОСЬМИ ЛИТЕРАЛОВ, и держится он ровно на том, что
  // кто-то помнит про вторую копию: разведи их — и шапка планировщика поедет
  // относительно той же шапки на лендинге, молча и только на одной поверхности.
  // `background`/`overflow-x` в сверку не входят: они про сам документ, острову
  // их брать не с чего и незачем.
  const decls = (sel) => {
    const src = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const i = src.indexOf(`${sel}{`) >= 0 ? src.indexOf(`${sel}{`) : src.indexOf(`${sel} {`);
    assert.ok(i >= 0, `в site.css нет блока ${sel} — сверять нечего`);
    const body = src.slice(src.indexOf('{', i) + 1, src.indexOf('}', i));
    return new Map(body.split(';').map((d) => d.split(':')).filter((x) => x.length >= 2)
      .map(([k, ...v]) => [k.trim(), v.join(':').trim()]));
  };
  const island = decls('.site:not(html)');
  const page = decls(':where(html.site) body');
  const shared = [...island.keys()].sort();
  assert.ok(shared.length >= 8, `остров объявляет ${shared.length} свойств — раньше их было 8`);
  const drifted = shared.filter((k) => page.get(k) !== island.get(k));
  assert.deepEqual(drifted, [],
    `основа текста острова разъехалась с body: ${drifted.map((k) => `${k}: ${island.get(k)} ≠ ${page.get(k)}`).join(' · ')}`);
});

test('★ unscope() снимает скоуп ЦЕЛИКОМ — на нём стоят 2p и 2ae', () => {
  // Оба гарда читают site.css через `unscope()` и рассуждают о нём моделью,
  // написанной до расщепления. Останься хоть одна форма неснятой — гард
  // покраснеет на изменении, которого нет, и его погасят маркерами.
  assert.deepEqual(scopeTraces(unscope(CSS)), []);
  // И снятие ничего не портит в объявлениях: длина падает ровно на скоупы.
  assert.ok(unscope(CSS).length < CSS.length);
  // Снимается форма СО ПРОБЕЛОМ (`:where(.site) `), поэтому и проверять надо её:
  // без пробела строка не изменилась бы в любом случае, и утверждение было бы
  // слабее собственного комментария.
  const value = 'a{content:":where(.site) x"}';
  assert.equal(unscope(value), value,
    'unscope() трогает значение объявления — литерал скоупа обязан встречаться только в селекторе');
});
