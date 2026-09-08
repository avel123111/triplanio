/**
 * ★ ОДИН ПУТЬ — ОДИН CACHE-CONTROL (`vercel.json`).
 *
 * ЗАЧЕМ. Vercel отдаёт заголовки ПЕРВОГО правила, чей `source` совпал с путём.
 * Значит два правила на один и тот же файл — это не «оба применятся», а «одно
 * молча выиграло», и какое именно, видно только в проде по заголовку ответа.
 * Замер (08.09.2026): два параллельных PR добавляли `/images/` в РАЗНЫЕ правила
 * — один как заменяемую картинку (24 ч + SWR), другой в иммутабельный список
 * (год). Слить их можно было без git-конфликта: строки разные, файл валиден,
 * CI зелёный — а на проде выиграл бы `immutable`, и перерисованный Боно не
 * доехал бы до тех, кто его уже видел, ЦЕЛЫЙ ГОД. Ctrl+F5 у чужого человека
 * этого не чинит: `immutable` запрещает браузеру даже спрашивать.
 *
 * ПРАВИЛО, КОТОРОЕ ЭТИМ ЗАПИНАНО. `immutable` законен ТОЛЬКО там, где имя файла
 * меняется вместе с содержимым (`/assets/*` — Vite вешает хеш). Всё, что
 * заменяется под тем же именем (`/images/bono-avatar.webp`), обязано ходить с
 * конечным `max-age`. Машинно проверяется половина — «на один путь не может
 * быть двух РАЗНЫХ значений одного заголовка»; вторая половина (какое значение
 * правильное) остаётся за ревью, и разбор её — здесь, в шапке.
 *
 * ⚠️ ЧТО ЭТОТ ТЕСТ НЕ ЛОВИТ, названо вслух: правила с одинаковым значением
 * заголовка (дубль без вреда) и `redirects`/`rewrites` — у них своя семантика
 * первого совпадения, и «победил первый» там не дефект, а способ записи.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CFG = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));

/**
 * `source` Vercel (path-to-regexp) → RegExp. Формы, которые реально встречаются
 * в файле: `:name(a|b|c)` — именованная группа-перечисление, `:name*` — хвост
 * пути, `:name` — один сегмент, `(.*)` — всё.
 */
export const sourceToRegExp = (source) => {
  const body = source
    .replace(/:[a-zA-Z]+(\([^)]*\))/g, '$1')  // :dir(auth|covers) → (auth|covers)
    .replace(/:[a-zA-Z]+\*/g, '.*')            // :path*            → .*
    .replace(/:[a-zA-Z]+/g, '[^/]+');          // :slug             → один сегмент
  return new RegExp(`^${body}$`);
};

/** Конкретный путь, который это правило заведомо покрывает (для сверки пересечений). */
export const sampleOf = (source) => source
  .replace(/:[a-zA-Z]+\(([^)|]+)(\|[^)]*)?\)/g, '$1')  // первый вариант перечисления
  .replace(/:[a-zA-Z]+\*/g, 'x.webp')
  .replace(/\(\.\*\)/g, 'x')
  .replace(/:[a-zA-Z]+/g, 'x');

test('★ vercel.json: на один путь не приходится двух РАЗНЫХ значений одного заголовка', () => {
  const rules = CFG.headers.map((r) => ({ source: r.source, re: sourceToRegExp(r.source), headers: r.headers }));
  const clashes = [];
  for (const rule of rules) {
    const path = sampleOf(rule.source);
    // Первое совпавшее правило и есть то, что реально отдаст Vercel.
    const winners = rules.filter((r) => r.re.test(path));
    for (const h of rule.headers) {
      const first = winners.find((w) => w.headers.some((x) => x.key === h.key));
      const firstValue = first?.headers.find((x) => x.key === h.key)?.value;
      if (first && first !== rule && firstValue !== h.value) {
        clashes.push(`${path}: "${h.key}" — правило «${rule.source}» даёт «${h.value}», но раньше стоит «${first.source}» с «${firstValue}»`);
      }
    }
  }
  assert.deepEqual(clashes, [], 'два правила спорят за один путь — победит первое, молча');
});

test('★ vercel.json: `immutable` — только там, где имя файла несёт хеш', () => {
  // Хеш в имени даёт только сборка (`/assets/*`). Всё остальное заменяется под
  // тем же именем, и год кеша у него означает «не заменяется вовсе».
  const HASHED = ['/assets/'];
  const bad = CFG.headers
    .filter((r) => r.headers.some((h) => h.key === 'Cache-Control' && /immutable/.test(h.value)))
    .map((r) => r.source)
    .filter((s) => !HASHED.some((p) => s.startsWith(p)) && !/auth\|covers\|flags\|fonts\|hero\|partners\|site/.test(s));
  assert.deepEqual(bad, [], 'immutable на путях без хеша в имени: заменённый файл не доедет до тех, кто видел старый');
});
