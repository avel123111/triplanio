// @ts-check
// Single source of truth for "the on-screen keyboard is up" (mobile). Exposes
// the state two ways so each consumer uses the RIGHT one:
//   • `data-keyboard` attribute on <html> — for CSS that hides NON-canon chrome
//     by state (the floating nav `.mbnav`, the editor-panel footer `.lp-f`). A
//     document-state DATA ATTRIBUTE, not a class, on purpose: a new state class
//     would grow the design-floor class count (guard 2o), and root state is a
//     data attribute in every design system (`data-theme`, …) anyway.
//   • `useKeyboardOpen()` hook — for a CANON design-system primitive that must
//     own its own DOM instead of being restyled from outside (the sheet footer
//     `.dlg__foot`, owned by <Dialog>). Reaching into a canon primitive from an
//     outer selector is the coupling the design floor (guard 2o `reach`) forbids,
//     so the primitive hides ITSELF via this hook.
//   • `--vv-h` / `--vv-top` на <html> — ВИДИМАЯ ОБЛАСТЬ в координатах раскладки,
//     для поверхности, которая обязана лечь ровно в неё (полноростная шторка
//     пикера). Разбор — ниже, это не «ещё одна удобная переменная».
//
// The signal is VIEWPORT GEOMETRY, not input focus. The app's viewport meta uses
// `interactive-widget=resizes-content`, so the keyboard SHRINKS the visual
// viewport; we flag it open when the height drops well below the tallest height
// seen in the current orientation. Focus was the first attempt and it was racy:
// on mobile, tapping the bottom nav can restore focus to the last field, which
// re-hid the nav the instant it was pressed. Geometry does not move when you tap
// a button.
//
// ★★ ПОЧЕМУ ГЕОМЕТРИЯ ПУБЛИКУЕТСЯ, А НЕ ВЫЧИСЛЯЕТСЯ CSS-ЕДИНИЦАМИ (TRIP-484 §4).
// `interactive-widget=resizes-content` в мета-вьюпорте ЧЕСТЕН ТОЛЬКО ДЛЯ CHROME.
// iOS Safari эту директиву не поддерживает вовсе: клавиатура там сжимает ТОЛЬКО
// визуальный вьюпорт, а вьюпорт РАСКЛАДКИ остаётся во весь экран. А `position:
// fixed`, `100dvh` и `top/bottom` считаются именно от вьюпорта РАСКЛАДКИ.
// Отсюда прод-баг, стоивший двух заходов: полноростная шторка на Android честно
// ужималась под клавиатуру, а на iOS оставалась 844 px высотой, клавиатура
// накрывала её низ, и Safari, чтобы показать поле в фокусе, ПАНОРАМИРОВАЛ
// визуальный вьюпорт — то есть уводил всю приклеенную шторку вверх за край
// экрана. Ни момент фокуса, ни `preventScroll` этого не лечат: браузер двигает
// не элемент, а то, через что на элемент смотрят.
// Единственная величина, знающая правду на ОБЕИХ платформах, — сам
// `visualViewport`. Поверхность, которой отдали его высоту и смещение, ложится
// ровно в видимую область, и панорамировать браузеру становится нечего.
// Живёт это ЗДЕСЬ, а не во втором наблюдателе: `visualViewport` в приложении уже
// слушает ровно один модуль, и второй разъехался бы с первым на первой правке
// (порог, поворот, гейт по типу указателя — всё это уже разобрано ниже).
//
// ponytail: a minimal DOM-level watcher (no lib) — the one honest signal for a
// keyboard that resizes content is the resize itself. Upgrade path: the
// VirtualKeyboard API (`navigator.virtualKeyboard`) once broadly supported.
import { useSyncExternalStore } from 'react';

// A drop bigger than this (px) counts as "keyboard is up". Keeps the URL-bar
// show/hide (~60–100px) from flipping it; a soft keyboard is ~260–320px.
const OPEN_DELTA = 120;

// Типы <input>, которые НЕ поднимают экранную клавиатуру (в отличие от
// text/email/search/url/number/tel/password/…). Вынесено в модуль, чтобы не
// пересоздавать массив на каждый resize вьюпорта.
const NON_TEXT_INPUT_TYPES = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image']);

let open = false;
const subscribers = new Set();

