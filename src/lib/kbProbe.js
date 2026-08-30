// @ts-check
// ВРЕМЕННЫЙ ЗАМЕР КЛАВИАТУРЫ — включается ТОЛЬКО флагом `?kbdebug=1` в адресе.
// Не гадать, а посмотреть: на iOS-движке (Safari И Chrome — под капотом WebKit)
// у нас нет ни консоли, ни отладчика, а симптом «страница за шторкой едет»
// одинаково объясняется четырьмя разными механизмами. Этот блок печатает ЖИВЫЕ
// числа, по которым они различаются одним взглядом:
//
//   inner   — window.innerHeight: вьюпорт РАСКЛАДКИ.
//   visual  — visualViewport.height: ВИДИМАЯ полоса.
//   offTop  — visualViewport.offsetTop: браузер ПАНОРАМИРУЕТ вид.
//   bodyPos — что vaul сделал с <body>.
//   page    — реальный верх/низ оболочки экрана: ЕДЕТ ЛИ СТРАНИЦА.
//   sheet   — реальный верх/низ шторки.
//
// ★★ МГНОВЕННОГО СНИМКА МАЛО, И ЭТО ВЫЯСНИЛОСЬ ЗАМЕРОМ. Первый заход показал
// картину «всё на месте» ровно потому, что снят был ОДИН момент, а движение
// живёт в ПЕРЕХОДЕ: клавиатура встаёт, страница едет, клавиатура уходит, страница
// возвращается — и в любой отдельной точке всё выглядит правильным.
// Поэтому блок теперь помнит РАЗМАХ каждой величины (мин..макс за сеанс) и
// ИСТОРИЮ изменений. Одного скриншота ПОСЛЕ всего сценария хватает, чтобы
// назвать причину:
//   размах `inner` не нулевой -> вьюпорт РАСКЛАДКИ меняется. Клавиатура тут ни
//     при чём (её платформа в раскладку не пускает) — значит это хром браузера:
//     Chrome на iOS при фокусе убирает свою нижнюю панель и ставит автозаполнение.
//     Всё, что задано в `dvh` (у нас `.flow-page { height: 100dvh }`), едет за ним.
//   размах `inner` нулевой, а `page` всё равно ездит -> двигает наш код.
//   размах `offTop` не нулевой -> панорамирование.
//
// ★ УДАЛИТЬ ВМЕСТЕ С ДИАГНОСТИКОЙ. Файл существует ради одного скриншота с
// устройства; в дереве он живёт до тех пор, пока причина не названа.

const FLAG = 'kbdebug';

export function startKbProbe() {
  if (typeof window === 'undefined') return;
  try {
    if (new URLSearchParams(window.location.search).get(FLAG) !== '1') return;
  } catch { return; }

  const box = document.createElement('div');
  // Инлайн-стили намеренно: блок обязан работать, даже если стили приложения не
  // приехали, и не должен попадать ни в один гард дизайн-системы.
  box.setAttribute('style', [
    'position:fixed', 'left:4px', 'top:4px',
    // Верх лестницы слоёв, а не «побольше»: сырое число мимо `--z-*` ловит гард 2o.
    'z-index:calc(var(--z-popover) + 10)',
    // Цвета НАМЕРЕННО мимо токенов: блок обязан читаться поверх чего угодно —
    // поверх шторки, скрима и любой темы, — то есть не должен следовать теме.
    'background:rgba(0,0,0,.82)', // design-token-exempt: временный отладочный блок, вне темы по построению
    'color:#0f0', // design-token-exempt: то же
    'font:11px/1.35 ui-monospace,monospace',
    'padding:6px 8px', 'border-radius:6px', 'white-space:pre', 'pointer-events:none',
    'max-width:min(96vw,340px)',
  ].join(';'));
  document.body.appendChild(box);

  const rect = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return '—';
    const r = el.getBoundingClientRect();
    return `${Math.round(r.top)}..${Math.round(r.bottom)}`;
  };

  /** Размах величины за сеанс: «сколько она вообще гуляла». Ноль размаха —
   *  доказательство НЕПРИЧАСТНОСТИ, и это ровно то, чего не даёт снимок. */
  const span = {};
  const track = (k, v) => {
    if (typeof v !== 'number' || Number.isNaN(v)) return v;
    const s = span[k] || (span[k] = { min: v, max: v });
    if (v < s.min) s.min = v;
    if (v > s.max) s.max = v;
    return v;
  };
  const show = (k, v) => {
    const s = span[k];
    return s && s.max !== s.min ? `${v}  (${s.min}..${s.max} ЕДЕТ)` : `${v}`;
  };

  // История: печатаем ТОЛЬКО изменения, иначе кадры затрут друг друга.
  const t0 = Date.now();
  /** @type {string[]} */
  const log = [];
  let prev = '';
  const note = (line) => {
    if (line === prev) return;
    prev = line;
    log.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${line}`);
    if (log.length > 7) log.shift();
  };

  const render = () => {
    const vv = window.visualViewport;
    const inner = track('inner', window.innerHeight);
    const visual = track('visual', vv ? Math.round(vv.height) : NaN);
    const offTop = track('offTop', vv ? Math.round(vv.offsetTop) : NaN);
    // ⚠️ МЕРИТЬ НАДО ТО, ЧТО ДВИГАЕТСЯ. Первая редакция брала оболочку экрана —
    // и честно печатала «размаха нет», потому что оболочка и правда стоит. Ездил
    // `.peek-sheet` (трёхдетентный шит над картой), которого в замере не было.
    const peekEl = document.querySelector('.peek-sheet');
    const pageEl = document.querySelector('.flow-page, .app-shell, #root > *');
    const pr = pageEl && pageEl.getBoundingClientRect();
    if (pr) { track('pageTop', Math.round(pr.top)); track('pageBot', Math.round(pr.bottom)); }
    const kr = peekEl && peekEl.getBoundingClientRect();
    if (kr) { track('peekTop', Math.round(kr.top)); track('peekH', Math.round(kr.height)); }
    const bs = document.body.style;

    note(`vis ${visual} peek ${kr ? Math.round(kr.top) + '/' + Math.round(kr.height) : '—'} page ${pr ? Math.round(pr.top) + '..' + Math.round(pr.bottom) : '—'}`);

    box.textContent = [
      `inner   ${show('inner', inner)}`,
      `visual  ${show('visual', visual)}`,
      `offTop  ${show('offTop', offTop)}`,
      `scroll  ${Math.round(window.scrollY)}`,
      `bodyPos ${bs.position || '—'} ${bs.top || ''}`,
      `kbd     ${document.documentElement.hasAttribute('data-keyboard')}`,
      `page    ${show('pageTop', pr ? Math.round(pr.top) : '—')} .. ${show('pageBot', pr ? Math.round(pr.bottom) : '—')}`,
      `sheet   ${rect('.sheet, .lp-sheet')}`,
      `peek    верх ${show('peekTop', kr ? Math.round(kr.top) : '—')}  выс ${show('peekH', kr ? Math.round(kr.height) : '—')}`,
      '— история —',
      ...log,
    ].join('\n');
  };

  render();
  const loop = () => { render(); window.requestAnimationFrame(loop); };
  window.requestAnimationFrame(loop);
}
