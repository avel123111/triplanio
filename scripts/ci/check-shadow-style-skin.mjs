#!/usr/bin/env node
/**
 * CI-гард 2y · СКИН-ПОВЕРХНОСТЬ В ТЕНЕВОМ `<style>` (TRIP-343, объект 2, §11).
 *
 * ЧТО ЭТО. Инлайновый `<style>{`…`}</style>` внутри `.jsx` — это CSS, который
 * НЕ читает ни один замерщик слоя: `audit-design.mjs` (и производные полы 2o/2p)
 * разбирают только CSS-файлы в `src`. Значит поверхность (карточка/панель),
 * нарисованная в таком `<style>`, НЕВИДИМА метрике «объект собран из системы»:
 * она не попадает в 66 классов `objects.surface`, «немигрированных = 0» остаётся
 * зелёным, а скин живёт мимо `<Card>`. Ровно так объект 2 «закрывался» трижды и
 * оставался открытым (subset-proof). Этот гард закрывает дыру: сырую ПОВЕРХНОСТЬ
 * в `<style>` внутри `.jsx` он делает КРАСНОЙ.
 *
 * ПРЕДИКАТ ПОВЕРХНОСТИ — тот же, что у `audit-design.mjs` (§5, объект `surface`):
 *   border-radius + фон + (рамка | тень),   И НЕ плитка (квадрат + радиус + центр).
 * Плитка (иконка-квадрат с тенью) исключена намеренно — это «пятно», не
 * поверхность; тем же водоразделом их разводит и аудит («поверхность от пятна
 * отличает контур»). Сепаратор `border-top` без радиуса/фона под предикат не
 * попадает — поэтому `<style>` в Stay22HotelList/ViatorActivityList (там ровно
 * такие разделители) гард НЕ трогает.
 *
 * АБСОЛЮТНЫЙ ИНВАРИАНТ, НЕ ХРАПОВИК. Поверхностей в `<style>` быть не должно ВООБЩЕ
 * (их дом — `<Card>`), поэтому цель = 0, а не «не расти». HEAD-only, `BASE_REF`
 * не нужен. Обхода нет намеренно: обход — это перенос скина на `<Card>`, а не
 * маркер. Если новая поверхность действительно обязана жить в `<style>` (её нет),
 * это решение уровня ДС, а не строка-исключение.
 *
 * ПОЧЕМУ postcss. Тот же разбор, что у 2p (`postcss@8` — прямая зависимость репо,
 * рунг 5 ponytail); свой парсер CSS был бы третьим в репозитории. Живёт в джобе
 * `design-floor` рядом с 2o/2p/2q — им всем нужен `npm ci`.
 *
 * A CI guard is code: у него есть тест — `check-shadow-style-skin.test.mjs`.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import postcss from 'postcss';

// Все `.jsx` в src (гард HEAD-only; список берём из git, чтобы не тащить glob-dep).
const listJsx = () =>
  execFileSync('git', ['ls-files', 'src'], { encoding: 'utf8' })
    .split('\n')
    .filter((f) => f.endsWith('.jsx'));

// Содержимое каждого `<style>{`…`}</style>` (шаблонная строка). Тег без выражения
// (`<style>foo</style>`) в репо не встречается, но и он бы не распарсился как CSS
// с интерполяциями — берём только литеральную форму с backtick.
const STYLE_RE = /<style>\s*\{\s*`([\s\S]*?)`\s*\}\s*<\/style>/g;

const BORDER = /^border(-(top|right|bottom|left))?(-(color|width|style))?$/;
const declsOf = (rule) => {
  const m = new Map();
  rule.walkDecls((d) => m.set(d.prop.toLowerCase(), d.value.trim()));
  return m;
};
const has = (m, p) => m.has(p);
const hasBg = (m) => has(m, 'background') || has(m, 'background-color');
const hasBorder = (m) => [...m.keys()].some((p) => BORDER.test(p));
const centred = (m) => has(m, 'place-items') || (has(m, 'align-items') && has(m, 'justify-content'));
const isTile = (m) =>
  has(m, 'width') && m.get('width') === m.get('height') && has(m, 'border-radius') && centred(m);
const isSurface = (m) =>
  has(m, 'border-radius') && hasBg(m) && (hasBorder(m) || has(m, 'box-shadow')) && !isTile(m);

const hits = [];
for (const file of listJsx()) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(STYLE_RE)) {
    let root;
    try {
      root = postcss.parse(m[1]);
    } catch {
      continue; // невалидный фрагмент разберёт сборка/линт, не этот гард
    }
    root.walkRules((rule) => {
      const m2 = declsOf(rule);
      if (isSurface(m2)) hits.push({ file, sel: rule.selector.replace(/\s+/g, ' ').trim() });
    });
  }
}

console.log(`check-shadow-style-skin (2y): сырых поверхностей в <style> внутри .jsx: ${hits.length}`);
if (hits.length) {
  console.log('');
  hits.forEach((h) => console.log(`  ${h.file}: ${h.sel}`));
  console.error(
    '::error::check-shadow-style-skin: поверхность (радиус+фон+рамка/тень) нарисована в теневом ' +
      '<style> — она вне замера слоя. Перенеси скин на <Card> (фон/рамку/радиус несёт примитив), ' +
      'в <style> оставь только раскладку/акцент. Обхода нет: дом поверхности — <Card>.',
  );
  process.exit(1);
}
console.log('  чисто: весь скин поверхностей живёт на <Card>/в .css.');
process.exit(0);
