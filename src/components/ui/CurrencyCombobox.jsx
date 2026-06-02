import React, { useState, useMemo } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Check, ChevronDown, Search } from 'lucide-react';
import { CURRENCIES } from '@/lib/currencies';

export default function CurrencyCombobox({ value, onChange, className = '' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CURRENCIES;
    return CURRENCIES.filter(c =>
      c.code.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      (c.symbol || '').toLowerCase().includes(q)
    );
  }, [query]);

  const current = CURRENCIES.find(c => c.code === value);

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(''); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`input ${className}`}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, cursor: 'pointer', textAlign: 'left' }}
        >
          <span style={value ? undefined : { color: 'var(--muted-2)' }}>
            {current ? `${current.code} · ${current.symbol}` : (value || 'Выбрать…')}
          </span>
          <ChevronDown className="w-3.5 h-3.5 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0 w-64"
        align="start"
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        <div className="p-2 border-b">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" style={{ zIndex: 1 }} />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Поиск (USD, Euro, ₽…)"
              className="input"
              style={{ paddingLeft: 32 }}
            />
          </div>
        </div>
        <div
          className="max-h-64 overflow-y-auto py-1 overscroll-contain"
          onWheel={(e) => e.stopPropagation()}
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-xs text-muted-foreground text-center">Ничего не найдено</div>
          ) : filtered.map(c => (
            <button
              key={c.code}
              type="button"
              onClick={() => { onChange(c.code); setOpen(false); setQuery(''); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-secondary/60 transition text-left"
            >
              <span className="font-mono font-semibold w-10 shrink-0">{c.code}</span>
              <span className="text-muted-foreground text-xs flex-1 truncate">{c.name}</span>
              <span className="text-xs text-muted-foreground">{c.symbol}</span>
              {value === c.code && <Check className="w-3.5 h-3.5 text-primary" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}