import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Loader2, MapPin } from 'lucide-react';
import { useI18n } from '@/lib/i18n/I18nContext';

/**
 * Google Places-powered address autocomplete.
 * Falls back to plain text input on errors (so users can always type freely).
 *
 * Props mirror <Input>:
 *   value, onChange (string -> void), placeholder, className, etc.
 *
 * Additional:
 *   onPlaceSelected?: ({ formatted_address, name, latitude, longitude, place_id }) => void
 *   language?: 'ru' | 'en' | 'es' — overrides the user's app language (rarely needed)
 */
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
  const sessionTokenRef = useRef(null);
  const debounceRef = useRef(null);
  const lastQueryRef = useRef('');
  const inputRef = useRef(null);

  // Generate a session token per "search session" (cleared on selection).
  const ensureSessionToken = () => {
    if (!sessionTokenRef.current) {
      sessionTokenRef.current = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;
    }
    return sessionTokenRef.current;
  };

  const fetchPredictions = async (q) => {
    if (!q || q.trim().length < 2) {
      setPredictions([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    try {
      const sessionToken = ensureSessionToken();
      const res = await supabase.functions.invoke('placesAutocomplete', {
        body: {
          action: 'autocomplete',
          input: q.trim(),
          language: effectiveLang,
          sessionToken,
        },
      });
      // Ignore stale responses
      if (lastQueryRef.current !== q) return;
      const list = res?.data?.predictions || [];
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

  const selectPrediction = async (p) => {
    setOpen(false);
    setPredictions([]);
    onChange?.(p.description);
    if (onPlaceSelected) {
      try {
        const sessionToken = sessionTokenRef.current;
        const res = await supabase.functions.invoke('placesAutocomplete', {
          body: {
            action: 'details',
            // Edge fn expects `placeId` (camelCase). Sending `place_id` made it
            // 400 → details never resolved → coords never reached the form.
            placeId: p.place_id,
            sessionToken,
            language: effectiveLang,
          },
        });
        // Edge fn returns { result: <google place> } with coords nested under
        // result.geometry.location. Flatten to the shape consumers expect
        // (see JSDoc): { formatted_address, name, latitude, longitude, ... }.
        const r = res?.data?.result;
        if (r) {
          onPlaceSelected({
            formatted_address: r.formatted_address,
            name: r.name,
            latitude: r.geometry?.location?.lat ?? null,
            longitude: r.geometry?.location?.lng ?? null,
            utc_offset_minutes: r.utc_offset_minutes,
            address_components: r.address_components,
            place_id: p.place_id,
            description: p.description,
          });
        }
      } catch { /* ignore — user can still see the address text */ }
    }
    // Clear session token after a successful selection (Google billing best practice)
    sessionTokenRef.current = null;
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
        <div className="relative">
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
            <Loader2 className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>
      </PopoverTrigger>
      {predictions.length > 0 && (
        <PopoverContent
          align="start"
          sideOffset={4}
          className="p-0 w-[--radix-popover-trigger-width] max-h-72 overflow-y-auto bg-popover text-popover-foreground"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <ul className="py-1">
            {predictions.map((p, i) => (
              <li key={p.place_id}>
                <button
                  type="button"
                  onClick={() => selectPrediction(p)}
                  onMouseEnter={() => setHighlighted(i)}
                  className={`w-full text-left px-3 py-2 flex items-start gap-2 text-sm text-foreground hover:bg-secondary ${
                    highlighted === i ? 'bg-secondary' : ''
                  }`}
                >
                  <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate text-foreground">{p.main_text || p.description}</div>
                    {p.secondary_text && (
                      <div className="text-xs text-muted-foreground truncate">{p.secondary_text}</div>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </PopoverContent>
      )}
    </Popover>
  );
}