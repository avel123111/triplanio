import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Input } from '@/design/Input';
import { useI18n } from '@/lib/i18n/I18nContext';
import GeoAttribution from '@/components/common/GeoAttribution';

/**
 * Autocomplete — the single, canonical async search-as-you-type field + dropdown
 * for the whole app. City pickers (CitySearch, ManualPlanner) and the address
 * picker (AddressAutocomplete) are thin facades over this one engine, so they
 * all share ONE dropdown shell, ONE hover, ONE scroll behaviour.
 *
 * Design decisions (why this shape):
 *  • Dropdown chrome reuses the canonical action-menu (`.menu` / `.mi`) — which
 *    already carries the primary/accent hover (`var(--accent)/--accent-ink`).
 *  • The list is a PLAIN overflow:auto div portaled into the nearest scroll
 *    parent and positioned ABSOLUTELY within its scrolled content. That gives,
 *    at once: (a) native touch/iOS scroll (no Radix popover quirks), (b) never
 *    clipped by a card/dialog `overflow:hidden`, (c) moves pixel-for-pixel WITH
 *    the input on scroll — no position:fixed, no per-frame recompute, no lag.
 *  • overscroll-behavior:contain + -webkit-overflow-scrolling:touch keep the
 *    gesture inside the list on phones (same hardening as .vp-b / .ss-list).
 *
 * The engine is data-agnostic: callers pass `search`, `getKey`, `renderRow`,
 * `onPick`, so the city/address contracts live in the facades, not here.
 */

// First scrollable ancestor — the dropdown portals here so it tracks the input
// on scroll and is never clipped by an ancestor's overflow:hidden.
function getScrollParent(el) {
  let n = el?.parentElement;
  while (n && n !== document.body) {
    const oy = getComputedStyle(n).overflowY;
    if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return n;
    n = n.parentElement;
  }
  return document.scrollingElement || document.body;
}

