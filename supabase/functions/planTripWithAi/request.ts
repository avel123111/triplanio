/**
 * Форма РЕПЛИКИ на границе доверия (TRIP-527).
 *
 * ★ ОДНА ДВЕРЬ НА ВСЁ ТЕЛО. Хендлер не проверяет поля сам: он зовёт
 * `normalizeRequest` и дальше работает с уже приведёнными значениями. Движок —
 * тот же `validateFields` из `_shared/mutateRules.ts`, что у ресурсов записи и
 * у драфта; отказ — тот же `Refusal` (`INVALID_INPUT`), который уезжает клиенту
 * через `refusalResponse`. Своих `if (!prompt)` здесь нет.
 *
 * ★★ ПОЧЕМУ У `prompt` ЕСТЬ ПОТОЛОК. Драфту потолки поставили потому, что он
 * уходит в платный LLM-вызов, — но ровно туда же уходит и сам текст реплики, а
 * он не был ограничен ничем: ни формой (`maxLength` у композера нет), ни здесь.
 * Кэп = домен `public.long_text` (10 000) — то же число, которым в проекте уже
 * назван «длинный пользовательский текст» (`max: 10000` в спеках ресурсов);
 * второго числа для того же смысла не заводится. Порядок живого ввода известен:
 * самая длинная реальная реплика в истории планировщика — вставленный
 * пользователем план на 4158 символов.
 *
 * Лежит ОТДЕЛЬНО от `index.ts` по той же причине, что `mutateRules.ts` отдельно
 * от `mutate.ts`: `index.ts` зовёт `Deno.serve` на загрузке модуля, и из теста
 * его не подгрузить. Здесь — чистая половина, у неё есть `request_test.ts`.
 */

import { bad, type FieldSpec, type Refusal, validateFields } from '../_shared/mutateRules.ts';
import { type Draft, normalizeDraft } from './draft.ts';

/** = `public.long_text` (`char_length(value) <= 10000`). */
export const MAX_PROMPT = 10000;

const BODY_FIELDS: Record<string, FieldSpec> = {
  // Ключ памяти разговора на стороне n8n. Фронт выдаёт `crypto.randomUUID()`,
  // поэтому форма проверяется как uuid — общим предикатом шва, не своим regex.
  sessionId: { type: 'uuid', required: true },
  // Пустая строка — не реплика: форма (тип, кэп) движком, непустота — хуком.
  prompt: {
    type: 'string',
    required: true,
    max: MAX_PROMPT,
    validate: (v) => (String(v).trim() ? null : bad('Field "prompt" must not be empty')),
  },
  // Язык ответа модели. Enum здесь НЕ объявлен намеренно: список языков живёт на
  // фронте, и новый язык не должен ронять реплику на границе — держим только
  // форму: 8 = потолок BCP-47-тега, который может прислать фронт (`ru`,
  // `pt-BR`, `sr-Latn` — 7 знаков худший случай). `nullable`, потому что «языка
  // нет» — законный вход (модель ответит на языке реплики), а ужесточать
  // границу без нужды значит ронять живой запрос ради красоты спеки.
  language: { type: 'string', max: 8, nullable: true },
};

export type PlanRequest = {
  sessionId: string;
  prompt: string;
  language?: string;
  /** `null` — первая реплика без черновика (законно). */
  draft: Draft | null;
};

/**
 * Тело реплики → известная форма либо `Refusal` (400 `INVALID_INPUT`).
 * `draft` проверяет `normalizeDraft` — второго правила для того же поля здесь нет.
 */
export function normalizeRequest(input: Record<string, unknown>): Refusal | PlanRequest {
  const checked = validateFields(BODY_FIELDS, input, { insert: true });
  if ('status' in checked) return checked;
  const parsed = normalizeDraft(input.draft);
  if ('status' in parsed) return parsed;
  const v = checked.values as { sessionId: string; prompt: string; language?: string };
  return { sessionId: v.sessionId, prompt: v.prompt, language: v.language, draft: parsed.draft };
}
