/**
 * Форма драфта на границе доверия (TRIP-527).
 *
 * Фронт шлёт текущий черновик маршрута каждой репликой, edge пробрасывает его
 * в n8n, где он ложится в промпт модели. Содержимое здесь не интерпретируется —
 * словарь узлов и операций живёт на фронте (`src/pages/create/aiOps.js`), — но
 * форма и размер проверяются: это пользовательский ввод, который уходит в
 * платный LLM-вызов, и без потолка один запрос может унести с собой мегабайт.
 *
 * Правила: `draft` — объект либо отсутствует; узлов не больше `MAX_NODES`;
 * строки не длиннее `MAX_STR`; поля узла — только известные, лишние срезаются;
 * `nights`/`geonameid` — числа либо null. Нарушение = 400, не «молча срезать».
 */

export const MAX_NODES = 60;
export const MAX_STR = 200;

const KINDS = new Set(['start', 'transit', 'waypoint', 'end']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Node = {
  ref: string;
  kind: string;
  city_name: string;
  city_name_en: string;
  country_code: string;
  nights: number | null;
  geonameid: number | null;
};

export type Draft = { startDate: string; title: string; nodes: Node[] };

type Result = { ok: true; draft: Draft | null } | { ok: false; error: string };

const str = (v: unknown, name: string, allowEmpty = true): string => {
  if (v == null) { if (allowEmpty) return ''; throw new Error(`${name} required`); }
  if (typeof v !== 'string') throw new Error(`${name} must be a string`);
  if (v.length > MAX_STR) throw new Error(`${name} too long`);
  if (!allowEmpty && v.trim() === '') throw new Error(`${name} required`);
  return v;
};

const numOrNull = (v: unknown, name: string): number | null => {
  if (v == null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${name} must be a number`);
  return v;
};

/**
 * Приводит тело `draft` к известной форме. `undefined`/`null` — законно (первая
 * реплика без черновика). Всё остальное обязано быть объектом известной формы.
 */
export function normalizeDraft(input: unknown): Result {
  if (input == null) return { ok: true, draft: null };
  if (typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'draft must be an object' };
  const d = input as Record<string, unknown>;
  try {
    const startDate = str(d.startDate, 'draft.startDate');
    if (startDate && !DATE_RE.test(startDate)) throw new Error('draft.startDate must be YYYY-MM-DD');
    const title = str(d.title, 'draft.title');
    const rawNodes = d.nodes ?? [];
    if (!Array.isArray(rawNodes)) throw new Error('draft.nodes must be an array');
    if (rawNodes.length > MAX_NODES) throw new Error(`draft.nodes: at most ${MAX_NODES}`);
    const nodes: Node[] = rawNodes.map((n, i) => {
      if (!n || typeof n !== 'object' || Array.isArray(n)) throw new Error(`draft.nodes[${i}] must be an object`);
      const x = n as Record<string, unknown>;
      const kind = str(x.kind, `draft.nodes[${i}].kind`, false);
      if (!KINDS.has(kind)) throw new Error(`draft.nodes[${i}].kind unknown`);
      return {
        ref: str(x.ref, `draft.nodes[${i}].ref`, false),
        kind,
        city_name: str(x.city_name, `draft.nodes[${i}].city_name`),
        city_name_en: str(x.city_name_en, `draft.nodes[${i}].city_name_en`),
        country_code: str(x.country_code, `draft.nodes[${i}].country_code`),
        nights: numOrNull(x.nights, `draft.nodes[${i}].nights`),
        geonameid: numOrNull(x.geonameid, `draft.nodes[${i}].geonameid`),
      };
    });
    return { ok: true, draft: { startDate, title, nodes } };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
