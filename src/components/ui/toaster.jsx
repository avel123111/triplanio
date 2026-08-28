import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { useToast } from "@/components/ui/use-toast";
import {
  Toast,
  ToastBody,
  ToastClose,
  ToastProvider,
  ToastViewport,
} from "@/components/ui/toast";
// ★ ОДИН СПИСОК «ЧЕЙ ТАП» НА ВСЁ ПРИЛОЖЕНИЕ. Имя у константы шитовое, потому что
// шит был первым, кому правило понадобилось; сама она про объект «управление»,
// а не про шит. Заводить второй такой список рядом значило бы развести их через
// два PR. Появится третий вызыватель — константа переедет в свой модуль, сейчас
// это было бы шагом ради шага.
import { SHEET_CONTROL_SELECTOR, tapSettles } from "@/lib/sheetDetents";
import {
  swipeAxis, swipeOffset, swipeCommit, swipeExit, SWIPE_EXIT_MS,
} from "@/lib/swipeDismiss";

// Per-variant auto-dismiss timing. Errors/warnings linger longer so the user
// can read the unexpected message; success/info clear quickly. A toast may
// override this with an explicit `duration` (ms) in its options.
const DURATION = { error: 8000, destructive: 8000, warning: 8000 };
const DEFAULT_DURATION = 5000;
function durationFor(tt) {
  return typeof tt.duration === "number"
    ? tt.duration
    : DURATION[tt.variant] ?? DEFAULT_DURATION;
}

// Gap (px) between cards once the deck is fanned into a column.
const GAP = 12;
// Cards kept visible in the collapsed deck; deeper ones fade out behind.
const MAX_DECK = 3;

