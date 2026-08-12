// Зеркало реестра кодов не должно расходиться с серверным близнецом.
//
// src/lib/errorCodes.js (клиент) и supabase/functions/_shared/errorCodes.ts
// (edge) держат ОДИН набор кодов в двух рантаймах. Дрейф между копиями невидим
// где-либо ещё: обе половины продолжают работать, просто под разными наборами.
// Тест читает серверный файл как ТЕКСТ и падает при расхождении (приём
// viralLink.js/.ts).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ERROR_CODES, ERROR_CODE_SET } from './errorCodes.js';

/** Кавыченные UPPER_SNAKE-литералы из текста (в .ts они только в ERROR_CODES). */
function quotedUpperCodes(src) {
  const out = new Set();
  for (const [, c] of src.matchAll(/'([A-Z][A-Z0-9_]{2,})'/g)) out.add(c);
  return out;
}

test('клиентский реестр = серверному близнецу (без дрейфа)', () => {
  const source = readFileSync(
    new URL('../../supabase/functions/_shared/errorCodes.ts', import.meta.url),
    'utf8',
  );
  const edge = quotedUpperCodes(source);
  assert.ok(edge.size > 0, 'парсер серверного файла не нашёл ни одного кода');
  assert.deepEqual([...edge].sort(), [...ERROR_CODES].sort());
});

test('клиентский реестр без дублей и в алфавите', () => {
  assert.equal(ERROR_CODES.length, ERROR_CODE_SET.size, 'дубликат кода');
  assert.deepEqual([...ERROR_CODES], [...ERROR_CODES].sort(), 'коды должны быть в алфавите');
});
