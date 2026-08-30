import React, { useState } from 'react';
import { searchCities } from '@/lib/geo';
import { useT, useI18n } from '@/lib/i18n/I18nContext';
import Autocomplete from '@/components/common/Autocomplete';
import { cityRowKey } from '@/components/cities/cityRowKey';
import { resolveCity } from '@/components/cities/resolveCity';
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
/**
 * @param {{ onSelect: (city: any) => void, autoFocus?: boolean,
 *   embedded?: boolean, fieldRef?: any }} p
 */
export default function CitySearch({ onSelect, autoFocus = true, embedded = false, fieldRef = undefined }) {
  const t = useT();
  const { lang } = useI18n();
  const [q, setQ] = useState('');

  return (
    <Autocomplete
      inputValue={q}
      onInputChange={setQ}
      search={(query, lang) => searchCities(query, lang)}
      getKey={cityRowKey}
      /* Тот же общий шаг, что у `CityPicker`: строка справочника доводится до
         города (имя страны + таймзона) ДО того, как уедет наружу. */
      onPick={(c) => { onSelect(resolveCity(c, lang)); setQ(''); }}
      renderRow={cityOptionRow}
      placeholder={t('visit.search_city')}
      title={t('visit.city')}
      autoFocus={autoFocus}
      /* `embedded` — поверхность уже есть у хозяина (композер города): движок
         отдаёт поле и лист без своей шторки, разбор — в `common/Autocomplete`. */
      embedded={embedded}
      fieldRef={fieldRef}
      attribution={false}
    />
  );
}
