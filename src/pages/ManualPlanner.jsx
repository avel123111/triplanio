import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useT, useI18n } from '@/lib/i18n/I18nContext';
import { useToast } from '@/components/ui/use-toast';
import { isTripInPast } from '@/lib/trip-dates';
import { isProActive } from '@/lib/subscription';
import { useTheme } from '@/lib/ThemeContext';
import { searchCities, getTimezone, countryFlag, reverseGeocode } from '@/lib/geo';
import { Icon } from '../design/icons';
import { Btn } from '../design/index';
import HeaderActions from '@/components/HeaderActions';
import TripCoverPicker from '@/components/trips/TripCoverPicker';
import { getGradientById } from '@/lib/trip-gradients';
import FlowProgress from '@/pages/create/FlowProgress';
import FlowMap from '@/pages/create/FlowMap';
import PanelAi from '@/pages/create/PanelAi';
import '../design/app.css';

// Whole days between two ISO date strings (b - a). 0 on bad input.
function daysBetweenISO(a, b) {
  if (!a || !b) return 0;
  const da = new Date(a + 'T00:00:00');
  const db = new Date(b + 'T00:00:00');
  if (isNaN(da) || isNaN(db)) return 0;
  return Math.round((db - da) / 86400000);
}

// ─── Static data ──────────────────────────────────────────────────────────────
// Unified create-flow steps. The "Транспорт" step was removed - transfers are
// no longer collected at creation time (added later in the timeline / Edit
// Mode). "Возврат" is skipped when the last city is marked as the finish point.
const STEPS = [
  { id: 'home',   num: 1, labelKey: 'planner.step_home' },
  { id: 'cities', num: 2, labelKey: 'planner.step_cities' },
  { id: 'return', num: 3, labelKey: 'planner.step_return' },
  { id: 'review', num: 4, labelKey: 'planner.step_review' },
];

// Storage key is user- and method-specific so the manual and AI drafts don't
// leak into each other (the same flow component serves both routes).
const storageKey = (userId, method = 'manual') => `triplanio-planner-${method}-${userId || 'guest'}`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Local YYYY-MM-DD (NOT toISOString - that converts to UTC and, in positive
// timezones, shifts the date back a day, which broke the ±1-day stepper).
function ymdLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return ymdLocal(d);
}

function shortDateLabel(iso, locale = 'ru') {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return '';
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(d);
  } catch {
    return new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' }).format(d);
  }
}

// Default trip start = one month ahead of today (local), YYYY-MM-DD.
function defaultStartISO() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return ymdLocal(d);
}

// Auto trip title: start city → last real destination ("предпоследний" узел
// маршрута, т.к. последним идёт возврат). Falls back gracefully.
function computeAutoTitle(home, cities, t) {
  const startName = home?.city_name || cities[0]?.city_name || '';
  const lastName = cities[cities.length - 1]?.city_name || '';
  if (startName && lastName && startName !== lastName) return `${startName} → ${lastName}`;
  return startName || lastName || t('trips.new');
}

function recomputeDates(list) {
  // Only recompute if the first city has an anchor date - otherwise leave dates alone
  if (list.length === 0 || !list[0].startDate) return list;
  let cursor = new Date(list[0].startDate + 'T00:00:00');
  return list.map((c, i) => {
    if (i === 0) {
      cursor.setDate(cursor.getDate() + (+c.nights || 0));
      return c;
    }
    const d = new Date(cursor);
    cursor.setDate(cursor.getDate() + (+c.nights || 0));
    return { ...c, startDate: ymdLocal(d) };
  });
}

// ─── CityPicker ──────────────────────────────────────────────────────────────

