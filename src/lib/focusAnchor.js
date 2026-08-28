// @ts-check
/**
 * focusAnchor — упреждающий якорь фокусного поля на мобиле.
 *
 * ★★ ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ, А НЕ КУСОК `keyboardOpen.js`. Правило здесь —
 * ЧИСТОЕ (`anchorDelta`), и это единственный способ его загейтить: софт-
 * клавиатуру не эмулирует ни Playwright, ни headless Chromium, то есть у всего
 * этого поведения не может быть ни скриншота, ни e2e. А `keyboardOpen.js`
 * тянет `react` — тест на нём падал бы на `ERR_MODULE_NOT_FOUND`. Прецедент
 * ровно этот: `sheetDetents.js` вынесен из `PeekSheet` по той же причине.
 *
 * ★★ ЧТО ЭТО РЕШАЕТ. Замер на устройстве (iPhone, iOS 26, Safari; PR #1067):
 * раскладочный вьюпорт при клавиатуре НЕ меняется — Safari панорамирует ОКНО, и
 * вместе с ним едет вся картинка, `position: fixed` включительно. Отключить это
 * нельзя (`body { position: fixed }` проверен, не помогает). Но сдвиг —
 * ДЕТЕРМИНИРОВАННАЯ функция одного аргумента: Safari ЦЕНТРИРУЕТ фокусное поле в
 * видимой полосе, `сдвиг = центрПоля − центрПолосы`. Значит управлять можно
 * ровно одним — где стоит поле в момент фокуса.
 *
 * ★★★ ЭТО НЕ «ИНПУТЫ НАВЕРХ». Поле приводит в целевую точку СКРОЛЛ его
 * контейнера, а не перестановка разметки. Поэтому правило работает там, где
 * перестановка невозможна: на форме события (37 полей) наверх уезжает ровно то
 * поле, в которое ткнули, а остальные стоят где стояли.
 */

// Типы <input>, которые НЕ поднимают экранную клавиатуру (в отличие от
// text/email/search/url/number/tel/password/…). Константа модульная, чтобы не
// пересоздавать набор на каждый фокус и на каждый resize вьюпорта.
const NON_TEXT_INPUT_TYPES = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image']);

// ★ ЦЕЛЬ — ВЫШЕ ЦЕНТРА ПОЛОСЫ, А НЕ РАВНА ЕМУ, И ЭТО НЕСУЩЕЕ.
// Замер: раскладка 766, клавиатура 338, видимая полоса 428 → центр полосы 214,
// то есть 0.28 высоты окна. Ноль сдвига даёт положение ВЫШЕ этой точки: там
// желаемый сдвиг Safari отрицателен и упирается в верх документа. Целься мы в
// саму точку — промах возвращал бы панораму, а промахнуться легко: высота
// клавиатуры гуляет (RU-раскладка, предиктивная панель, accessory bar). 0.22
// держит запас под полосу заметно уже замеренной.
export const ANCHOR_RATIO = 0.22;

/**
 * На сколько прокрутить контейнер, чтобы центр поля встал в целевую точку окна.
 *
 * Возвращает 0, когда поле УЖЕ выше цели: тянуть его ВНИЗ нельзя — наверху
 * страница не едет вовсе, и любой сдвиг оттуда вернул бы ту самую панораму,
 * которую мы убираем.
 *
 * @param {{ fieldTop: number, fieldHeight: number, viewportH: number, ratio?: number }} p
 * @returns {number} px, на сколько увеличить scrollTop (всегда >= 0)
 */
export function anchorDelta({ fieldTop, fieldHeight, viewportH, ratio = ANCHOR_RATIO }) {
  if (!(viewportH > 0)) return 0;
  const fieldCenter = fieldTop + fieldHeight / 2;
  return Math.max(0, Math.round(fieldCenter - viewportH * ratio));
}

/** Текстовое ли это поле (то, что поднимает клавиатуру). @param {any} el */
export function isTextInput(el) {
  if (typeof HTMLElement === 'undefined' || !(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has((el.type || 'text').toLowerCase());
  return el.isContentEditable;
}

/**
 * Ближайший предок, который РЕАЛЬНО может прокрутиться. Не «у кого overflow
 * auto», а «у кого есть куда ехать»: контейнер с `auto` и без переполнения
 * прокруткой не является, и остановиться на нём значило бы не доехать никуда.
 * Ничего не нашли → поле в непрокручиваемой поверхности (композер чата прибит к
 * низу): двигать нечего, и это законный случай, а не ошибка.
 * @param {Element | null} el
 */
function scrollableAncestor(el) {
  for (let n = el?.parentElement; n; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && n.scrollHeight - n.clientHeight > 1) return n;
  }
  return null;
}

let started = false;

/**
 * ★★ ЯКОРЬ СТАВИТСЯ ПО `focusin`, А НЕ ПО ГЕОМЕТРИИ, И ЭТО НЕСУЩЕЕ.
 * Геометрический сигнал (`keyboardOpen.js`) приходит на 120px усадки, то есть В
 * СЕРЕДИНЕ подъёма клавиатуры (~150мс из 250): якорь, поставленный тогда, едет
 * ВТОРЫМ движением поверх уже начавшейся панорамы Safari — ровно то, из-за чего
 * замер варианта D в PR #1067 дал 121 вместо нуля. `focusin` приходит ДО того,
 * как клавиатура тронулась: к моменту, когда Safari считает свой сдвиг, поле уже
 * стоит выше центра полосы, и считать ему становится нечего.
 *
 * Прокрутка МГНОВЕННАЯ (`scrollTop +=`), не `smooth`: плавная дралась бы с
 * панорамой браузера за одни и те же 250мс — это снова два движения.
 *
 * @param {VisualViewport} vv
 */
export function startFocusAnchor(vv) {
  if (started || typeof document === 'undefined') return;
  started = true;
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (!isTextInput(el)) return;
    const box = /** @type {HTMLElement} */ (el).getBoundingClientRect();
    const delta = anchorDelta({ fieldTop: box.top, fieldHeight: box.height, viewportH: vv.height });
    if (delta <= 0) return;
    const sc = scrollableAncestor(/** @type {HTMLElement} */ (el));
    if (sc) sc.scrollTop += delta;
  }, true);
}
