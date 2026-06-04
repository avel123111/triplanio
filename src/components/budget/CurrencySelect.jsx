/**
 * CurrencySelect - searchable currency picker styled for the design/index
 * screens (BudgetLens, SettingsLens). A button that opens a popover with a
 * text filter over the shared CURRENCIES list.
 *
 * Props:
 *   value     - selected ISO code (e.g. 'EUR')
 *   onChange  - (code) => void
 *   width     - optional button width (default 110)
 */
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Icon } from '@/design/icons';
import { useT } from '@/lib/i18n/I18nContext';
import { CURRENCIES, filterCurrencies } from '@/lib/budget/currencies';

export default function CurrencySelect({ value, onChange, width = 110 }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);

  const current = CURRENCIES.find((c) => c.code === value);
  const filtered = useMemo(() => filterCurrencies(query), [query]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setQuery(''); } };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative', width }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="select"
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 6, cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span>{current ? `${current.code} ${current.symbol || ''}`.trim() : (value || t('budget.field_currency'))}</span>
        <Icon name="chev" size={12} style={{ opacity: 0.5 }} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 50,
          width: 240, maxWidth: '80vw',
          background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10,
          boxShadow: 'var(--shadow-pop)', overflow: 'hidden',
        }}>
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
        </div>
      )}
    </div>
  );
}
