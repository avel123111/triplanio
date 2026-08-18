import React, { useState, useEffect } from 'react';
import { searchCities } from '@/lib/geo';
import { tzFromCoords } from '@/lib/timezone';
import { localizeCountry } from '@/lib/i18n/format';
import { Icon } from '../../design/icons';
import { Card, Tile } from '../../design/index';
import { useT, useI18n } from '@/lib/i18n/I18nContext';
import Autocomplete from '@/components/common/Autocomplete';
import cityOptionRow from '@/components/common/cityOptionRow';
import CountryFlag from '@/components/common/CountryFlag';

// ─── CityPicker ──────────────────────────────────────────────────────────────
// City picker for the create-flow rows — a thin facade over the shared
// <Autocomplete> engine (same field/dropdown/scroll/hover as CitySearch and the
// address picker). It owns only the create-flow contract: controlled `value`
// (city object), clear-on-type, and timezone enrichment on pick. Lives here (not
// in ManualPlanner) so both the planner steps and the AI panel reuse ONE picker
// without a circular import.
// `blurOnPick` — after a pick, drop focus off the field. On step 1 the departure
// date collapses out of the row while the city input is focused (:focus-within);
// blurring on pick lets the date reappear instead of staying hidden behind a
// still-focused input.
export function CityPicker({ value, onChange, placeholder, autoFocus, blurOnPick }) {
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
      search={(query, lang) => searchCities(query, lang)}
      getKey={(c) => c.external_city_id}
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
      autoFocus={autoFocus}
      icon="pin"
      inputProps={{
        iconNode: validCity ? <CountryFlag code={value.country_code} /> : undefined,
        onClear: value ? () => onChange(null) : undefined,
        clearLabel: t('common.remove'),
      }}
      attribution={false}
    />
  );
}

// ─── CityAnchorRow ────────────────────────────────────────────────────────────
// Start / finish plate — the SAME element as the editor's GridEndpoint (.te-end:
// flag node, eyebrow label, bold .te-cityname). One look across every create
// screen (planner steps + AI draft). Endpoint marker is a single blue flag
// (unified — no green-check / orange-globe divergence).
//
// Modes:
//   • read-only (default): shows the resolved city, or "не указан" when empty.
//   • editable: when empty renders a dashed "+ {label}" affordance that expands
//     into the CityPicker; when filled shows a trailing clear button. Used for
//     the OPTIONAL origin so manual (skipped on step 1) and AI (origin not
//     recognised) share one add-start control.
export function CityAnchorRow({ label, city, editable = false, onPick }) {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const hasCity = !!city?.city_name;
  const accent = 'var(--brand)';
  const soft = 'var(--brand-soft)';

  // Editable + empty → an inline "add start" affordance. One element for both
  // flows (manual skip + AI no-origin) — the origin can always be added later.
  if (editable && !hasCity) {
    if (adding) {
      return (
        <div className="field">
          <label className="field__label">{label}</label>
          <CityPicker value={null} onChange={(c) => { onPick(c); setAdding(false); }} placeholder={t('planner.start_city_ph')} autoFocus />
        </div>
      );
    }
    return (
      <Card as="button" variant="add" radius="btn" pad="none" className="row row--g6 te-end te-end--add" onClick={() => setAdding(true)}>
        <Tile as="span" className="te-row__node" style={{ '--hl-soft': soft, '--hl-ink': accent }}><Icon name="plus" size={13} /></Tile>
        <div className="te-citycell grow">
          <span className="te-endlabel" style={{ color: accent }}>{label}</span>
          <span className="trunc te-cityname muted">{t('planner.add_start')}</span>
        </div>
      </Card>
    );
  }

  return (
    <Card recessed radius="btn" pad="none" className="row row--g6 te-end">
      <Tile as="span" className="te-row__node" style={{ '--hl-soft': soft, '--hl-ink': accent }}><Icon name="flag" size={13} /></Tile>
      <div className="te-citycell grow">
        <span className="te-endlabel" style={{ color: accent }}>{label}</span>
        <div className="row row--g3 te-cityline">
          <span className="trunc te-cityname">{city?.city_name || <span className="muted">{t('planner.not_set')}</span>}</span>
          {city?.country && <span className="muted t-meta">{city.country}</span>}
        </div>
      </div>
      {/* TRIP-391 объект 1: .te-step — КОНТРОЛ степпера маршрута (удалить точку),
          не кнопка-примитив. */}
      {editable && hasCity && (
        <button type="button" className="te-step te-step--del" onClick={() => onPick(null)} title={t('common.delete')} aria-label={t('common.delete')}><Icon name="trash" size={13} /></button>
      )}
    </Card>
  );
}
