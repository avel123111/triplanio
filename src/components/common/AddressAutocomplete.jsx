import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { Popover, PopoverContent, PopoverTrigger } from '@/design/index';
import { Loader2, MapPin } from 'lucide-react';
import { useI18n } from '@/lib/i18n/I18nContext';
import GeoAttribution from '@/components/common/GeoAttribution';
import './AddressAutocomplete.css';

/**
 * LocationIQ-powered address autocomplete (proxied via the `geoLocationiq` edge
 * function). LocationIQ autocomplete returns coordinates inline, so there is no
 * second "details" round-trip and no Google session token — selecting a result
 * resolves the place immediately. Falls back to plain text input on errors (so
 * users can always type freely).
 *
 * Props mirror <Input>:
 *   value, onChange (string -> void), placeholder, className, etc.
 *
 * Additional:
 *   onPlaceSelected?: ({ formatted_address, name, latitude, longitude, place_id, description }) => void
 *   language?: 'ru' | 'en' | 'es' - overrides the user's app language (rarely needed)
 *
 * Attribution: LocationIQ data is OpenStreetMap (ODbL). On the Free plan a
 * "Search by LocationIQ" backlink + OSM attribution are required near the search.
 */

// Normalize one LocationIQ autocomplete result into the shape the list renders
// and consumers expect (coords inline — no details call needed).
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
  className,
  disabled,
  ...rest
}) {
  // Use the app's current language so place predictions come back localized.
  const { lang: appLang } = useI18n();
  const effectiveLang = language || appLang || 'en';
  const [predictions, setPredictions] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const debounceRef = useRef(null);
  const lastQueryRef = useRef('');
  const inputRef = useRef(null);

  const fetchPredictions = async (q) => {
    if (!q || q.trim().length < 2) {
      setPredictions([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('geoLocationiq', {
        body: { action: 'autocomplete', q: q.trim(), lang: effectiveLang, limit: 8 },
      });
      // Ignore stale responses
      if (lastQueryRef.current !== q) return;
      if (error) {
        setPredictions([]);
        setOpen(false);
        return;
      }
      const list = (data?.results || []).map(normalizeLiq);
      setPredictions(list);
      setOpen(list.length > 0);
      setHighlighted(-1);
    } catch {
      setPredictions([]);
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    const v = e.target.value;
    onChange?.(v);
    lastQueryRef.current = v;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchPredictions(v), 250);
  };

  const selectPrediction = (p) => {
    setOpen(false);
    setPredictions([]);
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
  };

  const handleKeyDown = (e) => {
    if (!open || predictions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((i) => Math.min(predictions.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && highlighted >= 0) {
      e.preventDefault();
      selectPrediction(predictions[highlighted]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="aa-wrap">
          <input
            ref={inputRef}
            value={value || ''}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => { if (predictions.length > 0) setOpen(true); }}
            placeholder={placeholder}
            className={`input ${className || ''}`}
            disabled={disabled}
            autoComplete="off"
            {...rest}
          />
          {loading && (
            <Loader2 className="aa-spin" size={14} />
          )}
        </div>
      </PopoverTrigger>
      {predictions.length > 0 && (
        <PopoverContent
          align="start"
          sideOffset={4}
          className="aa-pop"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <ul className="aa-list">
            {predictions.map((p, i) => (
              <li key={p.place_id}>
                <button
                  type="button"
                  onClick={() => selectPrediction(p)}
                  onMouseEnter={() => setHighlighted(i)}
                  className={`aa-opt ${highlighted === i ? 'is-active' : ''}`}
                >
                  <MapPin className="aa-opt__icon" size={14} />
                  <div className="aa-opt__body">
                    <div className="aa-opt__main">{p.main_text || p.description}</div>
                    {p.secondary_text && (
                      <div className="aa-opt__sec">{p.secondary_text}</div>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <GeoAttribution />
        </PopoverContent>
      )}
    </Popover>
  );
}
