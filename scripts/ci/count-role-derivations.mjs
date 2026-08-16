#!/usr/bin/env node
// РЕПОРТЕР (не гейт): сколько на фронте мест выводят право по трипу РУКАМИ —
// сравнением роли со строкой (`role === 'viewer'`, `myRole === 'owner'`, …)
// вместо единой лестницы `clearsStep` из `src/lib/tripStep.js`.
//
// Зачем: метрика приёмки Ф2.1 (TRIP-274), по образцу TRIP-321 (audit-design).
// Мерить ДО и ПОСЛЕ: цель — 0 гейтов мимо лестницы. Печатает число и адреса,
// НИКОГДА не роняет сборку (exit 0) — это лог, а спор «сделан ли заход»
// закрывается числом из него, а не словами.
//
// ⚠ Часть совпадений — ЛЕГИТИМНЫЙ показ, а не гейт (ярлык роли, сортировка
// участников по рангу, строка-владелец в списке). Их выводит колонка
// `display` — они остаются и после Ф2.1. Гейты (readOnly/canManage/canEdit/
// affordance) обязаны уйти в лестницу.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'src');

// role/myRole сравнивается со строкой роли — в любую сторону.
const RE = /\b(?:my)?[Rr]ole\b\s*[!=]==\s*['"](?:viewer|admin|owner)['"]|['"](?:viewer|admin|owner)['"]\s*[!=]==\s*\b(?:my)?[Rr]ole\b/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(jsx?|tsx?)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

const hits = [];
for (const file of walk(SRC)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (RE.test(line)) hits.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
  });
}

console.log(`[count-role-derivations] raw role comparisons in src: ${hits.length}`);
for (const h of hits) console.log('  ' + h);
console.log(
  '\nЦель Ф2.1: гейты (readOnly/canManage/canEdit/affordance) → clearsStep; ' +
  'остаток — только display (ярлык/сортировка/строка-владелец).',
);
