// @ts-check
// ВРЕМЕННЫЙ ЗАМЕР КЛАВИАТУРЫ — включается ТОЛЬКО флагом `?kbdebug=1` в адресе.
// Не гадать, а посмотреть: на iOS-движке (Safari И Chrome — под капотом WebKit)
// у нас нет ни консоли, ни отладчика, а симптом «страница за шторкой едет»
// одинаково объясняется четырьмя разными механизмами. Этот блок печатает ЖИВЫЕ
// числа, по которым они различаются одним взглядом:
//
//   inner   — window.innerHeight: вьюпорт РАСКЛАДКИ. Меняется -> раскладку ужимает
//             сама платформа (директива `interactive-widget`).
//   visual  — visualViewport.height: ВИДИМАЯ полоса. Всегда меньше при клавиатуре.
//   offTop  — visualViewport.offsetTop: браузер ПАНОРАМИРУЕТ вид. Не ноль ->
//             двигается не элемент, а то, через что на него смотрят.
//   pageTop — visualViewport.pageTop: где видимая полоса стоит в документе.
//   scroll  — прокрутка документа. У фикс-шелла обязана быть 0.
//   bodyPos — что vaul сделал с <body> (он ставит `position: fixed; top: -scrollY`).
//   page    — реальный верх/низ оболочки экрана: ЕДЕТ ЛИ СТРАНИЦА.
//   sheet   — реальный верх/низ шторки: едет ли она и совпадает ли с видимой полосой.
//
// Читается так: если при поднятии клавиатуры `page` меняется, а `inner` нет —
// страницу двигает панорамирование (offTop), а не раскладка.
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
    'position:fixed', 'left:4px', 'top:4px', 'z-index:2147483647',
    'background:rgba(0,0,0,.82)', 'color:#0f0', 'font:11px/1.35 ui-monospace,monospace',
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

  let peakOffTop = 0;
  const render = () => {
    const vv = window.visualViewport;
    if (vv && vv.offsetTop > peakOffTop) peakOffTop = Math.round(vv.offsetTop);
    const bs = document.body.style;
    box.textContent = [
      `inner   ${window.innerHeight}`,
      `visual  ${vv ? Math.round(vv.height) : '—'}`,
      `offTop  ${vv ? Math.round(vv.offsetTop) : '—'}   пик ${peakOffTop}`,
      `pageTop ${vv ? Math.round(vv.pageTop) : '—'}`,
      `scroll  ${Math.round(window.scrollY)}`,
      `bodyPos ${bs.position || '—'} ${bs.top || ''}`,
      `kbd     ${document.documentElement.hasAttribute('data-keyboard')}`,
      `--vv-h  ${document.documentElement.style.getPropertyValue('--vv-h') || '—'}`,
      `page    ${rect('.flow-page, .app-shell, #root > *')}`,
      `sheet   ${rect('.sheet, .lp-sheet')}`,
    ].join('\n');
  };

  render();
  const loop = () => { render(); window.requestAnimationFrame(loop); };
  window.requestAnimationFrame(loop);
}
