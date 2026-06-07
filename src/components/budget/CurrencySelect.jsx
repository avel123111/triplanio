/**
 * CurrencySelect - searchable currency picker styled for the design/index
 * screens (BudgetLens, SettingsLens). A button that opens a popover with a
 * text filter over the shared CURRENCIES list.
 *
 * The popover is rendered through a portal with `position: fixed`, so it is
 * never clipped by a scrolling/overflow-hidden modal body and always paints
 * above the dialog footer.
 *
 * Props:
 *   value      - selected ISO code (e.g. 'EUR')
 *   onChange   - (code) => void
 *   width      - optional button width (default 110)
 *   className  - extra classes for the trigger button (e.g. to join an input group)
 */
import React, { useState, useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/design/icons';
import { useT } from '@/lib/i18n/I18nContext';
import { CURRENCIES, filterCurrencies } from '@/lib/budget/currencies';

const POP_W = 260;

export default function CurrencySelect({ value, onChange, width = 110, className = '' }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [rect, setRect] = useState(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);

  const current = CURRENCIES.find((c) => c.code === value);
  const filtered = useMemo(() => filterCurrencies(query), [query]);

  // Track the trigger position while open (re-measure on scroll/resize).
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const update = () => {
      const r = btnRef.current.getBoundingClientRect();
      setRect({ left: r.left, top: r.bottom + 4, width: r.width });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  // Close on outside click (button + portal popover are both "inside").
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (btnRef.current?.contains(e.target)) return;
      if (popRef.current?.contains(e.target)) return;
      setOpen(false); setQuery('');
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div style={{ position: 'relative', width }}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`select ${className}`.trim()}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 6, cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span>{current ? `${current.code} ${current.symbol || ''}`.trim() : (value || t('budget.field_currency'))}</span>
        <Icon name="chevD" size={14} style={{ opacity: 0.5, flexShrink: 0 }} />
      </button>
      {open && rect && createPortal(
        <div
          ref={popRef}
          style={{
            position: 'fixed',
            top: rect.top,
            left: Math.max(8, Math.min(rect.left, window.innerWidth - POP_W - 8)),
            width: POP_W, maxWidth: '92vw', zIndex: 1000,
            background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10,
            boxShadow: 'var(--shadow-pop)', overflow: 'hidden',
          }}
        >
          <div style={{ padding: 8, borderBottom: '1px solid var(--line)' }}>
            <input
              className="input"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('common.currency_search_ph')}
              style={{ fontSize: 'var(--fs-base)' }}
            />
          </div>
          <div style={{ maxHeight: 240, overflowY: 'auto', padding: 4 }}>
            {filtered.length === 0 ? (
              <div className="muted" style={{ padding: '12px', fontSize: 'var(--fs-meta)', textAlign: 'center' }}>{t('common.not_found')}</div>
            ) : filtered.map((c) => (
              <button
                key={c.code}
                type="button"
                onClick={() => { onChange(c.code); setOpen(false); setQuery(''); }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                  padding: '7px 9px', border: 'none', borderRadius: 7,
                  background: value === c.code ? 'var(--brand-soft)' : 'transparent',
                  cursor: 'pointer', textAlign: 'left', fontSize: 'var(--fs-base)',
                }}
              >
                <span className="num" style={{ fontWeight: 600, width: 40, flexShrink: 0 }}>{c.code}</span>
                <span className="muted" style={{ flex: 1, minWidth: 0, fontSize: 'var(--fs-micro)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                <span className="muted" style={{ fontSize: 'var(--fs-micro)' }}>{c.symbol}</span>
                {value === c.code && <Icon name="check" size={12} style={{ color: 'var(--brand)' }} />}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
