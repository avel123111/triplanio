// @ts-check
/**
 * ОПЕРАЦИИ ИИ НАД ЧЕРНОВИКОМ МАРШРУТА (TRIP-527, эпик TRIP-524 Ф2).
 *
 * ★ ЧТО ЗДЕСЬ ИСПРАВЛЕНО. Модель отвечала ВЕСЬ маршрут на каждую реплику, а
 * фронт применял его полной заменой. Отсюда «попросил поменять один город —
 * пересобрал всё» и потеря контекста на третьем круге правок. Теперь драфт —
 * единственная правда и живёт на фронте; модель получает его каждой репликой
 * как данность и отвечает СПИСКОМ ОПЕРАЦИЙ над ним (или без операций — просто
 * текстом, разговор тоже законный ход).
 *
 * ★★ СЛОВАРЬ ОПЕРАЦИЙ ЖИВЁТ ЗДЕСЬ И ТОЛЬКО ЗДЕСЬ. `OPS` — единственный источник:
 * из него применятор проверяет форму, из него `opsJsonSchema()` собирает схему
 * парсера для n8n (кладётся туда как есть), из него `opsPromptLines()` даёт
 * строки для системного промпта. Дрейф между репо и n8n машинно не проверяется
 * (воркфлоу не версионируется) — поэтому источник один, а копии производные.
 *
 * ⚠️ МОДУЛЬ ЧИСТЫЙ. Импорты относительные (как у `routeModel`): тесты гоняет
 * голый `node --test`, алиас `@/` он не разрешает. Сети здесь нет: города из
 * операций резолвит ВЫЗЫВАТЕЛЬ тем же батчем газеттира, что и раньше, и отдаёт
 * их сюда массивом, выровненным с `citiesInOps(ops)` — порядок обхода в обеих
 * функциях один, и это запинено тестом.
 *
 * ⚠️ БИТАЯ ОПЕРАЦИЯ ПРОПУСКАЕТСЯ И СООБЩАЕТСЯ, а не роняет ответ: у модели
 * бывает неверный `ref` или дата в прошлом, и человек должен это увидеть
 * строкой «не смог», а не пустым экраном. Остальные операции применяются.
 *
 * Ссылки на узлы — по `ref`, который выдал фронт (`String(node.id)`, см.
 * `toDraftPayload`). Модель эхом возвращает его как есть.
 */
import {
  makeNode, insertNode, withNights, recomputeDates, isAnchorNode, cityNodesOf, endOf, refOf,
} from './routeModel.js';
import { isYmd } from '../../lib/time.js';

const CITY = { city_name: 'string', city_name_en: 'string', country: 'string?', country_code: 'string' };

/* ⚠️ ОДНО ИМЯ НА ОДИН СМЫСЛ. Поля всех операций лежат в схеме парсера плоско,
   и модель выбирает имя по смыслу, а не по операции: пока дата старта у
   `set_route` звалась `startDate`, а у `set_start_date` — `date`, модель на
   прогоне отдала `set_start_date {startDate}` (замер 07.09.2026, 2 из 2). Поэтому
   дата старта везде `startDate`, город везде `city_name…`, узел везде `ref`. */

/**
 * Словарь операций. `fields` — форма (тип каждого поля; `?` = необязательное;
 * имена типов — те же, что у `FieldSpec` бэка: `string`/`number`/`date`),
 * `city` — операция несёт город и потребляет один резолв, `doc` — строка для
 * промпта. Имена полей города те же, что модель отдавала и раньше.
 * @type {Record<string, { fields: Record<string, string>, city?: boolean, doc: string }>}
 */