export default function Autocomplete({
  inputValue = '',
  onInputChange,
  search,
  getKey,
  renderRow,
  onPick,
  placeholder,
  autoFocus,
  disabled,
  icon = 'pin',
  minChars = 2,
  debounceMs = 300,
  attribution = true,
  inputProps = {},
}) {
  const { lang } = useI18n();
  const uid = React.useId();
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [box, setBox] = useState(null);
  const [flipTop, setFlipTop] = useState(null);
  const timerRef = useRef(null);
  const lastQueryRef = useRef('');
  const wrapRef = useRef(null);
  const listRef = useRef(null);
  // Read inside the debounce timer so a mid-debounce language switch isn't stale.
  const langRef = useRef(lang);
  useEffect(() => { langRef.current = lang; }, [lang]);

  // Position the portaled list once on open / results change, and re-derive only
  // when the viewport itself changes (resize / mobile keyboard show-hide).
  useLayoutEffect(() => {
    if (!open || results.length === 0) { setBox(null); return undefined; }
    let mutatedSp = null; // scroll parent we relativized — restore on cleanup
    const compute = () => {
      const el = wrapRef.current;
      if (!el) return;
      const sp = getScrollParent(el);
      const r = el.getBoundingClientRect();
      const gap = 4;
      const width = Math.round(r.width);
      const isEl = sp !== document.body && sp !== document.scrollingElement;
      // Drop any stale flip correction before we reposition (avoids a one-frame
      // jump when results change while the list is open).
      setFlipTop(null);
      if (isEl) {
        // Absolute-in-scroller: the list lives in the scrolled content and tracks
        // the input with zero lag. Requires the scroller to be a positioning
        // context — relativize it if it is still static (e.g. a dialog body),
        // and restore it on cleanup so we leave no permanent inline style.
        if (getComputedStyle(sp).position === 'static') {
          sp.style.position = 'relative';
          mutatedSp = sp;
        }
        const spRect = sp.getBoundingClientRect();
        // Room is measured inside the SCROLLER's own viewport, not the window: the
        // list is clipped by `sp`'s overflow, so a dialog footer (a sibling below
        // the scroll body) is the real bottom bound. When the input sits low and
        // there's no room below, FLIP the list above the input instead of letting
        // it disappear under the footer (the bug this fixes — TRIP-337).
        const spaceBelow = spRect.bottom - r.bottom - gap;
        const spaceAbove = r.top - spRect.top - gap;
        const flipUp = spaceBelow < 168 && spaceAbove > spaceBelow;
        const maxH = Math.round(Math.max(120, Math.min(300, flipUp ? spaceAbove : spaceBelow)));
        const left = Math.round(r.left - spRect.left + sp.scrollLeft);
        const belowTop = Math.round(r.bottom - spRect.top + sp.scrollTop + gap);
        // For a flip, the list BOTTOM must sit at the input top; the exact `top`
        // needs the rendered height and is corrected in the measure effect below.
        const anchorBottom = Math.round(r.top - spRect.top + sp.scrollTop - gap);
        setBox({ target: sp, left, width, maxH, flipUp, anchorBottom, top: flipUp ? anchorBottom - maxH : belowTop });
      } else {
        // Page-level scroll: portal to <body>, position in document space, and use
        // the window viewport as the clip bound (same flip rule).
        const vh = window.visualViewport?.height || window.innerHeight;
        const spaceBelow = vh - r.bottom - 12;
        const spaceAbove = r.top - 12;
        const flipUp = spaceBelow < 168 && spaceAbove > spaceBelow;
        const maxH = Math.round(Math.max(120, Math.min(300, flipUp ? spaceAbove : spaceBelow)));
        const left = Math.round(r.left + window.scrollX);
        const belowTop = Math.round(r.bottom + window.scrollY + gap);
        const anchorBottom = Math.round(r.top + window.scrollY - gap);
        setBox({ target: document.body, left, width, maxH, flipUp, anchorBottom, top: flipUp ? anchorBottom - maxH : belowTop });
      }
    };
    compute();
    const onR = () => compute();
    window.addEventListener('resize', onR);
    window.visualViewport?.addEventListener('resize', onR);
    return () => {
      window.removeEventListener('resize', onR);
      window.visualViewport?.removeEventListener('resize', onR);
      if (mutatedSp) mutatedSp.style.position = '';
    };
  }, [open, results]);

  // Flip correction: when opening ABOVE the input, anchor the list's BOTTOM to the
  // input top. The final `top` depends on the rendered height (≤ maxH), so measure
  // once the list is in the DOM — otherwise a short list would float away from the
  // input by the reserved maxH. Runs only on flip; converges in one frame (box
  // unchanged → effect doesn't re-fire when flipTop updates), no layout thrash.
  useLayoutEffect(() => {
    if (!box?.flipUp || !listRef.current) { return; }
    const h = listRef.current.offsetHeight;
    const t = box.anchorBottom - h;
    setFlipTop((prev) => (prev === t ? prev : t));
  }, [box]);

  const runSearch = (query) => {
    clearTimeout(timerRef.current);
    if (!query || query.trim().length < minChars) {
      setResults([]); setOpen(false); setHighlighted(-1); setLoading(false);
      return;
    }
    lastQueryRef.current = query;
    timerRef.current = setTimeout(async () => {
      // Raise `loading` only once the debounce settled and a request is really
      // in flight — doing it per keystroke spun the icon while idle (TRIP-277).
      setLoading(true);
      try {
        const r = (await search(query.trim(), langRef.current)) || [];
        if (lastQueryRef.current !== query) return; // ignore stale
        setResults(r);
        setOpen(r.length > 0);
        setHighlighted(-1);
      } catch {
        setResults([]); setOpen(false);
      } finally {
        setLoading(false);
      }
    }, debounceMs);
  };

  const handleChange = (e) => {
    const v = e.target.value;
    onInputChange?.(v);
    runSearch(v);
  };

  const pick = (r) => {
    setOpen(false);
    setResults([]);
    setHighlighted(-1);
    onPick?.(r);
  };

  const handleKeyDown = (e) => {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && highlighted >= 0) {
      e.preventDefault();
      pick(results[highlighted]);
    } else if (e.key === 'Escape') {
      // Stop here so the Esc that dismisses the dropdown doesn't also bubble to a
      // host Radix Dialog (EventEditDialog) and tear down the whole form.
      e.stopPropagation();
      setOpen(false);
    }
  };

  // Close on a pointer-down OUTSIDE the field and the list — NOT on input blur.
  // Selection lands on the row's onClick (a real tap), so a touch-drag inside the
  // list scrolls instead of selecting, and the drag never closes the dropdown.
  useEffect(() => {
    if (!open) return undefined;
    const onDocDown = (e) => {
      if (wrapRef.current?.contains(e.target)) return;
      if (listRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDocDown, true);
    return () => document.removeEventListener('pointerdown', onDocDown, true);
  }, [open]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return (
    <div style={{ position: 'relative', minWidth: 0 }}>
      {/* `boxRef` - на обёртку поля: по ней меряется позиция выпадающего списка
          и по ней же определяется «клик вне» (см. onDocDown выше). Индикатор
          держит сам <Input>: кольцо встаёт НА МЕСТО стартовой иконки (она тут
          есть всегда - у `icon` дефолт `pin`), ширина текстовой зоны при этом
          не меняется, поэтому дёргаться нечему и резерв справа не нужен. */}
      <Input
        boxRef={wrapRef}
        icon={icon}
        loading={loading}
        value={inputValue || ''}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && results.length > 0}
        aria-controls={`${uid}-list`}
        aria-activedescendant={highlighted >= 0 ? `${uid}-opt-${highlighted}` : undefined}
        {...inputProps}
      />
      {open && results.length > 0 && box && createPortal(
        <div
          ref={listRef}
          id={`${uid}-list`}
          role="listbox"
          className="menu"
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', left: box.left,
            top: box.flipUp && flipTop != null ? flipTop : box.top,
            width: box.width, zIndex: 'var(--z-popover)',
            maxHeight: box.maxH, overflowX: 'hidden', overflowY: 'auto',
            overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch',
          }}
        >
          {/* TRIP-391 объект 1: опция листа ВНУТРИ примитива Autocomplete (объект 5/поле-
              комбобокс) — часть самого примитива, не отдельная кнопка-объект. */}
          {results.map((r, i) => (
            <button
              key={getKey(r)}
              id={`${uid}-opt-${i}`}
              type="button"
              role="option"
              aria-selected={highlighted === i}
              className="mi"
              data-highlighted={highlighted === i ? '' : undefined}
              onMouseEnter={() => setHighlighted(i)}
              // Keep the input focused on tap (no keyboard flicker / iOS double-tap).
              // mousedown does NOT fire on a touch-drag, so this never blocks scroll.
              onMouseDown={(e) => e.preventDefault()}
              // Select on a real tap/click only — a touch-drag scrolls the list and
              // fires no click, so the user can scroll before choosing. Closing is
              // handled by the outside-pointerdown effect, not blur.
              onClick={() => pick(r)}
            >
              {renderRow(r)}
            </button>
          ))}
          {attribution && <GeoAttribution />}
        </div>,
        box.target,
      )}
    </div>
  );
}
