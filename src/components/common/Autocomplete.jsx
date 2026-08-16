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
 *  • The list is a PLAIN overflow:auto div portaled to <body> with position:FIXED
 *    and z-index above the modal layer, so it OVERLAYS everything (dialog body,
 *    footer, dialog edge) and is NEVER clipped by an ancestor's overflow — the fix
 *    for a short dialog body cropping the list under its footer (TRIP-337). It is
 *    re-positioned from the input's viewport rect on any scroll (capture:true, so
 *    an inner scroller like the dialog body counts) and on resize, and FLIPS above
 *    the input when there's no room below (bottom-anchored via CSS `bottom`).
 *  • overscroll-behavior:contain + -webkit-overflow-scrolling:touch keep the
 *    gesture inside the list on phones (same hardening as .vp-b / .ss-list).
 *
 * The engine is data-agnostic: callers pass `search`, `getKey`, `renderRow`,
 * `onPick`, so the city/address contracts live in the facades, not here.
 */

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
  const timerRef = useRef(null);
  const lastQueryRef = useRef('');
  const wrapRef = useRef(null);
  const listRef = useRef(null);
  // Read inside the debounce timer so a mid-debounce language switch isn't stale.
  const langRef = useRef(lang);
  useEffect(() => { langRef.current = lang; }, [lang]);

  // Position the portaled list. It is portaled to <body> with position:FIXED and a
  // z-index above the modal layer (--z-popover 250 > --z-modal 200), so it OVERLAYS
  // everything — a dialog body, its footer, the dialog edge — and is NEVER clipped
  // by an ancestor's overflow. (The old absolute-in-scroller kept the list inside
  // the dialog body, so a short body cropped it under the footer — TRIP-337.) Fixed
  // coords come straight from the input's viewport rect; we re-derive on ANY scroll
  // (capture:true catches inner scrollers like the dialog body) and on resize, so
  // the list tracks the input. When there's no room below, FLIP above the input —
  // with fixed positioning the list's BOTTOM anchors to the input top via CSS
  // `bottom`, so no height measurement / second pass is needed.
  useLayoutEffect(() => {
    if (!open || results.length === 0) { setBox(null); return undefined; }
    const compute = () => {
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const gap = 4;
      const vh = window.visualViewport?.height || window.innerHeight;
      const spaceBelow = vh - r.bottom - 8;
      const spaceAbove = r.top - 8;
      const flipUp = spaceBelow < 200 && spaceAbove > spaceBelow;
      const maxH = Math.round(Math.max(140, Math.min(320, flipUp ? spaceAbove : spaceBelow)));
      setBox({
        left: Math.round(r.left),
        width: Math.round(r.width),
        maxH, flipUp,
        top: flipUp ? undefined : Math.round(r.bottom + gap),
        bottom: flipUp ? Math.round(vh - r.top + gap) : undefined,
      });
    };
    compute();
    const onMove = () => compute();
    // capture:true so a scroll INSIDE the dialog body (not just the window) fires.
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    window.visualViewport?.addEventListener('resize', onMove);
    window.visualViewport?.addEventListener('scroll', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
      window.visualViewport?.removeEventListener('resize', onMove);
      window.visualViewport?.removeEventListener('scroll', onMove);
    };
  }, [open, results]);

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
            position: 'fixed', left: box.left,
            top: box.top, bottom: box.bottom,
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
        document.body,
      )}
    </div>
  );
}
