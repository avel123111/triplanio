import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/design/icons';
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
  iconActive = false,
  minChars = 2,
  debounceMs = 300,
  leftPad = 36,
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
      const vh = window.visualViewport?.height || window.innerHeight;
      const spaceBelow = vh - r.bottom - 12;
      const maxH = Math.round(Math.max(160, Math.min(300, spaceBelow)));
      const width = Math.round(r.width);
      const isEl = sp !== document.body && sp !== document.scrollingElement;
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
        setBox({
          target: sp,
          left: Math.round(r.left - spRect.left + sp.scrollLeft),
          top: Math.round(r.bottom - spRect.top + sp.scrollTop + 4),
          width, maxH,
        });
      } else {
        // Page-level scroll: portal to <body> and position in document space.
        setBox({
          target: document.body,
          left: Math.round(r.left + window.scrollX),
          top: Math.round(r.bottom + window.scrollY + 4),
          width, maxH,
        });
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

  const runSearch = (query) => {
    clearTimeout(timerRef.current);
    if (!query || query.trim().length < minChars) {
      setResults([]); setOpen(false); setHighlighted(-1); setLoading(false);
      return;
    }
    setLoading(true);
    lastQueryRef.current = query;
    timerRef.current = setTimeout(async () => {
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
      <div style={{ position: 'relative' }} ref={wrapRef}>
        <Icon
          name={icon}
          size={15}
          style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: iconActive ? 'var(--brand)' : 'var(--muted-2)', pointerEvents: 'none' }}
        />
        <input
          className="input"
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
          style={{ paddingLeft: leftPad, paddingRight: loading ? 36 : 12 }}
          {...inputProps}
        />
        {loading && (
          <Icon name="refresh" size={15} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted-2)', animation: 'spin .7s linear infinite' }} />
        )}
      </div>
      {open && results.length > 0 && box && createPortal(
        <div
          ref={listRef}
          id={`${uid}-list`}
          role="listbox"
          className="menu"
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', left: box.left, top: box.top, width: box.width, zIndex: 250,
            maxHeight: box.maxH, overflowX: 'hidden', overflowY: 'auto',
            overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch',
          }}
        >
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