export const OPS = {
  set_route: {
    fields: { title: 'string?', startDate: 'date?', nodes: 'nodes' },
    doc: 'set_route — построить маршрут с нуля. ТОЛЬКО когда в драфте нет ни одного города. nodes: список {kind: start|transit|end, city_name, city_name_en, country, country_code, nights}. У start/end ночей нет.',
  },
  add_city: {
    fields: { ...CITY, nights: 'number?', after: 'ref?' },
    city: true,
    doc: 'add_city — добавить город. nights по умолчанию 3; after: ref узла, после которого вставить (без after — в конец, перед финишем).',
  },
  replace_city: {
    fields: { ref: 'ref', ...CITY },
    city: true,
    doc: 'replace_city — заменить город на другой на том же месте, ночи сохраняются («вместо Канн — Марсель»).',
  },
  remove_city: {
    fields: { ref: 'ref' },
    doc: 'remove_city — убрать узел из маршрута.',
  },
  move_city: {
    fields: { ref: 'ref', after: 'ref?' },
    doc: 'move_city — переставить город после узла after; без after — в начало маршрута.',
  },
  set_nights: {
    fields: { ref: 'ref', nights: 'number' },
    doc: 'set_nights — задать число ночей в городе (0 = проездом, пересадка).',
  },
  set_start: {
    fields: { ...CITY },
    city: true,
    doc: 'set_start — задать город отправления (откуда выезжают). Только если человек его назвал.',
  },
  set_end: {
    fields: { ...CITY },
    city: true,
    doc: 'set_end — задать город возвращения (куда возвращаются в конце). Только если человек его назвал.',
  },
  clear_end: {
    fields: {},
    doc: 'clear_end — убрать возвращение: маршрут кончается последним городом.',
  },
  set_start_date: {
    fields: { startDate: 'date' },
    doc: 'set_start_date — дата начала поездки: startDate (YYYY-MM-DD, не раньше сегодня).',
  },
  set_title: {
    fields: { title: 'string' },
    doc: 'set_title — название поездки (1–3 слова).',
  },
};

/**
 * Причины отказа — фиксированный набор. Человеку они больше не показываются
 * (строк `ai_plan.fail_*` нет с TRIP-527: дописывать отказ под чужим текстом
 * бота нечестно) — причина уезжает в телеметрию вызывателя, где по ней и видно
 * расхождение «бот сказал, что сделал» ↔ «применятор не смог».
 */
export const REASONS = /** @type {const} */ ({
  unknown_op: 'unknown_op',
  bad_shape: 'bad_shape',
  unknown_ref: 'unknown_ref',
  route_not_empty: 'route_not_empty',
  past_date: 'past_date',
  anchor: 'anchor',
});

const isDate = (v) => isYmd(v) && !Number.isNaN(Date.parse(v));
// `number` в словаре — это всегда ЧИСЛО НОЧЕЙ: целое и неотрицательное. Имя типа
// общее с `FieldSpec` бэка, предикат строже — дробных ночей в маршруте не бывает.
const isCount = (v) => Number.isInteger(v) && v >= 0;
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isRef = (v) => typeof v === 'string' || typeof v === 'number';

/** Проверка одного поля по типу словаря. */
function fieldOk(type, v) {
  const optional = type.endsWith('?');
  const t = optional ? type.slice(0, -1) : type;
  if (v == null || v === '') return optional;
  if (t === 'string') return isStr(v);
  if (t === 'date') return isDate(v);
  if (t === 'number') return isCount(v);
  if (t === 'ref') return isRef(v);
  if (t === 'nodes') return Array.isArray(v) && v.every((n) => n && isStr(n.city_name) && ['start', 'transit', 'end'].includes(n.kind));
  return false;
}

/**
 * Форма операции по словарю. Возвращает причину отказа либо `null`.
 * @param {any} op
 */
export function opShapeError(op) {
  if (!op || typeof op !== 'object' || !OPS[op.op]) return REASONS.unknown_op;
  const spec = OPS[op.op];
  for (const [name, type] of Object.entries(spec.fields)) {
    if (!fieldOk(type, op[name])) return REASONS.bad_shape;
  }
  return null;
}

const pickCity = (src) => ({
  city_name: src?.city_name || '',
  city_name_en: src?.city_name_en || '',
  country: src?.country || '',
  country_code: (src?.country_code || '').toUpperCase(),
});

/**
 * Города, которые несут операции, В ПОРЯДКЕ ПОТРЕБЛЕНИЯ применятором: у
 * `set_route` — каждый узел, у city-операций — сам город. Вызыватель резолвит
 * этот список одним батчем и отдаёт результат в `applyOps` как `cities`.
 * Операции битой формы городов не дают — применятор их и не потребит.
 * @param {any[]} ops
 */
export function citiesInOps(ops) {
  const out = [];
  for (const op of ops || []) {
    if (opShapeError(op)) continue;
    if (op.op === 'set_route') for (const n of op.nodes) out.push(pickCity(n));
    else if (OPS[op.op].city) out.push(pickCity(op));
  }
  return out;
}

const findIdx = (nodes, ref) => nodes.findIndex((n) => refOf(n) === String(ref));

