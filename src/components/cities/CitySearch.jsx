import React, { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { searchCities, countryFlag } from '@/lib/geo';
import { Loader2, MapPin } from 'lucide-react';
import { useI18n, useT } from '@/lib/i18n/I18nContext';

export default function CitySearch({ onSelect }) {
  const t = useT();
  const { lang } = useI18n();
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (q.length < 2) { setResults([]); return; }
    setLoading(true);
    const timer = setTimeout(async () => {
      const r = await searchCities(q, lang);
      setResults(r);
      setLoading(false);
    }, 350);
    return () => clearTimeout(timer);
  }, [q, lang]);

  return (
    <div className="min-w-0">
      <div className="relative">
        <MapPin className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder={t('visit.search_city')} className="pl-9" autoFocus />
        {loading && <Loader2 className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground animate-spin" />}
      </div>
      {results.length > 0 && (
        <div className="mt-2 border rounded-lg overflow-hidden bg-card max-h-72 overflow-y-auto">
          {results.map(c => (
            <button
              key={c.external_city_id}
              type="button"
              onClick={() => { onSelect(c); setQ(''); setResults([]); }}
              className="w-full text-left px-3 py-2 hover:bg-secondary border-b border-border last:border-0 flex items-start gap-2 min-w-0"
            >
              <span className="text-xl mt-0.5 shrink-0">{countryFlag(c.country_code)}</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{c.city_name}</div>
                <div className="text-xs text-muted-foreground truncate">{c.display_name}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}