function CityPicker({ value, onChange, placeholder, autoFocus, style: extStyle }) {
  const t = useT();
  const { lang } = useI18n();
  const [q, setQ] = useState(value?.city_name || '');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const timerRef = useRef(null);

  // Sync display when value changes externally
  useEffect(() => {
    setQ(value?.city_name || '');
  }, [value?.city_name]);

  const runSearch = (query) => {
    clearTimeout(timerRef.current);
    if (query.length < 2) { setResults([]); setOpen(false); return; }
    setLoading(true);
    timerRef.current = setTimeout(async () => {
      const r = await searchCities(query, lang);
      setResults(r);
      setLoading(false);
      setOpen(r.length > 0);
    }, 350);
  };

  const handleChange = (e) => {
    const val = e.target.value;
    setQ(val);
    if (value) onChange(null); // clear selection when user types
    runSearch(val);
  };

  const handleSelect = async (city) => {
    setOpen(false);
    setResults([]);
    setQ(city.city_name);
    setLoading(true);
    const tz = await getTimezone(city.latitude, city.longitude);
    setLoading(false);
    onChange({ ...city, timezone: tz });
  };

  const handleBlur = () => {
    // Delay to allow mousedown on dropdown items
    setTimeout(() => setOpen(false), 200);
  };

  return (
    <div style={{ position: 'relative', ...extStyle }}>
      <div style={{ position: 'relative' }}>
        <Icon
          name="pin" size={15}
          style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: value ? 'var(--brand)' : 'var(--muted-2)', pointerEvents: 'none' }}
        />
        <input
          className="input"
          value={q}
          onChange={handleChange}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={handleBlur}
          placeholder={placeholder || t('planner.city_search_ph')}
          style={{ paddingLeft: 36, paddingRight: loading ? 36 : 12, fontSize: 15 }}
          autoFocus={autoFocus}
        />
        {loading && (
          <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, border: '2px solid var(--brand)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
        )}
      </div>
      {open && results.length > 0 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 200,
          background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,.12)', overflow: 'hidden', maxHeight: 260, overflowY: 'auto',
        }}>
          {results.map((c) => (
            <button
              key={c.external_city_id}
              onMouseDown={() => handleSelect(c)}
              style={{
                width: '100%', textAlign: 'left', padding: '10px 14px', border: 'none',
                borderBottom: '1px solid var(--line-2)', background: 'transparent', cursor: 'pointer',
                display: 'flex', gap: 10, alignItems: 'center',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--wash)'}
              onMouseLeave={e => e.currentTarget.style.background = ''}
            >
              <span style={{ fontSize: 18, flexShrink: 0 }}>{countryFlag(c.country_code)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{c.city_name}</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.display_name}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── FooterNav ────────────────────────────────────────────────────────────────

function FooterNav({ children }) {
  return (
    <div style={{ marginTop: 28, paddingTop: 18, borderTop: '1px solid var(--line-2)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {children}
    </div>
  );
}

// ─── CityAnchorRow ────────────────────────────────────────────────────────────

function CityAnchorRow({ label, city_name, country, kind }) {
  const t = useT();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'var(--wash)', border: '1px solid var(--line-2)', borderRadius: 12 }}>
      <div style={{ width: 32, height: 32, borderRadius: '50%', background: kind === 'home' ? 'var(--brand)' : 'var(--ink-2)', color: 'white', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
        <Icon name={kind === 'home' ? 'flag' : 'check'} size={14} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="eyebrow" style={{ fontSize: 10, marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>
          {city_name || <span style={{ color: 'var(--muted)' }}>{t('planner.not_set')}</span>}
          {country && <span className="muted" style={{ fontWeight: 500, marginLeft: 6 }}>{country}</span>}
        </div>
      </div>
    </div>
  );
}

// ─── CityRow ──────────────────────────────────────────────────────────────────

function CityRow({ idx, total, city, isDragging, dropTop, dropBottom, isLast, finalPoint, onToggleFinalPoint, onDragStart, onDragEnd, onChange, onRemove, onMoveUp, onMoveDown }) {
  const t = useT();
  const { lang } = useI18n();
  // When the last city is also the final point, the card switches to an
  // "end-anchor" look - warm orange tones, flag icon, and the nights
  // input disappears (the end visit is computed, not entered).
  const isFinalAnchor = isLast && finalPoint;
  const accentColor = isFinalAnchor ? 'var(--warm, #c9603a)' : 'var(--brand)';
  const accentSoft = isFinalAnchor ? 'var(--warm-tint, color-mix(in oklab, var(--warm, #c9603a) 14%, transparent))' : 'var(--brand-soft)';
  // A city is "invalid" once it has text but no resolved coordinates - i.e. it
  // wasn't picked from the directory. We block the Next button on these.
  const invalid = !!city.city_name && city.latitude == null;
  const startLabel = city.startDate ? shortDateLabel(city.startDate, lang) : null;
  const endLabel = (city.startDate && city.nights) ? shortDateLabel(addDays(city.startDate, +city.nights), lang) : null;
  return (
    <div
      style={{
        background: isFinalAnchor ? accentSoft : 'var(--surface)',
        border: '1px solid ' + (invalid ? 'var(--danger, #e74c3c)' : isFinalAnchor ? accentColor : 'var(--line)'),
        borderRadius: 12,
        opacity: isDragging ? 0.4 : 1,
        boxShadow: dropTop ? 'inset 0 3px 0 0 var(--brand)' : dropBottom ? 'inset 0 -3px 0 0 var(--brand)' : 'none',
        transition: 'background .15s, border-color .15s, opacity .15s, box-shadow .12s',
        overflow: 'hidden',
      }}
    >
    <div className="planner-city-row" style={{ padding: '10px 12px' }}>
      {/* Drag handle */}
      <div
        className="planner-city-row__handle"
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        title={t('planner.drag')}
        style={{ width: 22, height: 22, borderRadius: 5, display: 'grid', placeItems: 'center', color: 'var(--muted-2)', cursor: 'grab' }}
      >
        <Icon name="drag" size={14} />
      </div>

      {/* Number badge - flag icon when this is the final anchor */}
      <div className="planner-city-row__num" style={{ width: 28, height: 28, borderRadius: '50%', background: accentColor, color: 'white', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
        {isFinalAnchor ? <Icon name="flag" size={13} /> : (idx + 1)}
      </div>

      {/* City search */}
      <div className="planner-city-row__picker" style={{ minWidth: 0 }}>
        <CityPicker
          value={city.city_name ? city : null}
          onChange={(picked) => {
            if (picked) {
              onChange({ city_name: picked.city_name, country: picked.country, country_code: picked.country_code, latitude: picked.latitude, longitude: picked.longitude, timezone: picked.timezone, external_city_id: picked.external_city_id });
            } else {
              onChange({ city_name: '', country: '', country_code: '', latitude: null, longitude: null, timezone: null, external_city_id: null });
            }
          }}
          placeholder={t('planner.city_ph')}
          style={{ fontSize: 13.5 }}
        />
      </div>

      {/* Derived date range - read-only. Dates are computed from the trip start
          and each city's nights (city N starts where city N-1 ends), so they
          can't be edited per-row and never drift the trip start. */}
      {!isFinalAnchor && startLabel && (
        <div className="planner-city-row__date num" style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap', textAlign: 'right' }}>
          {startLabel}{endLabel ? ` → ${endLabel}` : ''}
        </div>
      )}

      {/* Nights stepper - hidden for the final anchor */}
      {!isFinalAnchor && (
        <div className="planner-city-row__nights" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button type="button" title={t('planner.fewer_nights')} onClick={() => onChange({ nights: Math.max(1, (+city.nights || 1) - 1) })}
            disabled={(+city.nights || 1) <= 1}
            style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid var(--line)', background: 'var(--surface)', cursor: (+city.nights || 1) <= 1 ? 'default' : 'pointer', opacity: (+city.nights || 1) <= 1 ? 0.4 : 1, display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 15, fontWeight: 700, lineHeight: 1, paddingBottom: 2 }}>−</button>
          <span className="num" style={{ minWidth: 34, textAlign: 'center', fontSize: 12.5, fontWeight: 600 }}>{city.nights || 1}<span className="muted" style={{ fontWeight: 400 }}>{t('planner.night_short')}</span></span>
          <button type="button" title={t('planner.more_nights')} onClick={() => onChange({ nights: Math.min(30, (+city.nights || 1) + 1) })}
            disabled={(+city.nights || 1) >= 30}
            style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid var(--line)', background: 'var(--surface)', cursor: (+city.nights || 1) >= 30 ? 'default' : 'pointer', opacity: (+city.nights || 1) >= 30 ? 0.4 : 1, display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 15, fontWeight: 700, lineHeight: 1, paddingBottom: 2 }}>+</button>
        </div>
      )}

      {/* Actions */}
      <div className="planner-city-row__actions" style={{ display: 'flex', gap: 2 }}>
        <button onClick={onMoveUp} disabled={idx === 0} title={t('planner.move_up')} style={{ width: 26, height: 26, borderRadius: 6, border: 'none', background: 'transparent', cursor: idx === 0 ? 'default' : 'pointer', opacity: idx === 0 ? 0.3 : 1, display: 'grid', placeItems: 'center', color: 'var(--muted)' }}>
          <Icon name="chevU" size={12} />
        </button>
        <button onClick={onMoveDown} disabled={idx === total - 1} title={t('planner.move_down')} style={{ width: 26, height: 26, borderRadius: 6, border: 'none', background: 'transparent', cursor: idx === total - 1 ? 'default' : 'pointer', opacity: idx === total - 1 ? 0.3 : 1, display: 'grid', placeItems: 'center', color: 'var(--muted)' }}>
          <Icon name="chevD" size={12} />
        </button>
        <button onClick={onRemove} title={t('common.delete')} style={{ width: 26, height: 26, borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer', display: 'grid', placeItems: 'center', color: 'var(--muted)' }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--danger, #e74c3c)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--muted)'}
        >
          <Icon name="trash" size={13} />
        </button>
      </div>
    </div>
    {isLast && (
      <div style={{
        borderTop: '1px dashed ' + (isFinalAnchor ? accentColor : 'var(--line-2)'),
        padding: '12px 14px',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button
          type="button"
          role="switch"
          aria-checked={!!finalPoint}
          onClick={() => onToggleFinalPoint?.(!finalPoint)}
          style={{
            width: 36, height: 20, borderRadius: 999,
            border: 'none', cursor: 'pointer', padding: 2,
            background: finalPoint ? accentColor : 'var(--line)',
            transition: 'background .15s', flexShrink: 0,
            display: 'inline-flex', alignItems: 'center',
          }}
        >
          <span style={{
            width: 16, height: 16, borderRadius: '50%',
            background: 'white',
            transform: `translateX(${finalPoint ? 16 : 0}px)`,
            transition: 'transform .15s',
            boxShadow: '0 1px 2px rgba(0,0,0,.15)',
          }} />
        </button>
        <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.4 }}>
          <span style={{ fontWeight: 600 }}>
            <Icon name="flag" size={12} style={{ verticalAlign: -1, marginRight: 4, color: accentColor }} />
            {t('planner.final_point')}
          </span>
          <span className="muted" style={{ marginLeft: 6 }}>
            {t('planner.final_point_hint')}
          </span>
        </div>
      </div>
    )}
    </div>
  );
}

// ─── Step 1: Home ─────────────────────────────────────────────────────────────

function StepHome({ home, setHome, startDate, setStartDate, goNext }) {
  const t = useT();
  const [geoState, setGeoState] = useState('ask'); // ask | loading | allowed | denied
  const [nearbyCity, setNearbyCity] = useState(null); // detected city from GPS

  const requestGeo = () => {
    if (!navigator.geolocation) { setGeoState('denied'); return; }
    setGeoState('loading');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const city = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
        if (city) {
          const tz = await getTimezone(city.latitude, city.longitude);
          const full = { ...city, timezone: tz };
          setNearbyCity(full);
          setGeoState('allowed');
        } else {
          setGeoState('denied');
        }
      },
      () => setGeoState('denied'),
      { timeout: 8000 }
    );
  };

  return (
    <div>
      <h1 style={{ marginBottom: 10 }}>{t('planner.home_title')}</h1>
      <div className="muted" style={{ fontSize: 15, marginBottom: 22, maxWidth: 540 }}>
        {t('planner.home_desc')}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 200px)', gap: 14, alignItems: 'start' }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="field__label">{t('planner.start_city')}</label>
          <CityPicker value={home} onChange={setHome} placeholder={t('planner.start_city_ph')} autoFocus />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="field__label">{t('planner.departure_date')}</label>
          <div style={{ position: 'relative' }}>
            <Icon name="calendar" size={15}
              style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: startDate ? 'var(--brand)' : 'var(--muted-2)', pointerEvents: 'none' }} />
            <input
              className="input num"
              type="date"
              value={startDate || ''}
              onChange={e => setStartDate?.(e.target.value)}
              style={{ paddingLeft: 36, fontSize: 14, width: '100%' }}
            />
          </div>
        </div>
      </div>

      {/* "Рядом" section */}
      <div style={{ marginTop: 22, display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <span className="eyebrow" style={{ flex: 1 }}>{t('planner.nearby')}</span>
      </div>

      {geoState === 'ask' && (
        <div style={{ padding: 18, borderRadius: 12, border: '1.5px dashed var(--line)', background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 11, background: 'var(--brand-soft)', color: 'var(--brand)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Icon name="pin" size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 2 }}>{t('planner.suggest_nearby')}</div>
            <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.45 }}>{t('planner.geo_hint')}</div>
          </div>
          <Btn variant="primary" size="sm" onClick={requestGeo}>{t('planner.allow')}</Btn>
        </div>
      )}

      {geoState === 'loading' && (
        <div style={{ padding: 18, borderRadius: 12, border: '1.5px dashed var(--line)', background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 20, height: 20, border: '3px solid var(--brand)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>{t('planner.detecting')}</span>
        </div>
      )}

      {geoState === 'allowed' && nearbyCity && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
          <button onClick={() => setHome(nearbyCity)} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
            background: home?.city_name === nearbyCity.city_name ? 'var(--brand-soft)' : 'var(--surface)',
            border: '1.5px solid ' + (home?.city_name === nearbyCity.city_name ? 'var(--brand)' : 'var(--line)'),
            borderRadius: 11, cursor: 'pointer', textAlign: 'left', transition: 'all .15s',
          }}
            onMouseEnter={e => { if (home?.city_name !== nearbyCity.city_name) e.currentTarget.style.borderColor = '#dbe1ec'; }}
            onMouseLeave={e => { if (home?.city_name !== nearbyCity.city_name) e.currentTarget.style.borderColor = 'var(--line)'; }}
          >
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--brand-soft)', color: 'var(--brand)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Icon name="plane" size={14} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{nearbyCity.city_name}</div>
              <div className="muted" style={{ fontSize: 11.5 }}>{countryFlag(nearbyCity.country_code)} {nearbyCity.country} · {t('planner.your_city')}</div>
            </div>
            {home?.city_name === nearbyCity.city_name && (
              <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--brand)', color: 'white', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <Icon name="check" size={11} />
              </div>
            )}
          </button>
        </div>
      )}

      {geoState === 'denied' && (
        <div style={{ padding: 18, borderRadius: 12, background: 'var(--wash)', border: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 11, background: 'var(--warning-soft)', color: 'var(--warning)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Icon name="lock" size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 2 }}>{t('planner.geo_off')}</div>
            <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.45 }}>{t('planner.geo_off_hint')}</div>
          </div>
          <Btn variant="ghost" size="sm" onClick={() => setGeoState('ask')}>{t('planner.retry_request')}</Btn>
        </div>
      )}

      <FooterNav>
        <div style={{ flex: 1 }} />
        <Btn variant="primary" onClick={goNext} disabled={!home?.city_name || !startDate}>{t('planner.next')}</Btn>
      </FooterNav>
    </div>
  );
}

// ─── Step 2: Cities ───────────────────────────────────────────────────────────

function StepCities({ cities, setCities, home, finalPoint, setFinalPoint, startDate, setStartDate, goPrev, goNext, onReset }) {
  const t = useT();
  const [hasError, setHasError] = useState(false);
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null); // insertion index 0..len

  const addCity = (preset = null) => {
    const base = preset || { external_city_id: null, city_name: '', country: '', country_code: '', latitude: null, longitude: null, timezone: null };
    setCities(cs => recomputeDates([...cs, { id: Date.now(), ...base, startDate: cs[0]?.startDate || startDate || '', nights: preset?.nights || 3 }]));
  };

  const remove = (id) => setCities(cs => recomputeDates(cs.filter(c => c.id !== id)));

  // Cities are laid contiguously from the FIXED trip start (city N starts where
  // N-1 ends), so any nights / order change re-cascades - but the trip start
  // itself never moves (only the top date control changes it).
  const update = (id, patch) => setCities(cs => recomputeDates(cs.map(c => c.id === id ? { ...c, ...patch } : c)));

  const endDrag = () => { setDragIdx(null); setOverIdx(null); };
  // Reorder via splice (no DOM insertion during drag - that breaks native DnD).
  const dropAt = (insertIdx) => {
    setCities(cs => {
      if (dragIdx == null || insertIdx == null) return cs;
      const ns = [...cs];
      const [moved] = ns.splice(dragIdx, 1);
      let target = dragIdx < insertIdx ? insertIdx - 1 : insertIdx;
      target = Math.max(0, Math.min(ns.length, target));
      ns.splice(target, 0, moved);
      return recomputeDates(ns);
    });
    endDrag();
  };
  const moveBy = (i, delta) => setCities(cs => {
    const j = i + delta;
    if (j < 0 || j >= cs.length) return cs;
    const ns = [...cs];
    [ns[i], ns[j]] = [ns[j], ns[i]];
    return recomputeDates(ns);
  });

  const allValid = cities.length > 0 && cities.every(c => c.city_name && c.latitude != null);

  return (
    <div>
      <h1 style={{ marginBottom: 10 }}>{t('planner.step_cities')}</h1>
      <div className="muted" style={{ fontSize: 15, marginBottom: 18, maxWidth: 620 }}>
        {t('planner.cities_desc_1')} <b style={{ color: 'var(--ink)' }}>{t('planner.cities_desc_drag')}</b> {t('planner.cities_desc_2')}
      </div>

      {/* Trip-start control - the single date anchor for the whole trip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, marginBottom: 12 }}>
        <Icon name="calendar" size={15} style={{ color: 'var(--brand)' }} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>{t('planner.trip_start')}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
          <button type="button" title={t('planner.day_earlier')} onClick={() => startDate && setStartDate(addDays(startDate, -1))}
            style={{ width: 26, height: 26, borderRadius: 7, border: '1px solid var(--line)', background: 'var(--surface)', cursor: 'pointer', display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 15, fontWeight: 700, lineHeight: 1, paddingBottom: 2 }}>‹</button>
          <input className="input num" type="date" value={startDate || ''} onChange={(e) => setStartDate(e.target.value)} style={{ fontSize: 13, padding: '6px 8px', width: 150 }} />
          <button type="button" title={t('planner.day_later')} onClick={() => startDate && setStartDate(addDays(startDate, 1))}
            style={{ width: 26, height: 26, borderRadius: 7, border: '1px solid var(--line)', background: 'var(--surface)', cursor: 'pointer', display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 15, fontWeight: 700, lineHeight: 1, paddingBottom: 2 }}>›</button>
        </div>
      </div>

      <CityAnchorRow label={t('ai_plan.start')} city_name={home?.city_name} country={home?.country} kind="home" />

      {cities.length === 0 ? (
        <div style={{ marginTop: 12, padding: 28, border: '1.5px dashed var(--line)', borderRadius: 12, textAlign: 'center', color: 'var(--muted)' }}>
          <Icon name="pin" size={22} style={{ marginBottom: 8, opacity: 0.5 }} />
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>{t('planner.where_to')}</div>
          <div style={{ fontSize: 12.5, marginBottom: 14 }}>{t('planner.add_first_city')}</div>
          <Btn variant="primary" onClick={() => addCity()}>{t('planner.add_city')}</Btn>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); dropAt(overIdx); }}>
          {cities.map((c, i) => (
            <div
              key={c.id}
              onDragOver={(e) => { e.preventDefault(); if (dragIdx == null) return; const r = e.currentTarget.getBoundingClientRect(); setOverIdx((e.clientY - r.top) > r.height / 2 ? i + 1 : i); }}
              onDrop={(e) => { e.preventDefault(); e.stopPropagation(); dropAt(overIdx); }}
            >
              <CityRow
                idx={i}
                total={cities.length}
                city={c}
                isDragging={dragIdx === i}
                dropTop={dragIdx != null && dragIdx !== i && overIdx === i}
                dropBottom={dragIdx != null && overIdx === cities.length && i === cities.length - 1}
                isLast={i === cities.length - 1}
                finalPoint={finalPoint}
                onToggleFinalPoint={setFinalPoint}
                onDragStart={(e) => { setDragIdx(i); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(i)); } catch { /* ignore */ } }}
                onDragEnd={endDrag}
                onChange={(patch) => update(c.id, patch)}
                onRemove={() => remove(c.id)}
                onMoveUp={() => moveBy(i, -1)}
                onMoveDown={() => moveBy(i, 1)}
              />
            </div>
          ))}
          <button onClick={() => addCity()} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '12px 16px', background: 'transparent',
            border: '1.5px dashed var(--line)', borderRadius: 12, cursor: 'pointer',
            color: 'var(--muted)', fontSize: 13, fontWeight: 500,
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--brand)'; e.currentTarget.style.color = 'var(--brand)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.color = 'var(--muted)'; }}
          >
            <Icon name="plus" size={14} /> {t('planner.add_more_city')}
          </button>
        </div>
      )}

      {hasError && !allValid && (
        <div style={{ marginTop: 16, padding: '12px 14px', background: 'var(--warning-soft, #fff3cd)', border: '1px solid var(--warning, #e6a817)', borderRadius: 10, fontSize: 13, color: 'var(--ink)' }}>
          ⚠️ {cities.length === 0 ? t('planner.err_no_cities') : t('planner.err_unrecognized')}
        </div>
      )}

      <FooterNav>
        <Btn variant="ghost" onClick={goPrev}>{t('planner.back')}</Btn>
        <Btn variant="ghost" icon="refresh" onClick={onReset}>{t('planner.reset')}</Btn>
        <div style={{ flex: 1 }} />
        <Btn variant="primary" disabled={!allValid} onClick={() => { if (!allValid) { setHasError(true); return; } goNext(); }}>{t('planner.next')}</Btn>
      </FooterNav>
    </div>
  );
}

