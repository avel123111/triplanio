import React, { useEffect, useRef, useState } from 'react';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
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
 *  • Built on the DS `Popover` primitive (the same Radix-backed popover that the
 *    other searchable picker, `SearchSelect`, uses). That gives, for free and
 *    WITHOUT hand-rolled code: anchored positioning + automatic FLIP/collision so
 *    the list is never clipped by a short dialog body (TRIP-337), a z-index above
 *    the modal layer, and — crucially — membership in Radix's dismissable-layer
 *    STACK, so a click on a row never leaks out as "outside" and closes the host
 *    dialog. The old hand-rolled fixed-portal + manual outside-close + flip math
 *    are all deleted; this is the reuse-first version.
 *  • The list reuses `.ss-list` / `.ss-opt` — the SAME list chrome as SearchSelect
 *    (both are searchable pickers), so the two share one look and one hover
 *    (`--accent`). Keyboard highlight rides the same `[data-highlighted]` accent.
 *  • The input keeps focus while the list is open: `onOpenAutoFocus` is prevented
 *    (Radix would otherwise move focus into the content), and `onInteractOutside`
 *    is prevented when the target is the anchor (input), so clicking/typing in the
 *    field never dismisses the list. Arrow/Enter/Esc are handled on the input.
 *  • overscroll-behavior:contain + -webkit-overflow-scrolling:touch (on .ss-list)
 *    keep the gesture inside the list on phones.
 *
 * The engine is data-agnostic: callers pass `search`, `getKey`, `renderRow`,
 * `onPick`, so the city/address contracts live in the facades, not here.
 *
 * @param {{
 *   inputValue?: string, onInputChange?: (v: string) => void,
 *   search: (query: string, lang: string) => any, getKey: (r: any) => any,
 *   renderRow: (r: any) => any, onPick?: (r: any) => void,
 *   placeholder?: string, autoFocus?: boolean, disabled?: boolean,
 *   icon?: string, minChars?: number, debounceMs?: number,
 *   attribution?: boolean, inputProps?: object,
 * }} p
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
  const timerRef = useRef(null);
  const lastQueryRef = useRef('');
  const wrapRef = useRef(null);
  // Read inside the debounce timer so a mid-debounce language switch isn't stale.
  const langRef = useRef(lang);
  useEffect(() => { langRef.current = lang; }, [lang]);

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
      // Close the list without bubbling to a host Radix Dialog (EventEditDialog),
      // which would otherwise tear down the whole form on the same Esc.
      e.stopPropagation();
      setOpen(false);
    }
  };

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const isOpen = open && results.length > 0;

  return (
    <Popover open={isOpen} onOpenChange={(o) => { if (!o) setOpen(false); }}>
      {/* Anchor = the field wrapper; the list positions against it and keeps the
          input's width via --radix-popover-trigger-width. The loading indicator
          is owned by <Input> itself (ring in place of the leading icon). */}
      <PopoverAnchor asChild>
        <div ref={wrapRef} style={{ minWidth: 0 }}>
          <Input
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
            aria-expanded={isOpen}
            aria-controls={`${uid}-list`}
            aria-activedescendant={highlighted >= 0 ? `${uid}-opt-${highlighted}` : undefined}
            {...inputProps}
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        className="pop-flush"
        align="start"
        sideOffset={4}
        style={{ width: 'var(--radix-popover-trigger-width)' }}
        // Keep focus on the typing input, and don't let a pointer-down on the
        // input (the anchor) dismiss the list — only a click truly outside does.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => { if (wrapRef.current?.contains(e.target)) e.preventDefault(); }}
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        <div id={`${uid}-list`} role="listbox" className="ss-list scrollbar-thin">
          {results.map((r, i) => (
            <button
              key={getKey(r)}
              id={`${uid}-opt-${i}`}
              type="button"
              role="option"
              aria-selected={highlighted === i}
              className="ss-opt"
              data-highlighted={highlighted === i ? '' : undefined}
              onMouseEnter={() => setHighlighted(i)}
              // Keep the input focused on tap (no keyboard flicker / iOS double-tap).
              // mousedown does NOT fire on a touch-drag, so this never blocks scroll.
              onMouseDown={(e) => e.preventDefault()}
              // Select on a real tap/click only — a touch-drag scrolls the list and
              // fires no click, so the user can scroll before choosing.
              onClick={() => pick(r)}
            >
              {renderRow(r)}
            </button>
          ))}
          {attribution && <GeoAttribution />}
        </div>
      </PopoverContent>
    </Popover>
  );
}
