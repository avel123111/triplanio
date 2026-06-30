import React, { useState } from 'react';
import { searchCities } from '@/lib/geo';
import { useT } from '@/lib/i18n/I18nContext';
import Autocomplete from '@/components/common/Autocomplete';
import cityOptionRow from '@/components/common/cityOptionRow';

/**
 * CitySearch — city picker (GeoNames gazetteer via the search_gazetteer RPC,
 * TRIP-146). A thin facade over the canonical <Autocomplete> engine: it owns
 * only the city data contract (searchCities → { geonameid, external_city_id,
 * city_name, country_code, name_i18n, display_name, latitude, longitude }),
 * while the field + dropdown + scroll + hover come from the shared engine —
 * identical to the address picker and the ManualPlanner city rows.
 * onSelect(result) is unchanged, so every consumer behaves identically.
 */
export default function CitySearch({ onSelect }) {
  const t = useT();
  const [q, setQ] = useState('');

  return (
    <Autocomplete
      inputValue={q}
      onInputChange={setQ}
      search={(query, lang) => searchCities(query, lang)}
      getKey={(c) => c.geonameid ?? c.external_city_id}
      onPick={(c) => { onSelect(c); setQ(''); }}
      renderRow={cityOptionRow}
      placeholder={t('visit.search_city')}
      autoFocus
    />
  );
}