/**
 * Городской узел из операции: ночи ведёт `withNights` (ноль ночей = пересадка),
 * по умолчанию три. Ночи узлу выдаёт ТОЛЬКО эта дорога — `makeNode` их здесь не
 * получает, иначе `withNights` тут же перезапишет и число, и вид.
 */
const cityNode = (city, nights) => withNights(makeNode(city, 'transit'), nights ?? 3);

/** Вставка после узла с индексом `idx`, но никогда после финиша. */
function insertAfter(nodes, idx, node) {
  const arr = nodes.slice();
  const endIdx = arr.findIndex((n) => n.kind === 'end');
  const at = Math.min(idx + 1, endIdx === -1 ? arr.length : endIdx);
  arr.splice(at, 0, node);
  return arr;
}

/**
 * Применить операции к черновику.
 *
 * @param {{ nodes: any[], startDate: string, title: string }} state
 * @param {any[]} ops
 * @param {{ cities?: any[], today: string }} ctx  `cities` выровнены с `citiesInOps(ops)`;
 *   `today` — YYYY-MM-DD, порог для дат (передаётся снаружи ради тестов).
 * @returns {{ nodes: any[], startDate: string, title: string,
 *             applied: Array<Record<string, any>>, rejected: Array<{ op: string, reason: string }> }}
 */
export function applyOps(state, ops, { cities = [], today }) {
  let nodes = (state.nodes || []).slice();
  let { startDate, title } = state;
  const applied = [];
  const rejected = [];
  let ci = 0; // курсор по резолвленным городам — тот же порядок, что у citiesInOps
  const nextCity = (raw) => cities[ci++] || pickCity(raw);
  const reject = (op, reason) => rejected.push({ op: op?.op || '?', reason });

  for (const op of ops || []) {
    const shape = opShapeError(op);
    if (shape) { reject(op, shape); continue; }

    switch (op.op) {
      case 'set_route': {
        // Города резолвятся В ЛЮБОМ СЛУЧАЕ (курсор обязан сдвинуться), но
        // маршрут строится только на пустом драфте.
        const resolved = op.nodes.map((n) => ({ kind: n.kind, nights: n.nights, city: nextCity(n) }));
        if (cityNodesOf(nodes).length > 0) { reject(op, REASONS.route_not_empty); break; }
        let next = [];
        let count = 0;
        for (const r of resolved) {
          const kind = /** @type {import('./routeModel.js').NodeKind} */ (r.kind);
          const node = kind === 'transit' ? cityNode(r.city, r.nights) : makeNode(r.city, kind);
          const ins = insertNode(next, node);
          if (!ins) continue; // второй якорь молча не заводится (как в редакторе)
          next = ins;
          if (!isAnchorNode(node)) count++;
        }
        nodes = next;
        if (isStr(op.title)) title = op.title.trim();
        if (op.startDate) {
          if (op.startDate >= today) startDate = op.startDate;
          else rejected.push({ op: 'set_start_date', reason: REASONS.past_date });
        }
        applied.push({ op: 'set_route', count });
        break;
      }
      case 'add_city': {
        const city = nextCity(op);
        const node = cityNode(city, op.nights);
        if (op.after != null) {
          const idx = findIdx(nodes, op.after);
          if (idx === -1) { reject(op, REASONS.unknown_ref); break; }
          // Имя якоря снимаем ДО вставки: при after=финиш вставка ложится ПЕРЕД
          // ним, и `nodes[idx]` после сплайса — уже новый город. Ставить «после
          // финиша» нельзя, поэтому такой случай для человека = обычное «добавил».
          const anchor = nodes[idx].kind === 'end' ? null : nodes[idx].city_name;
          nodes = insertAfter(nodes, idx, node);
          applied.push(anchor ? { op: 'add_city', city: city.city_name, after: anchor } : { op: 'add_city', city: city.city_name });
        } else {
          nodes = insertNode(nodes, node) || nodes;
          applied.push({ op: 'add_city', city: city.city_name });
        }
        break;
      }
      case 'replace_city': {
        const city = nextCity(op);
        const idx = findIdx(nodes, op.ref);
        if (idx === -1) { reject(op, REASONS.unknown_ref); break; }
        const old = nodes[idx];
        // Место, id, вид и ночи — прежние; меняется только сам город.
        nodes[idx] = makeNode(city, old.kind, { id: old.id, nights: old.nights ?? undefined });
        applied.push({ op: 'replace_city', from: old.city_name, to: city.city_name });
        break;
      }
      case 'remove_city': {
        const idx = findIdx(nodes, op.ref);
        if (idx === -1) { reject(op, REASONS.unknown_ref); break; }
        const [gone] = nodes.splice(idx, 1);
        applied.push({ op: 'remove_city', city: gone.city_name });
        break;
      }
      case 'move_city': {
        const idx = findIdx(nodes, op.ref);
        if (idx === -1) { reject(op, REASONS.unknown_ref); break; }
        if (isAnchorNode(nodes[idx])) { reject(op, REASONS.anchor); break; }
        const [node] = nodes.splice(idx, 1);
        if (op.after != null) {
          const at = findIdx(nodes, op.after);
          if (at === -1) { nodes.splice(idx, 0, node); reject(op, REASONS.unknown_ref); break; }
          nodes = insertAfter(nodes, at, node);
        } else {
          // В начало маршрута — сразу после старта, если он есть.
          const startAt = nodes.findIndex((n) => n.kind === 'start');
          nodes.splice(startAt + 1, 0, node);
        }
        applied.push({ op: 'move_city', city: node.city_name });
        break;
      }
      case 'set_nights': {
        const idx = findIdx(nodes, op.ref);
        if (idx === -1) { reject(op, REASONS.unknown_ref); break; }
        if (isAnchorNode(nodes[idx])) { reject(op, REASONS.anchor); break; }
        nodes[idx] = withNights(nodes[idx], op.nights);
        applied.push({ op: 'set_nights', city: nodes[idx].city_name, nights: op.nights });
        break;
      }
      case 'set_start':
      case 'set_end': {
        const kind = op.op === 'set_start' ? 'start' : 'end';
        const city = nextCity(op);
        const idx = nodes.findIndex((n) => n.kind === kind);
        if (idx === -1) nodes = insertNode(nodes, makeNode(city, kind)) || nodes;
        else nodes[idx] = makeNode(city, kind, { id: nodes[idx].id });
        applied.push({ op: op.op, city: city.city_name });
        break;
      }
      case 'clear_end': {
        const end = endOf(nodes);
        if (!end) { reject(op, REASONS.unknown_ref); break; }
        nodes = nodes.filter((n) => n !== end);
        applied.push({ op: 'clear_end' });
        break;
      }
      case 'set_start_date': {
        if (op.startDate < today) { reject(op, REASONS.past_date); break; }
        startDate = op.startDate;
        applied.push({ op: 'set_start_date', date: op.startDate });
        break;
      }
      case 'set_title': {
        title = op.title.trim();
        applied.push({ op: 'set_title', title });
        break;
      }
      default:
        reject(op, REASONS.unknown_op);
    }
  }

  return { nodes: recomputeDates(nodes, startDate), startDate, title, applied, rejected };
}