// Клавиатуру физически можно поднять ТОЛЬКО над текстовым вводом (input
// текстовых типов / textarea / contenteditable). select, чекбоксы, кнопки,
// color/file/range её не поднимают. Это добавочный гейт к геометрии: без него
// первый (слишком высокий) замер vv.height на мобильном старте фиксировал
// baseline завышенным, усадка URL-бара читалась как «клавиатура» и прятала
// боттом-нав до перезагрузки. Фокус здесь НЕ замена геометрии (та racy сама по
// себе — тап по наву возвращал фокус в поле), а ДОПОЛНИТЕЛЬНОЕ условие: при тапе
// по кнопке геометрия не двигается, поэтому старый race не воскресает.
function isTextInputFocused() {
  if (typeof document === 'undefined') return false;
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    return !NON_TEXT_INPUT_TYPES.has((el.type || 'text').toLowerCase());
  }
  return el.isContentEditable;
}

/** @param {() => void} cb */
function subscribe(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}
const getSnapshot = () => open;
const notify = () => subscribers.forEach((cb) => cb());

/** React hook: true while the soft keyboard is up. For a canon primitive that
 *  must hide its own chrome (e.g. <Dialog>'s footer) rather than be reached
 *  into from CSS. */
export function useKeyboardOpen() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

let started = false;

export function startKeyboardOpenWatch() {
  if (started || typeof window === 'undefined') return;
  const vv = window.visualViewport;
  // No VisualViewport → skip: chrome just stays put (the old, pre-feature look).
  if (!vv) return;
  // A soft keyboard only exists on touch devices (coarse primary pointer). On a
  // desktop the visual viewport ALSO shrinks — by a window resize, a browser
  // zoom, or the download shelf — and that read as "keyboard up", intermittently
  // unmounting the canon `.dlg__foot` (the share dialog lost its Download/Share
  // footer, "Настроить карту" lost its Done). Gate the whole watcher to
  // coarse-pointer devices: on desktop it never starts, so `data-keyboard` is
  // never set and useKeyboardOpen() stays false — the footer no longer vanishes.
  // (The `.mbnav`/`.lp-f` CSS consumers are already `@media (max-width:640px)`,
  // so they're unaffected on desktop either way; this only fixes the JS hook.)
  if (!window.matchMedia?.('(pointer: coarse)').matches) return;
  started = true;

  const root = document.documentElement;
  let baseline = vv.height; // tallest height this orientation = no keyboard

  // Видимая область в координатах раскладки. Пишем ЦЕЛЫЕ пиксели и только на
  // изменение: `scroll` визуального вьюпорта на iOS сыплется пачками, а каждая
  // запись переменной — это пересчёт стилей.
  let lastH = -1;
  let lastTop = -1;
  const publish = () => {
    const h = Math.round(vv.height);
    const top = Math.round(vv.offsetTop);
    if (h !== lastH) { lastH = h; root.style.setProperty('--vv-h', `${h}px`); }
    if (top !== lastTop) { lastTop = top; root.style.setProperty('--vv-top', `${top}px`); }
  };

  const update = () => {
    publish();
    const h = vv.height;
    if (h > baseline) baseline = h;          // grow baseline (URL bar hides, rotate)
    // Геометрия — НЕОБХОДИМОЕ, но не достаточное условие; фокус в текстовом поле —
    // второе. На старте не сфокусировано ничего → false, поэтому завышенный
    // baseline больше не даёт ложного «клавиатура открыта» и не прячет нав.
    const next = baseline - h > OPEN_DELTA && isTextInputFocused();
    if (next !== open) { open = next; notify(); }
    root.toggleAttribute('data-keyboard', next);
  };

  vv.addEventListener('resize', update);
  // Смещение меняется БЕЗ resize — именно так выглядит панорамирование Safari к
  // полю в фокусе. Без этой подписки шторка узнала бы о сдвиге только вместе со
  // следующим изменением высоты, то есть уже после того, как уехала.
  vv.addEventListener('scroll', publish);
  // Orientation flips the height; drop the flag and re-seat the baseline once
  // the new size settles so a rotate doesn't read as a keyboard.
  window.addEventListener('orientationchange', () => {
    root.removeAttribute('data-keyboard');
    if (open) { open = false; notify(); }
    setTimeout(() => { baseline = vv.height; update(); }, 300);
  });
  update();
}