// ─── Step 3: Return ───────────────────────────────────────────────────────────

function StepReturn({ home, lastCityName, returnMode, setReturnMode, returnCity, setReturnCity, goPrev, goNext, onReset }) {
  const t = useT();
  return (
    <div>
      <h1 style={{ marginBottom: 10 }}>
        {t('planner.return_title_pre')} <span style={{ color: 'var(--brand)' }}>{lastCityName}</span>?
      </h1>
      <div className="muted" style={{ fontSize: 15, marginBottom: 22, maxWidth: 540 }}>
        {t('planner.return_desc')}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        <button onClick={() => setReturnMode('home')} style={{ padding: 16, textAlign: 'left', background: returnMode === 'home' ? 'var(--brand-soft)' : 'var(--surface)', border: '1.5px solid ' + (returnMode === 'home' ? 'var(--brand)' : 'var(--line)'), borderRadius: 12, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--brand)', color: 'white', display: 'grid', placeItems: 'center' }}>
              <Icon name="flag" size={16} />
            </div>
            <div style={{ fontWeight: 600 }}>{t('planner.return_home', { city: home?.city_name || '…' })}</div>
          </div>
          <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.4 }}>
            {t('planner.return_home_desc_1')} <b>{lastCityName}</b> {t('planner.return_home_desc_2')}
          </div>
        </button>

        <button onClick={() => setReturnMode('other')} style={{ padding: 16, textAlign: 'left', background: returnMode === 'other' ? 'var(--brand-soft)' : 'var(--surface)', border: '1.5px solid ' + (returnMode === 'other' ? 'var(--brand)' : 'var(--line)'), borderRadius: 12, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--warm, #e67e22)', color: 'white', display: 'grid', placeItems: 'center' }}>
              <Icon name="globe" size={16} />
            </div>
            <div style={{ fontWeight: 600 }}>{t('planner.return_other')}</div>
          </div>
          <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.4 }}>
            {t('planner.return_other_desc')}
          </div>
        </button>
      </div>

      {returnMode === 'other' && (
        <div className="field">
          <label className="field__label">{t('planner.return_city')}</label>
          <CityPicker
            value={returnCity}
            onChange={setReturnCity}
            placeholder={t('planner.return_city_ph')}
            autoFocus
          />
        </div>
      )}

      <div style={{ marginTop: 18, padding: '10px 14px', background: 'var(--wash)', border: '1px solid var(--line-2)', borderRadius: 10, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <Icon name="info" size={14} style={{ color: 'var(--muted)', marginTop: 2, flexShrink: 0 }} />
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
          {t('planner.return_info')}
        </div>
      </div>

      <FooterNav>
        <Btn variant="ghost" onClick={goPrev}>{t('planner.back')}</Btn>
        <Btn variant="ghost" icon="refresh" onClick={onReset}>{t('planner.reset')}</Btn>
        <div style={{ flex: 1 }} />
        <Btn variant="primary" onClick={goNext}>{t('planner.next')}</Btn>
      </FooterNav>
    </div>
  );
}

// ─── Step 5: Review ───────────────────────────────────────────────────────────

function ReviewRow({ num, name, sub, icon, iconColor, muted }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 0', position: 'relative', zIndex: 1 }}>
      <div style={{ width: 28, height: 28, borderRadius: '50%', background: icon ? (iconColor || 'var(--brand)') : 'var(--brand)', color: 'white', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0, border: '3px solid var(--surface)' }}>
        {icon ? <Icon name={icon} size={12} /> : num}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: muted ? 'var(--muted)' : 'var(--ink)' }}>{name || '-'}</div>
        <div className="muted" style={{ fontSize: 11.5, marginTop: 1 }}>{sub}</div>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 3, fontSize: 10 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600 }}>{value}</div>
      {hint && <div className="muted" style={{ fontSize: 11, marginTop: 1 }}>{hint}</div>}
    </div>
  );
}