// ─── Производные от словаря: схема парсера и строки промпта ─────────────────

const JSON_TYPES = {
  string: { type: 'string' },
  date: { type: 'string', description: 'YYYY-MM-DD' },
  number: { type: 'integer', minimum: 0 },
  ref: { type: 'string' },
};

/**
 * JSON-схема ответа модели для Structured Output Parser в n8n — собирается из
 * `OPS`, чтобы у словаря не было второй рукописной копии. Поля всех операций
 * лежат плоско в одном объекте (парсеру так проще), обязательное только `op`.
 */
export function opsJsonSchema() {
  const props = { op: { type: 'string', enum: Object.keys(OPS) } };
  for (const spec of Object.values(OPS)) {
    for (const [name, type] of Object.entries(spec.fields)) {
      if (props[name]) continue; // одно имя на один смысл: первая операция задаёт форму поля
      const t = type.replace(/\?$/, '');
      props[name] = t === 'nodes'
        ? {
          type: 'array',
          items: {
            type: 'object',
            required: ['kind', 'city_name', 'city_name_en', 'country_code'],
            properties: {
              kind: { type: 'string', enum: ['start', 'transit', 'end'] },
              ...Object.fromEntries(Object.keys(CITY).map((k) => [k, JSON_TYPES.string])),
              nights: JSON_TYPES.number,
            },
          },
        }
        : JSON_TYPES[t];
    }
  }
  return {
    type: 'object',
    required: ['ai_comment', 'ops'],
    properties: {
      ai_comment: { type: 'string' },
      ops: { type: 'array', items: { type: 'object', required: ['op'], properties: props } },
    },
  };
}

/** Строки описания операций для системного промпта — по одной на операцию. */
export function opsPromptLines() {
  return Object.values(OPS).map((s) => s.doc);
}
