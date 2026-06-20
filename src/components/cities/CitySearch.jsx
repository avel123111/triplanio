import React, { useState, useEffect } from 'react';
import { searchCities, countryFlag } from '@/lib/geo';
import { useI18n, useT } from '@/lib/i18n/I18nContext';
import { Icon } from '@/design/icons';
import GeoAttribution from '@/components/common/GeoAttribution';

// City autocomplete (LocationIQ via the geoLocationiq edge proxy). Lumo-bound:
// the field reuses the canonical .input, the dropdown reuses the canonical
// .menu/.mi action-menu, and all glyphs come from the single Icon library — no
// shadcn ui/* and no Tailwind utilities. onSelect(result) and the result shape
// ({ external_city_id, city_name, country_code, display_name, latitude,
// longitude }) are unchanged, so every consumer behaves identically.
export default function CitySearch({ onSelect }) {
  const t = useT();
  const { lang } = useI18n();
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (q.length < 2) { setResults([]); return undefined; }
    setLoading(true);
    const timer = setTimeout(async () => {
      const r = await searchCities(q, lang);
      setResults(r);
      setLoading(false);
    }, 350);
    return () => clearTimeout(timer);
  }, [q, lang]);

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ position: 'relative' }}>
        <Icon name="pin" size={15} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted-2)' }} />
        <input
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('visit.search_city')}
          autoFocus
          style={{ paddingLeft: 34 }}
        />
        {loading && (
          <Icon name="refresh" size={15} style={{ position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted-2)', animation: 'spin .7s linear infinite' }} />
        )}
      </div>
      {results.length > 0 && (
        <div className="menu" style={{ width: '100%', marginTop: 6, maxHeight: 288, overflowY: 'auto' }}>
          {results.map((c) => (
            <button
              key={c.external_city_id}
              type="button"
              className="mi"
              onClick={() => { onSelect(c); setQ(''); setResults([]); }}
            >
              <span style={{ fontSize: 'var(--fs-h4)', lineHeight: 1, flex: 'none' }}>{countryFlag(c.country_code)}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.city_name}</span>
                <span style={{ display: 'block', fontSize: 'var(--fs-meta)', fontWeight: 600, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.display_name}</span>
              </span>
            </button>
          ))}
          <GeoAttribution />
        </div>
      )}
    </div>
  );
}
