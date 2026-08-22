/**
 * Реестр объектов витрины `/kit` — ПЛОСКИЕ ДАННЫЕ, без JSX (TRIP-344).
 *
 * ★ ЗАЧЕМ ОТДЕЛЬНЫМ `.js`-МОДУЛЕМ. Реестр — единственный источник и для страницы
 * (`Kit.jsx` рисует по нему), и для теста дрейфа (`Kit.test.js` судит по нему).
 * Тест бежит в `node --test` и JSX импортировать не умеет, поэтому данные,
 * которые он читает, обязаны жить в чистом модуле без разметки. Рецепты рендера
 * (JSX) лежат в `Kit.jsx` и ссылаются сюда по `id`/`family` — одна карта, два
 * читателя, разойтись им между собой нельзя по построению; разойтись они могут
 * только с CSS, а это ровно то, что тест и ловит.
 *
 * ★ ДВА ВИДА ИСТОЧНИКА ОСИ (решение Pavel, TRIP-344):
 *   • `maps` — КАРТА ВАРИАНТОВ, экспортированная самим примитивом (`BTN_VARIANTS`
 *     и т.п.). Тот же union, что типизирует проп: `variant="compact"` — ошибка
 *     редактора, страница объекта полна по построению. Только у семьи кнопки:
 *     строгие юнионы там уже есть (btn·icon-btn·chip·seg·stepper·swatch).
 *   • `css` — CSS-ПРОИЗВОДНЫЙ СПИСОК СЕМЬИ: страница берёт объявленные
 *     `.family--*` из ЖИВЫХ стилей и рисует каждый. Для семей, которые ещё не
 *     получили свой примитив/юнион (бейдж — объект №4, поле, плитка …): когда
 *     объект дойдёт до разбора, он закроет юнион и переключит источник на `maps`.
 *
 * ★ `css:false` У СЕГМЕНТА — НЕ ЗАБЫВЧИВОСТЬ. `seg--filter`/`seg--view` —
 * ЭКРАННЫЕ адаптивы Trips (order/flex в `.trips-toolbar`), а не обличья самого
 * `Seg`. Показывать их на витрине примитива нечем и незачем; они уходят в долг
 * витрины (`NOT_SHOWN`), а не в источник оси. Поэтому у `seg` только `maps`.
 *
 * ★ `family` — та же нарезка, что у `familyOf` в `audit-design.mjs`: имя до
 * первого `-`/`--`/`__`. `icon-btn`→`icon`, `empty-state`→`empty`,
 * `doc-row`→`doc`, `sheet-row`→`sheet`, `ai-blk`→`ai`, `input-*`→`input`,
 * `field-row`→`field`. `special` — секция-ЗАМЕР (шкала/токены/типографика): у
 * неё нет канон-семьи с вариантами, значения читаются из живых стилей приборно.
 *
 * ★ КАРТА vs CSS И ЗАЩИТА ДРЕЙФА. У семьи кнопки источник — `maps` (+ `extras`
 * для НЕ-union классов: `btn--sm` размер, `btn--brand` тень, `icon-btn--round`
 * форма, булевы модификаторы `fpill`). `css:false` тут НЕСУЩЕЕ: тогда «показано»
 * теста = карта ∪ extras, и направление 1 КРАСНЕЕТ, если карта неполна или
 * появился новый класс — та самая полнота, которую тип дать не может. У прочих
 * семей `css:true`: «показано» = CSS-производный список, страница рисует его
 * циклом (полна по построению в рантайме), скриншот сверяет облик.
 *
 * ★ `family` (нарезка `familyOf`) — для СТАТУСА из каталога и группировки CSS.
 * `prefix` — ПОЛНЫЙ префикс класса, из которого карта/extras собирают имя
 * `prefix--value`. У составных имён они РАСХОДЯТСЯ: `icon-btn--soft` — семья
 * `icon`, префикс `icon-btn`; отсюда отдельное поле, иначе тест построил бы
 * несуществующий `icon--soft`. Где не задан — префикс равен семье.
 *
 * @typedef {{ id: string, family: string|null, group: string, prefix?: string,
 *   maps?: string[], extras?: string[], css?: boolean,
 *   special?: 'spacing'|'tokens'|'typography', interactive?: boolean }} KitObject
 * @type {KitObject[]} */
