import React, { useState, useEffect } from 'react';
import { searchCities } from '@/lib/geo';
import { tzFromCoords } from '@/lib/timezone';
import { localizeCountry } from '@/lib/i18n/format';
import { Icon } from '../../design/icons';
import { useT, useI18n } from '@/lib/i18n/I18nContext';
import Autocomplete from '@/components/common/Autocomplete';
import cityOptionRow from '@/components/common/cityOptionRow';

// ─── CityPicker ──────────────────────────────────────────────────────────────
// City picker for the create-flow rows — a thin facade over the shared
// <Autocomplete> engine (same field/dropdown/scroll/hover as CitySearch and the
// address picker). It owns only the create-flow contract: controlled `value`
// (city object), clear-on-type, and timezone enrichment on pick. Lives here (not
// in ManualPlanner) so both the planner steps and the AI panel reuse ONE picker
// without a circular import.
export function CityPicker({ value, onChange, placeholder, autoFocus }) {
  const t = useT();
  const { lang } = useI18n();
  const [q, setQ] = useState(value?.city_name || '');

  // Sync the field text when the selection changes externally.
  useEffect(() => { setQ(value?.city_name || ''); }, [value?.city_name]);

  return (
    <Autocomplete
      inputValue={q}
      onInputChange={(val) => { setQ(val); if (value) onChange(null); }}
      search={(query, lang) => searchCities(query, lang)}
      getKey={(c) => c.external_city_id}
      onPick={(city) => {
        setQ(city.city_name);
        // Gazetteer rows carry country_code but not a country name → derive the
        // localized name so the anchor/review shows a country, not blank.
        onChange({ ...city, country: city.country || localizeCountry(city.country_code, lang), timezone: tzFromCoords(city.latitude, city.longitude) });
      }}
      renderRow={cityOptionRow}
      placeholder={placeholder || t('planner.city_search_ph')}
      autoFocus={autoFocus}
      icon="pin"
      iconActive={!!value}
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
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="field__label">{label}</label>
          <CityPicker value={null} onChange={(c) => { onPick(c); setAdding(false); }} placeholder={t('planner.start_city_ph')} autoFocus />
        </div>
      );
    }
    return (
      <button type="button" className="te-end te-end--add" onClick={() => setAdding(true)}>
        <span className="te-row__node" style={{ background: soft, color: accent }}><Icon name="plus" size={13} /></span>
        <div className="te-citycell" style={{ flex: 1 }}>
          <span className="te-endlabel" style={{ color: accent }}>{label}</span>
          <span className="te-cityname muted" style={{ fontWeight: 500 }}>{t('planner.add_start')}</span>
        </div>
      </button>
    );
  }

  return (
    <div className="te-end">
      <span className="te-row__node" style={{ background: soft, color: accent }}><Icon name="flag" size={13} /></span>
      <div className="te-citycell" style={{ flex: 1 }}>
        <span className="te-endlabel" style={{ color: accent }}>{label}</span>
        <div className="te-cityline">
          <span className="te-cityname">{city?.city_name || <span className="muted" style={{ fontWeight: 500 }}>{t('planner.not_set')}</span>}</span>
          {city?.country && <span className="muted" style={{ fontWeight: 500, fontSize: 'var(--fs-meta)' }}>{city.country}</span>}
        </div>
      </div>
      {editable && hasCity && (
        <button type="button" className="te-step te-step--del" onClick={() => onPick(null)} title={t('common.delete')} aria-label={t('common.delete')}><Icon name="trash" size={13} /></button>
      )}
    </div>
  );
}
