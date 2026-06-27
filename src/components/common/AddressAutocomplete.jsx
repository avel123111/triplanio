import React from 'react';
import { supabase } from '@/api/supabaseClient';
import { Icon } from '@/design/icons';
import { useI18n } from '@/lib/i18n/I18nContext';
import Autocomplete from '@/components/common/Autocomplete';

/**
 * AddressAutocomplete — address picker (LocationIQ via the `geoLocationiq` edge
 * proxy). A thin facade over the canonical <Autocomplete> engine: it owns only
 * the address data contract (LocationIQ place → coords inline, no details call,
 * no session token), while the field + dropdown + scroll + hover come from the
 * shared engine, identical to the city pickers (CitySearch / ManualPlanner).
 *
 * Props mirror <Input>: value, onChange (string -> void), placeholder, disabled.
 * Additional:
 *   onPlaceSelected?: ({ formatted_address, name, latitude, longitude, place_id, description, address_components }) => void
 *   language?: 'ru' | 'en' | 'es' — overrides the user's app language (rarely needed)
 *
 * Attribution (LocationIQ Free / OSM ODbL) renders in the dropdown footer via the
 * engine's <GeoAttribution>.
 */

// Normalize one LocationIQ autocomplete result (coords inline — no details call).
function normalizeLiq(item) {
  const dn = item.display_name || '';
  const main = item.address?.name || dn.split(',')[0] || dn;
  const secondary = dn.startsWith(main) ? dn.slice(main.length).replace(/^,\s*/, '') : dn;
  return {
    place_id: String(item.place_id),
    description: dn,
    main_text: main,
    secondary_text: secondary,
    latitude: item.lat != null ? parseFloat(item.lat) : null,
    longitude: item.lon != null ? parseFloat(item.lon) : null,
    address: item.address || null,
  };
}

export default function AddressAutocomplete({
  value,
  onChange,
  onPlaceSelected,
  language,
  placeholder,
  disabled,
}) {
  const { lang: appLang } = useI18n();

  const search = async (q, engineLang) => {
    const effectiveLang = language || engineLang || appLang || 'en';
    const { data, error } = await supabase.functions.invoke('geoLocationiq', {
      body: { action: 'autocomplete', q, lang: effectiveLang, limit: 8 },
    });
    if (error) return [];
    return (data?.results || []).map(normalizeLiq);
  };

  return (
    <Autocomplete
      inputValue={value}
      onInputChange={(v) => onChange?.(v)}
      search={search}
      getKey={(p) => p.place_id}
      onPick={(p) => {
        onChange?.(p.description);
        // LocationIQ autocomplete already carries coords — resolve immediately,
        // no details round-trip. Timezone is computed by the caller from coords.
        onPlaceSelected?.({
          formatted_address: p.description,
          name: p.main_text,
          latitude: p.latitude,
          longitude: p.longitude,
          address_components: p.address,
          place_id: p.place_id,
          description: p.description,
        });
      }}
      renderRow={(p) => (
        <>
          <Icon name="pin" size={16} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.main_text || p.description}</span>
            {p.secondary_text && (
              <span style={{ display: 'block', fontSize: 'var(--fs-meta)', fontWeight: 600, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.secondary_text}</span>
            )}
          </span>
        </>
      )}
      placeholder={placeholder}
      disabled={disabled}
      icon="pin"
    />
  );
}