// The toasts are dealt as a DECK, not a row: newest in front, older ones
// peeking behind it, scaled down. Hover / keyboard-focus fans the deck into a
// readable column. All motion is CSS (transitions on transform/opacity keyed by
// `--i` = depth and `--y` = summed heights of the cards in front). This
// component only owns the bookkeeping the cascade cannot see: which card is
// entering/leaving, each card's depth, and the measured stack offset.
export function Toaster() {
  const { toasts, dismiss } = useToast();

  // Auto-dismiss: schedule a one-shot timer per open toast, once. Manual close
  // (or the toast leaving the store) clears its timer. Idempotent across the
  // frequent re-renders of the toast store.
  const timers = useRef(new Map());
  useEffect(() => {
    const liveIds = new Set();
    toasts.forEach((tt) => {
      if (tt.open === false) return;
      liveIds.add(tt.id);
      if (timers.current.has(tt.id)) return;
      const handle = setTimeout(() => {
        timers.current.delete(tt.id);
        dismiss(tt.id);
      }, durationFor(tt));
      timers.current.set(tt.id, handle);
    });
    // Drop timers for toasts that are gone or already closed.
    timers.current.forEach((handle, id) => {
      if (!liveIds.has(id)) {
        clearTimeout(handle);
        timers.current.delete(id);
      }
    });
  }, [toasts, dismiss]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current.clear(); }, []);

  // Entry animation: a freshly-added toast renders one frame in its `enter`
  // (off-edge, faded) pose, then flips to `visible` so the CSS transition plays.
  // `seen` tracks which ids have been through that first frame.
  const seen = useRef(new Set());
  const [entered, setEntered] = useState(() => new Set());
  useEffect(() => {
    const live = new Set(toasts.map((t) => t.id));
    seen.current.forEach((id) => { if (!live.has(id)) seen.current.delete(id); });

    const fresh = toasts.filter((t) => !seen.current.has(t.id));
    fresh.forEach((t) => seen.current.add(t.id));

    setEntered((prev) => {
      const next = new Set([...prev].filter((id) => live.has(id)));
      const changed = next.size !== prev.size;
      if (!fresh.length) return changed ? next : prev;
      // Flip the fresh toasts to `visible` on the next frame (after the browser
      // has painted their `enter` pose) so the transition has a from-state.
      requestAnimationFrame(() => setEntered((cur) => {
        const n = new Set(cur);
        fresh.forEach((t) => n.add(t.id));
        return n;
      }));
      return next;
    });
  }, [toasts]);

  // Stack geometry: measure the OPEN cards front-to-back and write each card's
  // depth (`--i`) + the offset it must travel to sit in the fanned column
  // (`--y` = summed heights of every card in front of it). Runs every render
  // (heights depend on content) and on resize (width change re-wraps text).
  const nodes = useRef(new Map());
  const [, bump] = useReducer((x) => x + 1, 0);
  useLayoutEffect(() => {
    const open = toasts.filter((t) => t.open !== false);
    let cum = 0;
    open.forEach((t, i) => {
      const el = nodes.current.get(t.id);
      if (!el) return;
      el.style.setProperty("--i", String(i));
      el.style.setProperty("--y", `${cum}px`);
      cum += el.offsetHeight + GAP;
    });
  });
  useEffect(() => {
    window.addEventListener("resize", bump);
    return () => window.removeEventListener("resize", bump);
  }, []);

  // Touch has no hover, so a tap on the deck toggles the fanned column (desktop
  // keeps fanning on :hover via CSS). Reset when the deck empties so it does not
  // reopen collapsed-then-expanded on the next toast.
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { if (!toasts.length) setExpanded(false); }, [toasts.length]);

  /* ★★ ОДИН КОНВЕЙЕР УКАЗАТЕЛЯ НА ОБА ЖЕСТА, А НЕ ДВА СОСЕДНИХ ОБРАБОТЧИКА.
   * На касании у деки теперь ДВА намерения — тап (раскрыть колонку) и свайп
   * (закрыть карточку), — и живут они на одной поверхности. Развести их можно
   * только там, где известен ИСХОД жеста, то есть на отпускании: пока палец не
   * поехал, тап и свайп неотличимы по построению. Поэтому раскрытие переехало
   * с `pointerdown` на `pointerup` — иначе первый же свайп сначала раскрывал бы
   * деку, а потом закрывал карточку.
   *
   * ★ Ровно это правило репозиторий уже вывел для шита (`tapSettles`,
   * `sheetDetents.js`): тянуть поверхность можно откуда угодно, ВКЛЮЧАЯ кнопку
   * (палец поехал — намерение однозначно), а ТАП по кнопке принадлежит кнопке.
   * Здесь берётся та же функция, а не переписывается условие: разойдись они —
   * и крестик тоста повёл бы себя не так, как крестик шита.
   *
   * Мышь не трогаем вовсе: на десктопе дека раскрывается ховером из CSS. */
  const swipe = useRef(/** @type {any} */(null));
  const exitTimers = useRef(new Map());
  useEffect(() => () => { exitTimers.current.forEach(clearTimeout); exitTimers.current.clear(); }, []);

  const onPointerDown = (e) => {
    if (e.pointerType === "mouse") return;
    const card = e.target.closest?.(".toast");
    if (!card) return;
    swipe.current = {
      card,
      id: card.dataset.toastId,
      x0: e.clientX, y0: e.clientY,
      lastX: e.clientX, lastY: e.clientY, lastT: e.timeStamp,
      vx: 0, vy: 0,
      axis: null,
      onControl: !!e.target.closest?.(SHEET_CONTROL_SELECTOR),
      pointerId: e.pointerId,
    };
    // ★ ЗАХВАТ УКАЗАТЕЛЯ СТАВИТСЯ НЕ ЗДЕСЬ, А В `pointermove`, КОГДА ОСЬ УЖЕ
    // ВЫБРАНА. Захват перенаправляет `pointerup` на карточку, а `click` браузер
    // шлёт общему предку точек нажатия и отпускания — то есть тоже карточке, а
    // не крестику. В Chromium это обошлось (проверено A/B-прогоном на стенде:
    // обе редакции закрывают тост крестиком), но захватывать жест, которого ещё
    // нет, неверно само по себе: до порога намерения касание принадлежит тому,
    // на ком оно началось, и отнимать его у кнопки не за что.
  };

  const onPointerMove = (e) => {
    const s = swipe.current;
    if (!s) return;
    const dx = e.clientX - s.x0;
    const dy = e.clientY - s.y0;
    const dt = e.timeStamp - s.lastT;
    if (dt > 0) {
      s.vx = (e.clientX - s.lastX) / dt;
      s.vy = (e.clientY - s.lastY) / dt;
    }
    s.lastX = e.clientX; s.lastY = e.clientY; s.lastT = e.timeStamp;
    if (!s.axis) {
      s.axis = swipeAxis(dx, dy);
      if (!s.axis) return;               // намерения ещё нет — это может быть тап
      s.card.dataset.swipe = "";         // снимает transition: палец ведёт 1:1
      // Теперь жест точно наш: карточка уезжает из-под пальца, и без захвата
      // `pointermove` перестал бы приходить на середине хода.
      try { s.card.setPointerCapture?.(s.pointerId); } catch { /* указателя уже нет */ }
    }
    const { x, y } = swipeOffset(s.axis, dx, dy);
    s.x = x; s.y = y;                    // путь карточки — им же решается закрытие
    s.card.style.setProperty("--sw-x", `${x}px`);
    s.card.style.setProperty("--sw-y", `${y}px`);
  };

  const settle = (s) => {
    delete s.card.dataset.swipe;
    s.card.style.removeProperty("--sw-x");
    s.card.style.removeProperty("--sw-y");
  };

  const onPointerUp = (e) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s) return;

    // Оси нет — палец не поехал, значит это был ТАП.
    if (!s.axis) {
      if (tapSettles({ onHandle: true, onControl: s.onControl })) setExpanded((v) => !v);
      return;
    }

    const dir = swipeCommit({ axis: s.axis, x: s.x || 0, y: s.y || 0, vx: s.vx, vy: s.vy });
    if (!dir) { settle(s); return; }

    // Улетает по тому же каналу, что и вело палец, — вторая формула не заводится.
    // Время публикует компонент (`--sw-exit`), кривую берёт токен: тот же приём,
    // каким шит публикует свой темп (`--surface-settle`, lib/surfaceMotion).
    // Путь и прямоугольник снимаются В ОДИН МОМЕНТ и уходят в `swipeExit`
    // вместе: канал `--sw-*` абсолютен от покоя, а прямоугольник — там, где
    // карточка сейчас. Разъедься эти два — и карточка «застревает» или прыгает
    // назад (разбор у самой функции).
    const r = s.card.getBoundingClientRect();
    const exit = swipeExit(dir, { x: s.x || 0, y: s.y || 0 }, r, { width: window.innerWidth });
    // Состояния меняются местами, а не накладываются: иначе какое из двух правил
    // `transition` победит, решал бы порядок строк в CSS, а не намерение.
    delete s.card.dataset.swipe;
    s.card.dataset.swipeOut = "";
    s.card.style.setProperty("--sw-exit", `${SWIPE_EXIT_MS}ms`);
    s.card.style.setProperty("--sw-x", `${exit.x}px`);
    s.card.style.setProperty("--sw-y", `${exit.y}px`);
    // Из стора карточка уходит ПОСЛЕ полёта: снять её сразу — значит включить
    // штатную выходную анимацию (`data-state="leave"`) поверх летящей карточки.
    if (s.id) {
      const h = setTimeout(() => { exitTimers.current.delete(s.id); dismiss(s.id); }, SWIPE_EXIT_MS);
      exitTimers.current.set(s.id, h);
    }
  };

  const onPointerCancel = () => {
    const s = swipe.current;
    swipe.current = null;
    if (s && s.axis) settle(s);
  };

  const openIndex = new Map(
    toasts.filter((t) => t.open !== false).map((t, i) => [t.id, i]),
  );

  return (
    <ToastProvider
      data-expanded={expanded ? "" : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {toasts.map(function ({ id, title, description, action, open, onOpenChange: _onOpenChange, ...props }) {
        const leaving = open === false;
        const state = leaving ? "leave" : (entered.has(id) ? "visible" : "enter");
        const deep = !leaving && openIndex.get(id) >= MAX_DECK;
        return (
          <Toast
            key={id}
            ref={(el) => { if (el) nodes.current.set(id, el); else nodes.current.delete(id); }}
            data-toast-id={id}
            data-state={state}
            data-deep={deep ? "" : undefined}
            {...props}
          >
            <ToastBody title={title} description={description} />
            {action}
            <ToastClose onClick={() => dismiss(id)} />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
