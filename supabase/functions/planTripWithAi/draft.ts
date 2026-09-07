/**
 * Форма драфта на границе доверия (TRIP-527).
 *
 * Фронт шлёт текущий черновик маршрута каждой репликой, edge пробрасывает его в
 * n8n, где он ложится в промпт модели. Содержимое здесь не интерпретируется —
 * словарь узлов и операций живёт на фронте (`src/pages/create/aiOps.js`), — но
 * форма и размер проверяются: это пользовательский ввод, который уходит в
 * платный LLM-вызов, и без потолка один запрос может унести с собой мегабайт.
 *
 * ★ ВАЛИДАТОР — ОБЩИЙ ШОВ, НЕ СВОЙ. Спек полей — тот же `FieldSpec`, что у
 * ресурсов записи (`_shared/mutateRules.ts`): движок `validateFields` держит
 * тип/кэп/enum/nullable, массив узлов гоняет `validateEach` — тем же правилом,
 * что `cities` при создании трипа. Отказ — тот же `Refusal` (`INVALID_INPUT`),
 * что у шва записи, и уходит клиенту через `refusalResponse`. Своего regex
 * даты, своих `str()`/`num()` и своего словаря типов здесь нет.
 *
 * Кэп строки = домен `short_text` в БД (300): у драфта своего хранилища нет, но
 * второе число для «короткой строки» в проекте не заводится.
 */

import {
  type FieldSpec,
  type Refusal,
  bad,
  validateEach,
  validateFields,
} from '../_shared/mutateRules.ts';

export const MAX_NODES = 60;
/** = `public.short_text` (`char_length(value) <= 300`). */
export const MAX_STR = 300;

const NODE_FIELDS: Record<string, FieldSpec> = {
  ref: { type: 'string', required: true, max: MAX_STR },
  kind: { type: 'string', required: true, enum: ['start', 'transit', 'waypoint', 'end'] },
  city_name: { type: 'string', max: MAX_STR },
  city_name_en: { type: 'string', max: MAX_STR },
  country_code: { type: 'string', max: MAX_STR },
  nights: { type: 'number', min: 0, nullable: true },
  geonameid: { type: 'number', nullable: true },
};

const eachNode = validateEach(NODE_FIELDS, 'draft.nodes');
const DRAFT_FIELDS: Record<string, FieldSpec> = {
  startDate: { type: 'date', nullable: true },
  title: { type: 'string', max: MAX_STR },
  nodes: {
    type: 'array',
    required: true,
    // Потолок числа узлов — доменное правило поверх формы элементов.
    validate: (v) => (Array.isArray(v) && v.length > MAX_NODES
      ? bad(`Field "draft.nodes" must have at most ${MAX_NODES} entries`)
      : eachNode(v)),
  },
};

export type DraftNode = {
  ref: string;
  kind: string;
  city_name?: string;
  city_name_en?: string;
  country_code?: string;
  nights?: number | null;
  geonameid?: number | null;
};
export type Draft = { startDate: string | null; title: string; nodes: DraftNode[] };

/** Только объявленные поля узла едут дальше — в промпт не уходит ничего лишнего. */
const pickNode = (n: Record<string, unknown>): DraftNode => {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(NODE_FIELDS)) if (k in n) out[k] = n[k];
  return out as DraftNode;
};

/**
 * Приводит тело `draft` к известной форме. `undefined`/`null` — законно (первая
 * реплика без черновика) → `null`. Нарушение формы → `Refusal` (400,
 * `INVALID_INPUT`), как у любого шва записи.
 */
export function normalizeDraft(input: unknown): Draft | null | Refusal {
  if (input == null) return null;
  if (typeof input !== 'object' || Array.isArray(input)) return bad('Field "draft" must be an object');
  const r = validateFields(DRAFT_FIELDS, input as Record<string, unknown>, { insert: true });
  if ('status' in r) return r;
  const v = r.values;
  return {
    startDate: (v.startDate as string | null | undefined) ?? null,
    title: (v.title as string | undefined) ?? '',
    nodes: (v.nodes as Record<string, unknown>[]).map(pickNode),
  };
}

export const isRefusal = (r: unknown): r is Refusal =>
  !!r && typeof r === 'object' && 'status' in r && 'code' in r;
