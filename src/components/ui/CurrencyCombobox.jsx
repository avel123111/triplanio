import SearchSelect from '@/components/ui/SearchSelect';
import { CURRENCIES } from '@/lib/currencies';
import { useT } from '@/lib/i18n/I18nContext';

// Currency picker — thin wrapper over the shared SearchSelect (C4).
// Desktop: anchored popover with search. Mobile: bottom-sheet.
export default function CurrencyCombobox({ value, onChange, className = '' }) {
  const t = useT();
  return (
    <SearchSelect
      value={value}
      onChange={onChange}
      options={CURRENCIES}
      getKey={(c) => c.code}
      matches={(c, q) =>
        c.code.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        (c.symbol || '').toLowerCase().includes(q)
      }
      renderValue={(c) => `${c.code} · ${c.symbol}`}
      renderOption={(c) => (
        <>
          <span className="t-mono" style={{ width: 40, flex: 'none' }}>{c.code}</span>
          <span className="t-meta" style={{ flex: 1, minWidth: 0, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
          <span className="t-meta" style={{ color: 'var(--muted)' }}>{c.symbol}</span>
        </>
      )}
      placeholder={t('common.choose')}
      searchPlaceholder={t('common.currency_search_ph')}
      emptyText={t('common.not_found')}
      title={t('common.choose')}
      triggerClassName={`input ${className}`.trim()}
      width={256}
    />
  );
}