function StepReview({ home, cities, returnCity, cover, setCover, tripTitle, setTripTitle, onStartDateChange, saving, savedOk, savedTripId, goPrev, onReset, onSave, error }) {
  const nav = useNavigate();
  const t = useT();
  const totalNights = cities.reduce((n, c) => n + (Number(c.nights) || 0), 0);
  const autoTitle = computeAutoTitle(home, cities, t);
  const displayTitle = tripTitle || autoTitle;

  const gradient = cover?.cover_gradient ? getGradientById(cover.cover_gradient) : null;
  const hasPhoto = !!cover?.cover_image_url;
  const hasGradient = !hasPhoto && !!gradient;
  const heroBg = hasGradient
    ? gradient.css
    : !hasPhoto
      ? 'linear-gradient(135deg, hsl(210, 60%, 55%) 0%, hsl(195, 55%, 50%) 40%, hsl(25, 65%, 60%) 100%)'
      : 'var(--wash)';

  if (savedOk) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px' }}>
        <div style={{ width: 72, height: 72, margin: '0 auto 18px', borderRadius: 18, background: 'var(--success-soft, #d4edda)', color: 'var(--success, #27ae60)', display: 'grid', placeItems: 'center' }}>
          <Icon name="check" size={36} />
        </div>
        <h1 style={{ marginBottom: 8 }}>{t('planner.created_title')}</h1>
        <div className="muted" style={{ fontSize: 15, maxWidth: 460, margin: '0 auto 22px' }}>
          {t('planner.created_desc', { title: displayTitle, cities: cities.length, citiesWord: cities.length === 1 ? t('trip.cities_count_one') : cities.length < 5 ? t('trip.cities_count_few') : t('trip.cities_count_many'), nights: totalNights, nightsWord: totalNights === 1 ? t('view.nights_one') : totalNights < 5 ? t('view.nights_few') : t('view.nights_many') })}
        </div>
        <div style={{ display: 'inline-flex', gap: 8 }}>
          <Btn variant="primary" onClick={() => savedTripId && nav(`/trip/${savedTripId}`)}>{t('planner.open_trip')}</Btn>
          <Btn variant="ghost" onClick={() => nav('/trips')}>{t('notif.to_collection')}</Btn>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ marginBottom: 10 }}>{t('planner.step_review')}</h1>
      <div className="muted" style={{ fontSize: 15, marginBottom: 22, maxWidth: 620 }}>
        {t('planner.review_desc')}
      </div>

      {/* Trip card preview */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ height: 120, background: heroBg, position: 'relative' }}>
          {hasPhoto && (
            <img src={cover.cover_image_url} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          )}
          {!hasPhoto && !hasGradient && (
            <svg viewBox="0 0 800 200" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.5 }}>
              <path d="M0 130 Q 200 80 400 110 T 800 95 L 800 200 L 0 200 Z" fill="rgba(255,255,255,.5)" />
              <path d="M0 160 Q 250 110 450 140 T 800 130 L 800 200 L 0 200 Z" fill="rgba(255,255,255,.3)" />
            </svg>
          )}
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 40%, rgba(0,0,0,.35) 100%)' }} />
          <div style={{ position: 'absolute', left: 20, bottom: 14, color: 'white', fontWeight: 700, fontSize: 26, letterSpacing: '-0.03em', textShadow: '0 2px 12px rgba(0,0,0,.3)' }}>
            {displayTitle}
          </div>
        </div>

        <div style={{ padding: 18 }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>{t('planner.route_points', { n: (home ? 1 : 0) + cities.length + (returnCity ? 1 : 0) })}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, position: 'relative' }}>
            <div style={{ position: 'absolute', left: 13, top: 14, bottom: 14, width: 2, background: 'var(--line-2)' }} />
            <ReviewRow icon="flag" iconColor="var(--brand)" name={home?.city_name} sub={`${home?.country || ''} · ${t('planner.sub_start')}`} muted />
            {cities.map((c, i) => (
              <ReviewRow key={c.id} num={i + 1} name={c.city_name} sub={`${c.country || '-'} · ${c.nights} ${c.nights == 1 ? t('view.nights_one') : c.nights < 5 ? t('view.nights_few') : t('view.nights_many')}${c.startDate ? ` · ${t('planner.from_date_prefix')} ${c.startDate}` : ''}`} />
            ))}
            {returnCity?.city_name && (
              <ReviewRow icon={returnCity.city_name === home?.city_name ? 'flag' : 'globe'} iconColor={returnCity.city_name === home?.city_name ? 'var(--brand)' : 'var(--warm, #e67e22)'} name={returnCity.city_name} sub={`${returnCity.country || ''} · ${t('planner.sub_return')}`} muted />
            )}
          </div>

          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line-2)', display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 3, fontSize: 10 }}>{t('event.start')}</div>
              <input
                className="input num"
                type="date"
                value={cities[0]?.startDate || ''}
                onChange={e => onStartDateChange && onStartDateChange(e.target.value)}
                disabled={saving}
                style={{ fontSize: 13, padding: '5px 8px', minWidth: 130 }}
              />
              {!cities[0]?.startDate && (
                <div style={{ fontSize: 10.5, color: 'var(--warning, #e6a817)', marginTop: 3 }}>{t('planner.date_required_hint')}</div>
              )}
            </div>
            <Stat label={t('planner.duration')} value={`${totalNights} ${t('ai_plan.unit_nights_short')}`} />
            <Stat label={t('planner.cities_stat')} value={cities.length} />
          </div>
        </div>
      </div>

      <div className="field">
        <label className="field__label">{t('planner.cover')}</label>
        <TripCoverPicker
          coverImageUrl={cover?.cover_image_url || ''}
          coverGradient={cover?.cover_gradient || ''}
          onChange={setCover}
        />
      </div>

      <div className="field">
        <label className="field__label">{t('planner.title_label')}</label>
        <input
          className="input"
          value={tripTitle}
          onChange={e => setTripTitle(e.target.value)}
          placeholder={autoTitle}
          disabled={saving}
        />
      </div>

      {error && (
        <div style={{ marginTop: 12, padding: '12px 14px', background: 'var(--danger-soft, #fde8e8)', border: '1px solid var(--danger, #e74c3c)', borderRadius: 10, fontSize: 13, color: 'var(--danger, #e74c3c)' }}>
          {error}
        </div>
      )}

      {saving && (
        <div style={{ marginTop: 14, padding: '12px 14px', background: 'var(--brand-soft)', border: '1px solid var(--brand-soft-12, rgba(59,91,219,.12))', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 16, height: 16, border: '2px solid var(--brand)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin .7s linear infinite', flexShrink: 0 }} />
          <div style={{ flex: 1, fontSize: 13, color: 'var(--ink-2)' }}>{t('planner.saving_msg')}</div>
        </div>
      )}

      <FooterNav>
        <Btn variant="ghost" onClick={goPrev} disabled={saving}>{t('planner.back')}</Btn>
        <Btn variant="ghost" icon="refresh" onClick={onReset} disabled={saving}>{t('planner.reset')}</Btn>
        <div style={{ flex: 1 }} />
        {saving ? (
          <Btn variant="primary" disabled>{t('planner.saving_btn')}</Btn>
        ) : (
          <Btn variant="primary" onClick={onSave}>{t('planner.save_trip')}</Btn>
        )}
      </FooterNav>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ManualPlanner({ initialMethod = 'manual' }) {
  const nav = useNavigate();
  const { user } = useAuth();
  const t = useT();
  const { lang } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();

  const isPro = isProActive(user);
  const { isDark, toggle: toggleTheme } = useTheme();

  // 'manual' | 'ai' - only the entry screen differs; from the skeleton onward
  // both methods share the same steps.
  const method = initialMethod;
  const isAi = method === 'ai';

  // ── Free-plan limit check ─────────────────────────────────────────────────
  const { data: allTrips = [], isLoading: checkingLimit } = useQuery({
    queryKey: ['trips-limit-check', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('trips').select('id').eq('created_by', user.id);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id && !isPro,
  });

  const { data: allVisits = [] } = useQuery({
    queryKey: ['visits-limit-check', allTrips.map(t => t.id).join(',')],
    queryFn: async () => {
      const ids = allTrips.map(t => t.id);
      if (ids.length === 0) return [];
      const { data, error } = await supabase.from('city_visits').select('*').in('trip_id', ids);
      if (error) throw error;
      return data || [];
    },
    enabled: !isPro && allTrips.length > 0,
  });

  const visitsByTrip = React.useMemo(() => {
    const m = {};
    allVisits.forEach(v => { (m[v.trip_id] ||= []).push(v); });
    return m;
  }, [allVisits]);

  const activeTrips = allTrips.filter(t => !isTripInPast(visitsByTrip[t.id] || []));
  const isOverLimit = !isPro && !checkingLimit && activeTrips.length >= 1;

  // ── Wizard state ─────────────────────────────────────────────────────────
  const [step, setStep]             = useState('home');
  const [home, setHome]             = useState(null);
  const [startDate, setStartDateRaw] = useState(defaultStartISO()); // YYYY-MM-DD, trip start; prefilled +1 month
  const [cities, setCities]         = useState([]);
  const [returnMode, setReturnMode] = useState('home');
  const [returnCity, setReturnCity] = useState(null);
  const [finalPoint, setFinalPoint] = useState(false); // last city is the finish - skip "return"
  const [tripTitle, setTripTitle]   = useState('');
  const [cover, setCover]           = useState({ cover_image_url: '', cover_gradient: 'gradient_1' });
  const [saving, setSaving]         = useState(false);
  const [savedOk, setSavedOk]       = useState(false);
  const [savedTripId, setSavedTripId] = useState(null);
  const [error, setError]           = useState(null);
  const [restored, setRestored]     = useState(false);

  // ── AI-entry state (only used when method === 'ai') ────────────────────────
  const [prompt, setPrompt]                 = useState('');
  const [aiState, setAiState]               = useState(isAi ? 'prompt' : 'draft'); // prompt | generating | draft
  const [aiComment, setAiComment]           = useState('');
  const [sessionId, setSessionId]           = useState(() => crypto.randomUUID());

  // Restore from sessionStorage on mount - only for the current user
  useEffect(() => {
    try {
      const key = storageKey(user?.id, method);
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.step) setStep(saved.step);
        if (saved.home) setHome(saved.home);
        if (saved.cities?.length) setCities(saved.cities);
        if (saved.returnMode) setReturnMode(saved.returnMode);
        if (saved.returnCity) setReturnCity(saved.returnCity);
        if (saved.tripTitle) setTripTitle(saved.tripTitle);
        if (saved.finalPoint) setFinalPoint(!!saved.finalPoint);
        if (saved.startDate) setStartDateRaw(saved.startDate);
        if (saved.cover) setCover(saved.cover);
        if (saved.aiState && isAi) setAiState(saved.aiState);
      }
    } catch {}
    setRestored(true);
  }, [user?.id]); // re-run if user changes (e.g. account switch in same tab)

  // Persist to sessionStorage on every change
  useEffect(() => {
    if (!restored) return;
    try {
      sessionStorage.setItem(storageKey(user?.id, method), JSON.stringify({ step, home, cities, returnMode, returnCity, tripTitle, finalPoint, startDate, cover, aiState }));
    } catch {}
  }, [step, home, cities, returnMode, returnCity, tripTitle, finalPoint, startDate, cover, aiState, restored, user?.id]);

  // setStartDate cascades to cities (first city anchors all subsequent dates).
  // Empty/invalid values are IGNORED - the trip start is required and can't be
  // cleared from any date control (step 1, step 2 or review).
  const setStartDate = (dateStr) => {
    if (!dateStr) return;
    setStartDateRaw(dateStr);
    setCities(cs => {
      if (cs.length === 0) return cs;
      const next = cs.map((c, i) => i === 0 ? { ...c, startDate: dateStr } : c);
      return recomputeDates(next);
    });
  };

  // ── AI draft → shared skeleton ─────────────────────────────────────────────
  // The AI returns a cities-only skeleton (no per-day activities). We convert it
  // into the manual-planner `cities` shape (resolving coords + timezone) and
  // then the user edits it like any manual trip. Dates are re-anchored to the
  // trip start via recomputeDates.
  const applyAiDraft = async (d) => {
    const dc = d?.cities || [];
    const resolved = await Promise.all(dc.map(async (c, i) => {
      let best = null;
      let tz = null;
      try {
        const r = await searchCities(`${c.city_name}${c.country ? ', ' + c.country : ''}`, lang || 'ru');
        best = r?.[0] || null;
      } catch { /* ignore */ }
      if (best?.latitude) { try { tz = await getTimezone(best.latitude, best.longitude); } catch { /* ignore */ } }
      const startDate = c.start_date || '';
      const nights = c.nights ?? c.n ?? (c.start_date && c.end_date ? daysBetweenISO(c.start_date, c.end_date) : 1);
      return {
        id: Date.now() + i,
        external_city_id: best?.external_city_id || null,
        city_name: c.city_name || '',
        country: c.country || best?.country || '',
        country_code: (c.country_code || best?.country_code || '').toUpperCase(),
        latitude: best?.latitude ?? null,
        longitude: best?.longitude ?? null,
        timezone: tz || best?.timezone || null,
        startDate,
        nights: Math.max(1, +nights || 1),
      };
    }));
    // Ensure a valid trip-start anchor even if the AI omitted dates.
    const anchor = (resolved[0]?.startDate) || defaultStartISO();
    if (resolved[0]) resolved[0].startDate = anchor;
    const newCities = recomputeDates(resolved);
    setCities(newCities);
    setStartDateRaw(anchor);
    if (d?.title) setTripTitle(d.title);
  };

  const planMut = useMutation({
    mutationFn: async ({ promptText }) => {
      const { data, error: fnErr } = await supabase.functions.invoke('planTripWithAi', {
        body: { sessionId, prompt: promptText, language: lang || 'ru' },
      });
      if (fnErr) throw fnErr;
      return data;
    },
    onMutate: () => { setAiState('generating'); setError(null); },
    onSuccess: async (data) => {
      const out = data?.output || {};
      setAiComment(out.ai_comment || '');
      await applyAiDraft(out.draft || {});
      setAiState('draft');
    },
    onError: (err) => {
      setAiState(cities.length ? 'draft' : 'prompt');
      toast({
        title: t('ai_plan.error_plan_title'),
        description: err?.message || t('ai_plan.error_plan_desc'),
        variant: 'destructive',
      });
    },
  });
  const onGenerate = (promptText) => { if (promptText) planMut.mutate({ promptText }); };

  // Visible steps - "Возврат" is skipped when the last city is the finish point.
  // The entry step's label depends on the method (origin vs AI prompt).
  const entryLabel = isAi ? t('planner.step_home_ai') : t('planner.step_home');
  const visibleSteps = (finalPoint ? STEPS.filter(s => s.id !== 'return') : STEPS)
    .map(s => ({ ...s, label: s.id === 'home' ? entryLabel : t(s.labelKey) }));
  const goNext = () => {
    const i = visibleSteps.findIndex(s => s.id === step);
    if (i >= 0 && i < visibleSteps.length - 1) setStep(visibleSteps[i + 1].id);
  };
  const goPrev = () => {
    const i = visibleSteps.findIndex(s => s.id === step);
    if (i > 0) setStep(visibleSteps[i - 1].id);
  };

  // If the active step becomes hidden (toggled finalPoint while on "return"),
  // fall back to the skeleton step.
  useEffect(() => {
    if (!visibleSteps.some(s => s.id === step)) setStep('cities');
  }, [finalPoint]);

  // Reset draft and go back to step 1
  const resetToStart = () => {
    setStep('home');
    setHome(null);
    setCities([]);
    setReturnMode('home');
    setReturnCity(null);
    setFinalPoint(false);
    setStartDateRaw(defaultStartISO());
    setTripTitle('');
    setCover({ cover_image_url: '', cover_gradient: 'gradient_1' });
    setSavedOk(false);
    setSavedTripId(null);
    setError(null);
    // AI-entry reset
    setPrompt('');
    setAiComment('');
    setAiState(isAi ? 'prompt' : 'draft');
    setSessionId(crypto.randomUUID());
    try { sessionStorage.removeItem(storageKey(user?.id, method)); } catch { /* ignore */ }
  };

  // When the user marked the last city as the finish, there's no separate
  // return city - the trip ends at the last transit city.
  const effectiveReturn = finalPoint ? null : (returnMode === 'home' ? home : returnCity);
  const autoTitle = computeAutoTitle(home, cities, t);

  // ── Supabase save ────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!user) return;

    const title = (tripTitle || autoTitle).trim();
    // Pre-flight validation
    if (cities.length === 0) {
      setError(t('planner.err_no_cities'));
      return;
    }
    if (!startDate || !cities[0]?.startDate) {
      setError(t('planner.err_no_date'));
      return;
    }
    if (!title) {
      setError(t('planner.err_no_title'));
      return;
    }

    setSaving(true);
    setError(null);

    try {
      // RLS requires created_by = auth.uid(). The profiles table may diverge
      // from the session, so always pull the id straight from the session.
      const { data: authUser, error: authErr } = await supabase.auth.getUser();
      if (authErr || !authUser?.user?.id) {
        throw new Error(t('planner.err_no_session'));
      }
      const authId = authUser.user.id;

      // 1. Create trip via SECURITY DEFINER RPC (bypasses RLS caching issues)
      const { data: tripId, error: tripErr } = await supabase
        .rpc('create_trip', { p_title: title, p_description: '' });
      if (tripErr) throw tripErr;
      const trip = { id: tripId };

      // 1b. Persist cover (gradient or uploaded image). The RPC doesn't accept
      // cover fields, so update the row immediately after creation.
      if (cover?.cover_gradient || cover?.cover_image_url) {
        const { error: coverErr } = await supabase
          .from('trips')
          .update({
            cover_image_url: cover.cover_image_url || null,
            cover_gradient: cover.cover_gradient || null,
          })
          .eq('id', trip.id);
        if (coverErr) console.error('Failed to set cover:', coverErr);
      }

      // 2. Build city_visits list with full data
      const visitsToInsert = [];

      // Home city → kind: 'start'
      if (home?.city_name) {
        visitsToInsert.push({
          trip_id: trip.id,
          external_city_id: home.external_city_id || null,
          city_name: home.city_name,
          country: home.country || null,
          country_code: home.country_code || null,
          latitude: home.latitude || null,
          longitude: home.longitude || null,
          timezone: home.timezone || null,
          kind: 'start',
          start_date: null,
          end_date: null,
          created_by: authId,
        });
      }

      // Transit cities → kind:'transit'. When finalPoint is on, the LAST
      // city is the trip's finish anchor → save as kind:'end' with NO
      // dates at all. start/end anchors are pure markers; trip dates are
      // derived from the first/last transit city's datetimes.
      cities.forEach((c, i) => {
        if (!c.city_name) return;
        const isFinalAnchor = finalPoint && i === cities.length - 1;
        visitsToInsert.push({
          trip_id: trip.id,
          external_city_id: c.external_city_id || null,
          city_name: c.city_name,
          country: c.country || null,
          country_code: c.country_code || null,
          latitude: c.latitude || null,
          longitude: c.longitude || null,
          timezone: c.timezone || null,
          kind: isFinalAnchor ? 'end' : 'transit',
          start_date: isFinalAnchor ? null : (c.startDate || null),
          end_date: isFinalAnchor ? null : (c.startDate && c.nights ? addDays(c.startDate, +c.nights) : null),
          created_by: authId,
        });
      });

      // Return city → kind: 'end'. Created even when returnMode === 'home'
      // (home equals return), so the cityN → end leg always exists in the
      // timeline and the "no transfer" warning / route shows up correctly.
      if (effectiveReturn?.city_name) {
        visitsToInsert.push({
          trip_id: trip.id,
          external_city_id: effectiveReturn.external_city_id || null,
          city_name: effectiveReturn.city_name,
          country: effectiveReturn.country || null,
          country_code: effectiveReturn.country_code || null,
          latitude: effectiveReturn.latitude || null,
          longitude: effectiveReturn.longitude || null,
          timezone: effectiveReturn.timezone || null,
          kind: 'end',
          created_by: authId,
        });
      }

      if (visitsToInsert.length > 0) {
        // position = array index: visitsToInsert is built in itinerary order, so
        // (start_datetime, position) reproduces it.
        const withPos = visitsToInsert.map((v, i) => ({ ...v, position: i }));
        const { error: visitErr } = await supabase.from('city_visits').insert(withPos).select('id');
        if (visitErr) throw visitErr;
      }

      // Transfers and activities are intentionally NOT created at trip-creation
      // time. The "Транспорт" step was removed; the timeline shows a "Нет
      // переезда" affordance. AI now returns a cities-only skeleton (no
      // activities) - both are added later in the trip view / Edit Mode.

      sessionStorage.removeItem(storageKey(user?.id, method));
      qc.invalidateQueries({ queryKey: ['trips'] });
      setSavedOk(true);
      setSavedTripId(trip.id);
    } catch (err) {
      console.error('Failed to save trip:', err);
      setError(err.message || t('planner.err_save_failed'));
    } finally {
      setSaving(false);
    }
  };

  // ── Limit guard ───────────────────────────────────────────────────────────
  if (!isPro && checkingLimit) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg, var(--wash))', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 32, height: 32, border: '3px solid var(--brand)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
      </div>
    );
  }

  if (isOverLimit) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg, var(--wash))' }}>
        <header className="app-header" style={{ position: 'sticky', top: 0, zIndex: 50 }}>
          <button className="app-header__crumb-back" onClick={() => nav('/trips')} title={t('notif.to_collection')}>
            <Icon name="back" size={14} />
          </button>
          <div className="app-header__brand" onClick={() => nav('/trips')} style={{ cursor: 'pointer' }}><img src="/triplanio-logo.svg" alt="Triplanio" style={{ width: 28, height: 28, borderRadius: 7, flexShrink: 0 }} /><span className="app-header__brand-name">Triplanio</span></div>
          <HeaderActions
            user={user}
            isPro={isPro}
            isDark={isDark}
            onToggleTheme={toggleTheme}
          />
        </header>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ maxWidth: 480, textAlign: 'center' }}>
            <div style={{ width: 64, height: 64, borderRadius: 16, background: 'var(--warning-soft, #fff3cd)', color: 'var(--warning, #e6a817)', display: 'grid', placeItems: 'center', margin: '0 auto 18px' }}>
              <Icon name="lock" size={28} />
            </div>
            <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 700 }}>{t('planner.limit_title')}</h2>
            <p style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 24 }}>
              {t('planner.limit_desc_pre')} <strong>{t('planner.limit_desc_strong')}</strong>{t('planner.limit_desc_post')}
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Btn variant="ghost" onClick={() => nav('/trips')}>{t('planner.to_trips')}</Btn>
              <Btn variant="primary" onClick={() => nav('/pro?hidePerTrip=1')}>{t('sub.go_pro')}</Btn>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--bg, var(--wash))' }}>
      {/* Header */}
      <header className="app-header" style={{ flexShrink: 0, zIndex: 50 }}>
        <button className="app-header__crumb-back" onClick={() => nav('/trips')} title={t('notif.to_collection')}>
          <Icon name="back" size={14} />
        </button>
        <div className="app-header__brand" onClick={() => nav('/trips')} style={{ cursor: 'pointer' }}>
          <img src="/triplanio-logo.svg" alt="Triplanio" style={{ width: 28, height: 28, borderRadius: 7, flexShrink: 0 }} />
          <span className="app-header__brand-name">Triplanio</span>
        </div>
        <div className="app-header__crumb">
          <span className="app-header__crumb-sep">/</span>
          <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink-2)' }}>{isAi ? t('planner.step_home_ai') : t('trips.new')}</span>
        </div>
        <HeaderActions
          user={user}
          isPro={isPro}
          isDark={isDark}
          onToggleTheme={toggleTheme}
        />
      </header>

      {/* Slim top bar: progress glued under the header */}
      <div className="flow-top">
        <div className="flow-progress-wrap">
          <FlowProgress
            steps={visibleSteps}
            current={Math.max(0, visibleSteps.findIndex(s => s.id === step))}
            accent="var(--brand)"
            onJump={(i) => setStep(visibleSteps[i].id)}
          />
        </div>
      </div>

      {/* Two-pane shell: big full-bleed map + scrollable editing column */}
      <div className="flow-shell">
        <div className="flow-shell__map">
          <FlowMap
            home={home}
            cities={cities}
            returnCity={effectiveReturn}
            finalPoint={finalPoint}
            accent={isAi ? 'var(--ai)' : '#5b6cff'}
            badge={isAi
              ? { label: t('planner.badge_ai'), icon: 'sparkles', color: 'var(--ai)' }
              : { label: t('planner.badge_mine'), icon: 'map', color: 'var(--brand)' }}
          />
        </div>

        <div className="flow-edit scrollbar-thin">
          {step === 'home' && (isAi ? (
            <PanelAi ctx={{ aiState, prompt, setPrompt, aiComment, cities, onGenerate, goNext }} />
          ) : (
            <StepHome home={home} setHome={setHome} startDate={startDate} setStartDate={setStartDate} goNext={goNext} />
          ))}
          {step === 'cities' && (
            <StepCities cities={cities} setCities={setCities} home={home} startDate={startDate} setStartDate={setStartDate} finalPoint={finalPoint} setFinalPoint={setFinalPoint} goPrev={goPrev} goNext={goNext} onReset={resetToStart} />
          )}
          {step === 'return' && (
            <StepReturn
              home={home}
              lastCityName={cities[cities.length - 1]?.city_name || t('planner.last_city_fallback')}
              returnMode={returnMode}
              setReturnMode={setReturnMode}
              returnCity={returnCity}
              setReturnCity={setReturnCity}
              goPrev={goPrev}
              goNext={goNext}
              onReset={resetToStart}
            />
          )}
          {step === 'review' && (
            <StepReview
              home={home}
              cities={cities}
              returnCity={effectiveReturn}
              cover={cover}
              setCover={setCover}
              tripTitle={tripTitle}
              setTripTitle={setTripTitle}
              onStartDateChange={setStartDate}
              saving={saving}
              savedOk={savedOk}
              savedTripId={savedTripId}
              goPrev={goPrev}
              onReset={resetToStart}
              onSave={handleSave}
              error={error}
            />
          )}
        </div>
      </div>
    </div>
  );
}
