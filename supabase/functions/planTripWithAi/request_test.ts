import { assertEquals } from 'jsr:@std/assert';
import { MAX_PROMPT, normalizeRequest } from './request.ts';

// Тот же способ различить исход, что у шва записи (`mutate.ts`): отказ несёт `status`.
const isRefusal = (r: unknown): r is { status: number; code: string } => !!r && typeof r === 'object' && 'status' in r;
const refused = (r: unknown) => (isRefusal(r) ? { status: r.status, code: r.code } : null);

const SID = '6f1b0f7a-6a1e-4a5f-9a3d-1b2c3d4e5f60';
const body = (extra: Record<string, unknown> = {}) => ({ sessionId: SID, prompt: 'Италия на 10 дней', ...extra });

Deno.test('реплика проходит: значения приведены, драфта нет — null', () => {
  const r = normalizeRequest(body({ language: 'ru' }));
  assertEquals(isRefusal(r), false);
  if (!isRefusal(r)) {
    assertEquals(r.sessionId, SID);
    assertEquals(r.prompt, 'Италия на 10 дней');
    assertEquals(r.language, 'ru');
    assertEquals(r.draft, null);
  }
});

Deno.test('★ потолок реплики = домен long_text: 10000 проходит, 10001 — отказ', () => {
  // Увидено красным мутацией `max: MAX_PROMPT` → без кэпа: реплика любой длины
  // уходила в платный LLM-вызов, хотя драфту потолок ставили именно поэтому.
  assertEquals(MAX_PROMPT, 10000);
  assertEquals(isRefusal(normalizeRequest(body({ prompt: 'a'.repeat(MAX_PROMPT) }))), false);
  assertEquals(refused(normalizeRequest(body({ prompt: 'a'.repeat(MAX_PROMPT + 1) }))), { status: 400, code: 'INVALID_INPUT' });
});

Deno.test('язык необязателен и может быть null — реплика проходит (границу не ужесточаем зря)', () => {
  assertEquals(isRefusal(normalizeRequest(body())), false, 'без языка');
  assertEquals(isRefusal(normalizeRequest(body({ language: null }))), false, 'язык null');
  assertEquals(isRefusal(normalizeRequest(body({ language: 'sr-Latn' }))), false, 'BCP-47 с подтегом');
  assertEquals(refused(normalizeRequest(body({ language: 'ru-RU-x-toolong' }))), { status: 400, code: 'INVALID_INPUT' });
});

Deno.test('★ отказ — контракт общего шва, а не свой: нет/пустой prompt, кривой sessionId', () => {
  assertEquals(refused(normalizeRequest({ sessionId: SID })), { status: 400, code: 'INVALID_INPUT' });
  assertEquals(refused(normalizeRequest(body({ prompt: '   ' }))), { status: 400, code: 'INVALID_INPUT' }, 'пробелы — не реплика');
  assertEquals(refused(normalizeRequest(body({ prompt: 42 }))), { status: 400, code: 'INVALID_INPUT' });
  assertEquals(refused(normalizeRequest({ prompt: 'x' })), { status: 400, code: 'INVALID_INPUT' }, 'sessionId обязателен');
  assertEquals(refused(normalizeRequest(body({ sessionId: 'not-a-uuid' }))), { status: 400, code: 'INVALID_INPUT' });
});

Deno.test('★ драфт проверяет ОДНА дверь: кривой узел валит всю реплику тем же отказом', () => {
  const ok = normalizeRequest(body({ draft: { nodes: [{ ref: '1', kind: 'transit', city_name: 'Рим', nights: 3 }] } }));
  assertEquals(isRefusal(ok), false);
  if (!isRefusal(ok)) assertEquals(ok.draft?.nodes.length, 1);
  assertEquals(refused(normalizeRequest(body({ draft: { nodes: [{ ref: '1', kind: 'moon' }] } }))), { status: 400, code: 'INVALID_INPUT' });
  assertEquals(refused(normalizeRequest(body({ draft: 'draft' }))), { status: 400, code: 'INVALID_INPUT' });
});
