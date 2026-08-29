import React, { useState, useEffect } from 'react';
import { searchCities } from '@/lib/geo';
import { tzFromCoords } from '@/lib/timezone';
import { localizeCountry } from '@/lib/i18n/format';
import { useT, useI18n } from '@/lib/i18n/I18nContext';
import Autocomplete from '@/components/common/Autocomplete';
import cityOptionRow from '@/components/common/cityOptionRow';
import CountryFlag from '@/components/common/CountryFlag';

/**
 * CityPicker — КОНТРОЛИРУЕМЫЙ выбор города (газеттир GeoNames через
 * `search_gazetteer`). Фасад над общим движком <Autocomplete>: сам движок несёт
 * поле, лист, скролл и мобильную шторку, здесь живёт только контракт ГОРОДА —
 * `value` объектом, сброс выбора при новом вводе и обогащение результата на
 * выборе.
 *
 * ★ ЭТОТ ФАЙЛ СХЛОПЫВАЕТ ДВА ОДИНАКОВЫХ КОМПОНЕНТА (TRIP-484 §4). Их было два:
 * `pages/create/anchors.jsx` (визард создания) и приватная копия внутри
 * `EventEditDialog` (город пересадки). Один объект, две реализации, и они уже
 * разошлись по трём пунктам — каждое расхождение выглядело мелочью:
 *   • ключ строки: копия визарда брала только `external_city_id`, копия события —
 *     `geonameid ?? external_city_id ?? city_name`. Взят ВТОРОЙ: у части строк
 *     газеттира `external_city_id` пуст, и React получал key=undefined;
 *   • страна: копия события клала СЫРОЕ `c.country`, а `mapGazCity` всегда пишет
 *     туда null — то есть у города пересадки страны не было НИКОГДА. Взято
 *     обогащение визарда (`localizeCountry` по `country_code`), заодно страна
 *     переезжает вместе с языком зрителя;
 *   • флаг выбранной страны и «×» в поле были только у визарда.
 * Сохранённые данные от этого не поехали: `saveLayoverChain` проецирует поля
 * пересадки поимённо и лишних ключей не пишет.
 *
 * Родственник, который НЕ сюда: `CitySearch` — выбор БЕЗ состояния («сообщи, что
 * выбрали, и очистись»). Разные контракты, а не разные копии одного.
 *
 * `blurOnPick` — снять фокус с поля после выбора. На шаге 1 визарда дата вылета
 * схлопывается из ряда, пока поле города в фокусе (`:focus-within`); без снятия
 * фокуса она осталась бы спрятанной за уже заполненным полем.
 * Остаток пропов (`...rest`) уезжает НА ПОЛЕ — этим каналом едет состояние
 * валидации (`{...fieldState()}`) у города пересадки.
 */
export default function CityPicker({ value, onChange, placeholder, autoFocus, blurOnPick, ...rest }) {
  const t = useT();
  const { lang } = useI18n();
  const [q, setQ] = useState(value?.city_name || '');

  // Sync the field text when the selection changes externally.
  useEffect(() => { setQ(value?.city_name || ''); }, [value?.city_name]);

  // A committed, resolved city (coords + country) → its flag replaces the pin in the
  // field and a clear (×) appears (TRIP-337). While the user re-types, `value` is
  // cleared upstream (onInputChange below), so both revert to the plain pin.
  const validCity = value?.latitude != null && !!value?.country_code;

  return (
    <Autocomplete
      inputValue={q}
      onInputChange={(val) => { setQ(val); if (value) onChange(null); }}
      search={(query, searchLang) => searchCities(query, searchLang)}
      getKey={(c) => c.geonameid ?? c.external_city_id ?? c.city_name}
      onPick={(city) => {
        setQ(city.city_name);
        // Gazetteer rows carry country_code but never a country name (mapGazCity
        // sets country: null) → derive the localized name here so the anchor/review
        // shows a country, not blank. This is the single point that enriches a raw
        // search result; downstream consumers already receive the derived name.
        onChange({ ...city, country: localizeCountry(city.country_code, lang), timezone: tzFromCoords(city.latitude, city.longitude) });
        if (blurOnPick) requestAnimationFrame(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
      }}
      renderRow={cityOptionRow}
      placeholder={placeholder || t('planner.city_search_ph')}
      /* Заголовок шторки называет ПРЕДМЕТ выбора, а не пример ввода:
         плейсхолдер у поля адреса — это образец строки («Travessa das
         Merceeiras 27»), и в шапке он читался бы как чей-то адрес. */
      title={t('visit.city')}
      autoFocus={autoFocus}
      icon="pin"
      inputProps={{
        ...rest,
        iconNode: validCity ? <CountryFlag code={value.country_code} /> : undefined,
        onClear: value ? () => onChange(null) : undefined,
        clearLabel: t('common.remove'),
      }}
      attribution={false}
    />
  );
}