export const KIT_OBJECTS = [
  // ── Компоненты ──────────────────────────────────────────────────────────
  { id: 'pagehead', family: 'pagehead', group: 'components', css: false },
  // TRIP-350: тон Stat едет союзом тонов `<Tile tone>` (event tones на .tile),
  // своих `.stat--<tone>` классов у семьи больше нет — источник вариантов = CSS
  // (`.stat--clickable`), карту STAT_TONES не заявляем.
  { id: 'stat', family: 'stat', group: 'components', prefix: 'stat', css: true, interactive: true },
  { id: 'list-row', family: 'lrow', group: 'components', prefix: 'lrow', maps: ['LISTROW_VARIANTS'], extras: ['clickable', 'on'], interactive: true },
  { id: 'donut', family: 'donut', group: 'components', css: false },
  { id: 'btn', family: 'btn', group: 'components', prefix: 'btn', maps: ['BTN_VARIANTS'], extras: ['sm', 'brand'], interactive: true },
  { id: 'icon-btn', family: 'icon', group: 'components', prefix: 'icon-btn', maps: ['ICON_BTN_TONES', 'ICON_BTN_SIZES'], extras: ['round'], interactive: true },
  { id: 'chip', family: 'fpill', group: 'components', prefix: 'fpill', maps: ['CHIP_VARIANTS'], extras: ['square', 'sm', 'avatars', 'dismiss'], interactive: true },
  { id: 'seg', family: 'seg', group: 'components', prefix: 'seg', maps: ['SEG_VARIANTS'] },
  // Строка уведомления — источник оси CSS-производный: обличья = объявленные
  // `.notif--*` (`--unread`/`--compact`/`--link`), витрина рисует через <NotifRow>.
  { id: 'notif', family: 'notif', group: 'components', prefix: 'notif', css: true, interactive: true },
  { id: 'stepper', family: 'stepper', group: 'components', prefix: 'stepper', maps: ['STEPPER_VARIANTS'] },
  { id: 'swatch', family: 'swatch', group: 'components', prefix: 'swatch', maps: ['SWATCH_VARIANTS'] },
  { id: 'badge', family: 'badge', group: 'components', css: true },
  // Карточка - МНОГООСНЫЙ объект (радиус × тон × interactive/add/recessed/…),
  // источник оси - карта суффиксов `.card--*`, экспортированная примитивом
  // (`CARD_VARIANTS`), не CSS-скан: страница рисует по ней, тест дрейфа сверяет
  // её ↔ живой CSS в обе стороны (TRIP-343). `interactive` - у форм есть ховер.
  { id: 'card', family: 'card', group: 'components', prefix: 'card', maps: ['CARD_VARIANTS'], interactive: true },
  { id: 'field', family: 'field', group: 'components', css: true },
  { id: 'input', family: 'input', group: 'components', css: true },
  // Поисковый пикер (Autocomplete): поле + выпадающий лист на канон-примитиве
  // Popover + список `.ss-*` (тот же лист-хром, что у SearchSelect). Осей-обличий
  // у семьи нет (структурные классы без `--`), поэтому источник — демо (css:false).
  { id: 'autocomplete', family: 'ss', group: 'components', css: false, interactive: true },
  { id: 'avatar', family: 'avatar', group: 'components', css: true },
  { id: 'sev', family: 'sev', group: 'components', css: true },
  { id: 'empty-state', family: 'empty', group: 'components', css: true },
  { id: 'checkbox', family: 'checkbox', group: 'components', css: false },
  { id: 'switch', family: 'switch', group: 'components', css: false },
  { id: 'doc-row', family: 'doc', group: 'components', css: true },
  { id: 'skeleton', family: 'skeleton', group: 'components', css: false },
  { id: 'dialog', family: 'dlg', group: 'components', css: true },
  // Аккордеон-раскрывашка (<Accordion>, семья .acc): шапка-кнопка + вложенное
  // тело, шеврон вправо→вниз. Источник — рецепт (css:false), т.к. у семьи нет
  // `--`-вариантов (только `__`-элементы и состояние .is-open).
  { id: 'accordion', family: 'acc', group: 'components', css: false, interactive: true },
  // Обложка трипа (<Cover>, семья .cover): фоллбек-картинка из бандла как подложка,
  // фото — <img> поверх (его onError гасит img → просвечивает фоллбек). Источник —
  // рецепт (css:false): вариантов `.cover--*` у семьи нет.
  { id: 'cover', family: 'cover', group: 'components', css: false },
  // Пикер обложки (<CoverPicker>, семья .tcp): кадр со scroll-snap-лентой
  // слайдов, стрелки, кнопка загрузки и лента миниатюр под ним. Источник —
  // рецепт (css:false): у семьи только `__`-элементы, `--`-вариантов нет.
  { id: 'coverpicker', family: 'tcp', group: 'components', css: false, interactive: true },
  { id: 'readonly-banner', family: 'readonly', group: 'components', css: false },
  // Плитка-иконка - двухосный объект (размер × тон) + булевы round/solid и тон
  // warm (только залитый). Источник оси - карты, экспортированные примитивом
  // <Tile> (TILE_SIZES/TILE_TONES), не CSS-скан: страница рисует по ним, тест
  // дрейфа сверяет их ↔ живой CSS в обе стороны (TRIP-391 объект 3).
  { id: 'tile', family: 'tile', group: 'components', prefix: 'tile', maps: ['TILE_SIZES', 'TILE_TONES'], extras: ['round', 'solid', 'warm', 'pro'] },
  { id: 'spin', family: 'spin', group: 'components', css: true },
  { id: 'toast', family: 'toast', group: 'components', css: true },
  { id: 'sheet-row', family: 'sheet', group: 'components', css: true },
  { id: 'ai-blk', family: 'ai', group: 'components', css: true },
  { id: 'time', family: 'time', group: 'components', css: true },
  // ── Примитивы раскладки ─────────────────────────────────────────────────
  { id: 'row', family: 'row', group: 'layout', css: true },
  { id: 'col', family: 'col', group: 'layout', css: true },
  { id: 'grid', family: 'grid', group: 'layout', css: true },
  // ── Секции-замер (читаются из живых стилей приборно) ─────────────────────
  { id: 'spacing', family: null, group: 'scale', special: 'spacing' },
  { id: 'typography', family: null, group: 'type', special: 'typography' },
  { id: 'tokens', family: null, group: 'tokens', special: 'tokens' },
];

/** Порядок и заголовки групп индекса. */
export const KIT_GROUPS = ['components', 'layout', 'scale', 'type', 'tokens'];

/** Объект по `id` роута `/kit/:object`. */
export const kitObjectById = (id) => KIT_OBJECTS.find((o) => o.id === id) ?? null;
