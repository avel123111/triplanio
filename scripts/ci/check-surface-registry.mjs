#!/usr/bin/env node
/**
 * CI-гард 2z · РЕЕСТР ПОЛНОТЫ ПОВЕРХНОСТЕЙ (Г34, TRIP-343, объект 2).
 *
 * ЗАЧЕМ. «Объект собран из системы» доказывается фразой «немигрированных
 * поверхностей = 0». Пока список поверхностей выводится ad hoc из одного скана,
 * это subset-proof: скан по .css слеп к инлайну style={{}} и к теневому <style>,
 * и «= 0» держится, а поверхность живёт мимо <Card>. Так объект 2 «закрывался»
 * трижды. Реестр делает набор ЯВНЫМ и checked-in: КАЖДЫЙ surface-класс обязан
 * иметь запись — либо переехал на <Card> (`object: "card"`), либо назван другим
 * объектом с причиной (`object: <имя>, reason`). Незанесённый класс роняет PR;
 * запись на класс, переставший быть поверхностью, — тоже (реестр не врёт).
 *
 * ПРЕДИКАТ ПОВЕРХНОСТИ — тот же, что у `audit-design.mjs` §5 и гарда 2y:
 *   border-radius + фон + (рамка | тень),  И НЕ плитка (квадрат + радиус + центр).
 *
 * ТРИ НОСИТЕЛЯ (Г34 «обязана покрывать инлайн и <style>, а не только .css»):
 *   1. .css классы            — БЛОКИРУЮТ: каждый ⊆ реестр, реестр ⊆ живые.
 *   2. <style> внутри .jsx     — БЛОКИРУЮТ: их быть не должно (дом — <Card>), = 0.
 *   3. инлайн style={{…}}      — РАТЧЕТ вниз: число surface-инлайнов не растёт
 *      против BASE_REF, печатается как «остаток числом». Тинт-объекты (warning/
 *      dashed-плейсхолдер/бренд-градиент) — законные не-Card поверхности, поэтому
 *      здесь ратчет, а не «= 0»: он держит направление (только вниз), не требуя
 *      единовременно расклассифицировать каждый инлайн по объекту.
 *
 * A CI guard is code: тест — `check-surface-registry.test.mjs`.
 * Env: BASE_REF (по умолчанию origin/dev) — только для ратчета инлайнов.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { Parser as AcornParser } from 'acorn';
import acornJsx from 'acorn-jsx';
const JsxParser = AcornParser.extend(acornJsx());

const BASE_REF = process.env.BASE_REF || 'origin/dev';
// Реестр читается ОТНОСИТЕЛЬНО cwd (как `git ls-files`/`readFileSync` ниже) —
// и на прогоне из корня репо, и на fixture-репо теста это один и тот же путь.
const REG_PATH = resolve(process.cwd(), 'scripts/ci/surface-registry.json');

const git = (args) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return null;
  }
};
const lsSrc = () => (git(['ls-files', 'src']) || '').split('\n').filter(Boolean);

// ── предикат поверхности (общий с 2y / аудитом) ─────────────────────────────
const BORDER = /^border(-(top|right|bottom|left))?(-(color|width|style))?$/;
const hasBg = (m) => m.has('background') || m.has('background-color');
const hasBorder = (m) => [...m.keys()].some((p) => BORDER.test(p));
const centred = (m) => m.has('place-items') || (m.has('align-items') && m.has('justify-content'));
const isTile = (m) => m.has('width') && m.get('width') === m.get('height') && m.has('border-radius') && centred(m);
const isSurface = (m) => m.has('border-radius') && hasBg(m) && (hasBorder(m) || m.has('box-shadow')) && !isTile(m);

const styledClass = (sel) => {
  const all = [...sel.matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)].map((x) => x[1]);
  return all.at(-1) ?? null;
};
const declsOf = (rule) => {
  const m = new Map();
  rule.walkDecls((d) => m.set(d.prop.toLowerCase(), d.value.trim()));
  return m;
};

// ── 1. surface-классы в .css ────────────────────────────────────────────────
const cssSurfaceClasses = () => {
  const set = new Set();
  for (const f of lsSrc().filter((f) => f.endsWith('.css'))) {
    let root;
    try { root = postcss.parse(readFileSync(f, 'utf8')); } catch { continue; }
    root.walkRules((rule) => {
      const m = declsOf(rule);
      if (!isSurface(m)) return;
      for (const sel of rule.selector.split(',')) {
        const c = styledClass(sel);
        if (c) set.add(c);
      }
    });
  }
  return set;
};

// ── 2/3. поверхности в <style> и surface-инлайны в .jsx ─────────────────────
const STYLE_RE = /<style>\s*\{\s*`([\s\S]*?)`\s*\}\s*<\/style>/g;
// Литерал style={{ … }} — берём тело до сбалансированной }}. Грубый, но
// достаточный разбор: считаем ОБЪЕКТ поверхностью, если в его тексте есть
// background + borderRadius + (border | boxShadow) и НЕ квадрат-плитка.
const styleObjects = (src) => {
  const out = [];
  const re = /style=\{\{/g;
  let m;
  while ((m = re.exec(src))) {
    let i = re.lastIndex, depth = 2, body = '';
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      if (depth > 0) body += ch;
      i++;
    }
    out.push(body);
  }
  return out;
};
const inlineIsSurface = (body) => {
  const has = (re) => re.test(body);
  const bg = has(/\bbackground(Color)?\s*:/) && !/\bbackground(Color)?\s*:\s*['"]?(transparent|none)\b/.test(body);
  const radius = has(/\bborderRadius\s*:/);
  const border = has(/\bborder(Color|Top|Right|Bottom|Left)?\s*:/);
  const shadow = has(/\bboxShadow\s*:/);
  const square = /\bwidth\s*:\s*([^,]+),[\s\S]*?\bheight\s*:\s*\1\b/.test(body);
  return bg && radius && (border || shadow) && !square;
};
const scanJsx = (readFile) => {
  let styleSurfaces = 0;
  let inlineSurfaces = 0;
  for (const f of lsSrc().filter((f) => f.endsWith('.jsx'))) {
    const src = readFile(f);
    if (src == null) continue;
    for (const sm of src.matchAll(STYLE_RE)) {
      let root;
      try { root = postcss.parse(sm[1]); } catch { continue; }
      root.walkRules((rule) => { if (isSurface(declsOf(rule))) styleSurfaces++; });
    }
    for (const body of styleObjects(src)) if (inlineIsSurface(body)) inlineSurfaces++;
  }
  return { styleSurfaces, inlineSurfaces };
};

// ── 4. СЫРОЙ ВЫЗЫВАТЕЛЬ card-homed класса (F, TRIP-343) ─────────────────────
// card-homed класс несёт ТОЛЬКО раскладку — его скин на <Card>. Сырой host-тег
// (<button>/<div>/<a>…) с таким className мимо <Card> = поверхность потеряна
// молча (баг трансфера). Три скан-режима выше этого не видят: в .css поверхности
// нет, инлайна нет, <style> нет. Ловим AST-обходом JSX.
const classAttrTokens = (attr) => {
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if (n.type === 'Literal' && typeof n.value === 'string') out.push(...n.value.split(/\s+/));
    else if (n.type === 'JSXExpressionContainer') walk(n.expression);
    else if (n.type === 'TemplateLiteral') n.quasis.forEach((q) => out.push(...(q.value.cooked || '').split(/\s+/)));
    else if (n.type === 'ConditionalExpression') { walk(n.consequent); walk(n.alternate); }
    else if (n.type === 'LogicalExpression') { walk(n.left); walk(n.right); }
    else if (n.type === 'BinaryExpression') { walk(n.left); walk(n.right); }
  };
  walk(attr && attr.value);
  return out.filter(Boolean);
};
const rawCardHomedCallers = (cardHomed) => {
  const hits = [];
  for (const f of lsSrc().filter((f) => f.endsWith('.jsx'))) {
    let ast;
    try { ast = JsxParser.parse(readFileSync(f, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' }); } catch { continue; }
    const stack = [ast];
    while (stack.length) {
      const n = stack.pop();
      if (!n || typeof n !== 'object') continue;
      if (n.type === 'JSXOpeningElement' && n.name && n.name.type === 'JSXIdentifier' && /^[a-z]/.test(n.name.name)) {
        const cls = n.attributes.find((a) => a.type === 'JSXAttribute' && a.name.name === 'className');
        const homed = classAttrTokens(cls).filter((t) => cardHomed.has(t));
        if (homed.length) hits.push(`${f}: <${n.name.name} className=[${homed.join(' ')}]> мимо <Card>`);
      }
      for (const k in n) {
        const v = n[k];
        if (Array.isArray(v)) stack.push(...v);
        else if (v && typeof v === 'object' && v.type) stack.push(v);
      }
    }
  }
  return hits;
};

// ── реестр ──────────────────────────────────────────────────────────────────
const registry = JSON.parse(readFileSync(REG_PATH, 'utf8'));
const known = new Set(Object.keys(registry.classes || {}));
const cardHomed = new Set(registry.cardHomed || []);

const live = cssSurfaceClasses();
const unregistered = [...live].filter((c) => !known.has(c)).sort();
const stale = [...known].filter((c) => !live.has(c)).sort();

const head = scanJsx((f) => { try { return readFileSync(f, 'utf8'); } catch { return null; } });
const base = scanJsx((f) => git(['show', `${BASE_REF}:${f}`]));
const baseKnown = git(['rev-parse', BASE_REF]) !== null;
const rawCallers = rawCardHomedCallers(cardHomed);

console.log(`check-surface-registry (2z): реестр полноты поверхностей`);
console.log(`  .css surface-классов: ${live.size} · в реестре: ${known.size}`);
console.log(`  <style> поверхностей: ${head.styleSurfaces} (цель 0)`);
console.log(
  `  инлайн-поверхностей:  ${head.inlineSurfaces}` +
    (baseKnown ? ` (BASE ${base.inlineSurfaces}) — остаток числом, ратчет вниз` : ' (BASE недостижим — ратчет пропущен)'),
);
console.log(`  сырых вызывателей card-homed классов мимо <Card>: ${rawCallers.length} (цель 0)`);

let bad = false;
if (unregistered.length) {
  bad = true;
  console.log('');
  console.log('  НЕ В РЕЕСТРЕ (каждый surface-класс обязан быть приписан объекту):');
  unregistered.forEach((c) => console.log(`    .${c}`));
}
if (stale.length) {
  bad = true;
  console.log('');
  console.log('  СТАРЫЕ ЗАПИСИ (класс больше не поверхность — реестр обязан отражать живое):');
  stale.forEach((c) => console.log(`    .${c}`));
}
if (head.styleSurfaces > 0) {
  bad = true;
  console.log('\n  ПОВЕРХНОСТЬ В <style> (дом поверхности — <Card>, см. гард 2y).');
}
if (baseKnown && head.inlineSurfaces > base.inlineSurfaces) {
  bad = true;
  console.log(`\n  РОСТ surface-инлайнов: ${base.inlineSurfaces} → ${head.inlineSurfaces} (ратчет только вниз — переноси на <Card>).`);
}
if (rawCallers.length) {
  bad = true;
  console.log('\n  СЫРОЙ ВЫЗЫВАТЕЛЬ card-homed класса (скин потерян — оберни в <Card>):');
  rawCallers.forEach((h) => console.log(`    ${h}`));
}

if (bad) {
  console.error('::error::check-surface-registry: реестр полноты не сошёлся. Занеси класс в surface-registry.json (object:"card" или object:<имя>+reason), убери старую запись, вынеси скин из <style>/инлайна на <Card>.');
  process.exit(1);
}
console.log('\n  реестр полон: каждая .css-поверхность приписана, в <style> поверхностей нет, инлайн не вырос.');
process.exit(0);
