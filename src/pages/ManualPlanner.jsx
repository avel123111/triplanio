import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { isTripInPast } from '@/lib/trip-dates';
import { Icon } from '../design/icons';
import { Btn } from '../design/index';
import '../design/app.css';

// ─── Static data ─────────────────────────────────────────────────────────────

const POPULAR_DEST = [
  { city: 'Лиссабон', country: '🇵🇹 Португалия', nights: 4, lat: 38.72, lng: -9.14 },
  { city: 'Порту',    country: '🇵🇹 Португалия', nights: 3, lat: 41.15, lng: -8.61 },
  { city: 'Барселона',country: '🇪🇸 Испания',    nights: 4, lat: 41.39, lng: 2.17  },
  { city: 'Мадрид',   country: '🇪🇸 Испания',    nights: 3, lat: 40.42, lng: -3.70 },
  { city: 'Рим',      country: '🇮🇹 Италия',     nights: 4, lat: 41.90, lng: 12.49 },
  { city: 'Афины',    country: '🇬🇷 Греция',     nights: 3, lat: 37.98, lng: 23.72 },
  { city: 'Прага',    country: '🇨🇿 Чехия',      nights: 3, lat: 50.08, lng: 14.44 },
  { city: 'Берлин',   country: '🇩🇪 Германия',   nights: 3, lat: 52.52, lng: 13.40 },
];

const CITY_COORDS = {
  'Москва': { lat: 55.75, lng: 37.62 },
  'Санкт-Петербург': { lat: 59.94, lng: 30.31 },
  'Тбилиси': { lat: 41.71, lng: 44.79 },
  'Стамбул': { lat: 41.01, lng: 28.98 },
  'Дубай': { lat: 25.20, lng: 55.27 },
  'Минск': { lat: 53.90, lng: 27.55 },
  'Хельсинки': { lat: 60.17, lng: 24.94 },
  'Лиссабон': { lat: 38.72, lng: -9.14 },
  'Порту': { lat: 41.15, lng: -8.61 },
  'Барселона': { lat: 41.39, lng: 2.17 },
  'Мадрид': { lat: 40.42, lng: -3.70 },
  'Рим': { lat: 41.90, lng: 12.49 },
  'Афины': { lat: 37.98, lng: 23.72 },
  'Прага': { lat: 50.08, lng: 14.44 },
  'Берлин': { lat: 52.52, lng: 13.40 },
};

const STEPS = [
  { id: 'home',   num: 1, label: 'Откуда' },
  { id: 'cities', num: 2, label: 'Скелет трипа' },
  { id: 'return', num: 3, label: 'Возврат' },
  { id: 'review', num: 4, label: 'Финальный драфт' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function recomputeDates(list) {
  if (list.length === 0) return list;
  const first = list[0].startDate || new Date().toISOString().slice(0, 10);
  let cursor = new Date(first + 'T00:00:00');
  return list.map((c) => {
    const d = new Date(cursor);
    cursor.setDate(cursor.getDate() + (+c.nights || 0));
    return { ...c, startDate: d.toISOString().slice(0, 10) };
  });
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ─── Stepper ──────────────────────────────────────────────────────────────────

function Stepper({ currentId, onJump }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
      {STEPS.map((s, i) => {
        const isCurrent = s.id === currentId;
        const isPast = STEPS.findIndex(x => x.id === currentId) > i;
        return (
          <React.Fragment key={s.id}>
            <button
              onClick={() => isPast && onJump(s.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '4px 10px',
                background: isCurrent ? 'var(--brand-soft)' : 'transparent',
                border: 'none', borderRadius: 999,
                cursor: isPast ? 'pointer' : 'default',
              }}
            >
              <div style={{
                width: 22, height: 22, borderRadius: '50%',
                background: isCurrent ? 'var(--brand)' : isPast ? 'var(--success)' : 'var(--wash)',
                color: isCurrent || isPast ? 'white' : 'var(--muted-2)',
                display: 'grid', placeItems: 'center',
                fontSize: 11, fontWeight: 700, flexShrink: 0,
                border: isPast || isCurrent ? 'none' : '1px solid var(--line)',
              }}>
                {isPast ? <Icon name="check" size={11} /> : s.num}
              </div>
              <span style={{
                fontSize: 12.5,
                fontWeight: isCurrent ? 600 : 500,
                color: isCurrent ? 'var(--brand)' : 'var(--muted)',
                whiteSpace: 'nowrap',
              }}>
                {s.label}
              </span>
            </button>
            {i < STEPS.length - 1 && (
              <div style={{ width: 16, height: 2, background: isPast ? 'var(--success)' : 'var(--line)', margin: '0 2px' }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── Live map (SVG) ───────────────────────────────────────────────────────────

function PlannerMap({ home, cities, returnCity, highlight }) {
  const all = [];
  if (home?.lat) all.push({ key: 'home', name: home.city, kind: 'home', lat: home.lat, lng: home.lng });
  cities.forEach((c, i) => {
    const coords = c.lat ? { lat: c.lat, lng: c.lng } : CITY_COORDS[c.city];
    if (coords) all.push({ key: 'c' + i, name: c.city, kind: 'city', num: i + 1, lat: coords.lat, lng: coords.lng, nights: c.nights });
  });
  if (returnCity?.lat && returnCity.city !== home?.city) {
    all.push({ key: 'ret', name: returnCity.city, kind: 'return', lat: returnCity.lat, lng: returnCity.lng });
  }

  const proj = (lat, lng) => {
    const lngMin = -15, lngMax = 60, latMin = 25, latMax = 65;
    const x = 4 + ((lng - lngMin) / (lngMax - lngMin)) * 92;
    const y = 8 + (1 - (lat - latMin) / (latMax - latMin)) * 64;
    return { x: Math.max(2, Math.min(98, x)), y: Math.max(4, Math.min(76, y)) };
  };

  const points = all.map(p => ({ ...p, ...proj(p.lat, p.lng) }));
  const routePts = points.filter(p => p.kind === 'home' || p.kind === 'city' || p.kind === 'return');
  const pathD = routePts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');
  const cityCount = points.filter(p => p.kind === 'city').length;

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icon name="map" size={14} style={{ color: 'var(--brand)' }} />
        <div style={{ fontSize: 12.5, fontWeight: 600, flex: 1 }}>Маршрут · предпросмотр</div>
        {cityCount > 0 && (
          <span style={{ color: 'var(--muted)', fontSize: 11 }}>{cityCount} {cityCount < 5 ? 'города' : 'городов'}</span>
        )}
      </div>

      <div style={{ background: '#dceaf5', height: 300, position: 'relative' }}>
        <svg viewBox="0 0 100 80" preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
          <defs>
            <pattern id="dots-pl" width="2" height="2" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r=".15" fill="#bcd4e8" />
            </pattern>
          </defs>
          <rect width="100" height="80" fill="#dceaf5" />
          <rect width="100" height="80" fill="url(#dots-pl)" />
          {/* Europe landmass */}
          <path d="M3 24 Q 10 14 20 18 L 32 12 Q 45 8 60 14 Q 75 12 88 18 L 96 26 Q 94 38 84 42 L 70 44 Q 60 50 52 54 L 36 60 Q 22 60 14 52 L 6 42 Q 2 32 3 24 Z" fill="#f6f3ed" stroke="#dcd3c2" strokeWidth=".3" />
          {/* Iberia */}
          <path d="M4 38 Q 5 44 8 50 L 14 56 Q 20 58 22 52 L 23 46 Q 22 40 18 38 L 10 38 Z" fill="#ece5d4" stroke="#c9bd9f" strokeWidth=".4" />
          {/* Italy */}
          <path d="M46 38 Q 48 44 50 52 L 52 60 Q 53 64 51 65 L 49 60 L 47 52 Z" fill="#ece5d4" stroke="#c9bd9f" strokeWidth=".4" />

          {routePts.length >= 2 && (
            <path d={pathD} stroke="var(--brand)" strokeWidth=".5" fill="none" strokeDasharray="1.5 1" opacity=".75" />
          )}

          {points.map(p => {
            const isHome = p.kind === 'home';
            const isReturn = p.kind === 'return';
            const isActive =
              (highlight === 'home' && isHome) ||
              (highlight === 'return' && isReturn) ||
              (highlight === 'cities' && p.kind === 'city') ||
              highlight === 'all';
            const color = isReturn ? 'var(--warm)' : 'var(--brand)';
            return (
              <g key={p.key}>
                {isActive && <circle cx={p.x} cy={p.y} r="3.5" fill={color} opacity=".25" />}
                <circle cx={p.x} cy={p.y} r={isHome || isReturn ? 2 : 1.8} fill={color} />
                {(isHome || isReturn) && (
                  <text x={p.x + 3} y={p.y + 1.2} fontSize="2.4" fontWeight="700" fill="var(--ink)">
                    {isHome ? '🏠 ' : '↩ '}{p.name}
                  </text>
                )}
                {p.kind === 'city' && (
                  <>
                    <text x={p.x} y={p.y + .8} fontSize="1.8" fontWeight="700" fill="white" textAnchor="middle">{p.num}</text>
                    <text x={p.x + 2.5} y={p.y + 1.2} fontSize="2.2" fontWeight="600" fill="var(--ink)">{p.name}</text>
                  </>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--line-2)', background: 'var(--wash)', fontSize: 11.5, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--brand)' }} /> Дом
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--brand)' }} /> Города
        </span>
        {returnCity?.city && returnCity.city !== home?.city && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--warm)' }} /> Возврат
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {cities.reduce((n, c) => n + (+c.nights || 0), 0)} ночей
        </span>
      </div>
    </div>
  );
}

// ─── Footer nav ───────────────────────────────────────────────────────────────

function FooterNav({ children }) {
  return (
    <div style={{ marginTop: 28, paddingTop: 18, borderTop: '1px solid var(--line-2)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {children}
    </div>
  );
}

// ─── Step 1: Home ─────────────────────────────────────────────────────────────

function StepHome({ home, setHome, goNext }) {
  const [query, setQuery] = useState(home.city || '');

  const handleQueryChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    const coords = CITY_COORDS[val];
    setHome({ city: val, country: '', ...(coords || {}) });
  };

  return (
    <div>
      <h1 style={{ marginBottom: 10, letterSpacing: '-0.025em' }}>Откуда вы вылетаете?</h1>
      <div style={{ fontSize: 15, color: 'var(--muted)', marginBottom: 22, maxWidth: 540 }}>
        Это твой дом — точка старта и (обычно) возврата. Из него Triplanio покажет переезды и стоимость билетов.
      </div>

      <div className="field" style={{ marginBottom: 22 }}>
        <label className="field__label">Город старта</label>
        <div style={{ position: 'relative' }}>
          <Icon name="pin" size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted-2)' }} />
          <input
            className="input"
            value={query}
            onChange={handleQueryChange}
            placeholder="Москва, Тбилиси, Стамбул…"
            style={{ paddingLeft: 36, fontSize: 15 }}
            autoFocus
          />
        </div>
      </div>

      <div className="eyebrow" style={{ marginBottom: 10 }}>Популярные города вылета</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
        {[
          { city: 'Москва', country: '🇷🇺 Россия', airport: 'SVO', lat: 55.75, lng: 37.62 },
          { city: 'Санкт-Петербург', country: '🇷🇺 Россия', airport: 'LED', lat: 59.94, lng: 30.31 },
          { city: 'Тбилиси', country: '🇬🇪 Грузия', airport: 'TBS', lat: 41.71, lng: 44.79 },
          { city: 'Стамбул', country: '🇹🇷 Турция', airport: 'IST', lat: 41.01, lng: 28.98 },
          { city: 'Дубай', country: '🇦🇪 ОАЭ', airport: 'DXB', lat: 25.20, lng: 55.27 },
          { city: 'Хельсинки', country: '🇫🇮 Финляндия', airport: 'HEL', lat: 60.17, lng: 24.94 },
        ].map((p) => (
          <button
            key={p.city}
            onClick={() => { setHome(p); setQuery(p.city); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '12px 14px',
              background: home.city === p.city ? 'var(--brand-soft)' : 'var(--surface)',
              border: '1.5px solid ' + (home.city === p.city ? 'var(--brand)' : 'var(--line)'),
              borderRadius: 11, cursor: 'pointer', textAlign: 'left',
              transition: 'all .15s ease',
            }}
            onMouseEnter={(e) => { if (home.city !== p.city) e.currentTarget.style.borderColor = '#dbe1ec'; }}
            onMouseLeave={(e) => { if (home.city !== p.city) e.currentTarget.style.borderColor = 'var(--line)'; }}
          >
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--brand-soft)', color: 'var(--brand)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Icon name="plane" size={14} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{p.city}</div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{p.airport} · {p.country}</div>
            </div>
            {home.city === p.city && (
              <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--brand)', color: 'white', display: 'grid', placeItems: 'center' }}>
                <Icon name="check" size={11} />
              </div>
            )}
          </button>
        ))}
      </div>

      <FooterNav>
        <div style={{ flex: 1 }} />
        <Btn variant="primary" icon="arrowR" onClick={goNext} disabled={!home.city}>Дальше</Btn>
      </FooterNav>
    </div>
  );
}

// ─── CityRow ──────────────────────────────────────────────────────────────────

function CityRow({ idx, total, city, isDragging, isOver, onDragStart, onDragOver, onDrop, onDragEnd, onChange, onRemove, onMoveUp, onMoveDown }) {
  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto auto 1fr 150px 80px auto',
        alignItems: 'center', gap: 10,
        padding: '10px 12px',
        background: isOver ? 'var(--brand-soft)' : 'var(--surface)',
        border: '1px solid ' + (isOver ? 'var(--brand)' : 'var(--line)'),
        borderRadius: 12,
        opacity: isDragging ? 0.5 : 1,
        transition: 'background .15s, border-color .15s, opacity .15s',
      }}
    >
      {/* Drag handle */}
      <div
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        title="Перетащить"
        style={{ width: 22, height: 22, borderRadius: 5, display: 'grid', placeItems: 'center', color: 'var(--muted-2)', cursor: 'grab' }}
      >
        <Icon name="drag" size={14} />
      </div>

      <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--brand)', color: 'white', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
        {idx + 1}
      </div>

      <input
        className="input"
        placeholder="Город"
        value={city.city}
        onChange={(e) => onChange({ city: e.target.value })}
        style={{ fontSize: 13.5, fontWeight: 600 }}
      />

      <input
        className="input"
        type="date"
        value={city.startDate || ''}
        onChange={(e) => onChange({ startDate: e.target.value })}
        style={{ fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <input
          className="input"
          type="number" min={1} max={60}
          value={city.nights}
          onChange={(e) => onChange({ nights: Math.max(1, +e.target.value || 1) })}
          style={{ width: 50, padding: '8px 10px', fontSize: 12.5, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}
        />
        <span style={{ color: 'var(--muted)', fontSize: 11 }}>ноч</span>
      </div>

      <div style={{ display: 'flex', gap: 2 }}>
        <button onClick={onMoveUp} disabled={idx === 0} title="Выше" style={{ width: 26, height: 26, borderRadius: 6, border: 'none', background: 'transparent', cursor: idx === 0 ? 'default' : 'pointer', opacity: idx === 0 ? 0.35 : 1, display: 'grid', placeItems: 'center', color: 'var(--muted)' }}>
          <Icon name="chevD" size={12} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <button onClick={onMoveDown} disabled={idx === total - 1} title="Ниже" style={{ width: 26, height: 26, borderRadius: 6, border: 'none', background: 'transparent', cursor: idx === total - 1 ? 'default' : 'pointer', opacity: idx === total - 1 ? 0.35 : 1, display: 'grid', placeItems: 'center', color: 'var(--muted)' }}>
          <Icon name="chevD" size={12} />
        </button>
        <Btn variant="quiet" size="sm" icon="trash" onClick={onRemove} title="Удалить" />
      </div>
    </div>
  );
}

// ─── Step 2: Cities ───────────────────────────────────────────────────────────

function StepCities({ cities, setCities, home, goPrev, goNext }) {
  const [hasError, setHasError] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);

  const addCity = () => {
    const lastDate = cities[cities.length - 1];
    const newDate = lastDate
      ? addDays(lastDate.startDate, lastDate.nights || 0)
      : new Date().toISOString().slice(0, 10);
    setCities(cs => [...cs, { id: Date.now(), city: '', country: '', startDate: newDate, nights: 3 }]);
  };

  const remove = (id) => setCities(cs => recomputeDates(cs.filter(c => c.id !== id)));
  const update = (id, patch) => setCities(cs => {
    const next = cs.map(c => c.id === id ? { ...c, ...patch } : c);
    if ('nights' in patch || ('startDate' in patch && cs[0]?.id === id)) return recomputeDates(next);
    return next;
  });

  const onDragStart = (id) => (e) => { setDragId(id); e.dataTransfer.effectAllowed = 'move'; };
  const onDragOver  = (id) => (e) => { e.preventDefault(); if (overId !== id) setOverId(id); };
  const onDrop      = (id) => (e) => {
    e.preventDefault();
    if (dragId == null || dragId === id) { setDragId(null); setOverId(null); return; }
    setCities(cs => {
      const fi = cs.findIndex(c => c.id === dragId);
      const ti = cs.findIndex(c => c.id === id);
      if (fi < 0 || ti < 0) return cs;
      const ns = [...cs];
      const [moved] = ns.splice(fi, 1);
      ns.splice(ti, 0, moved);
      return recomputeDates(ns);
    });
    setDragId(null); setOverId(null);
  };
  const onDragEnd = () => { setDragId(null); setOverId(null); };

  const totalNights = cities.reduce((n, c) => n + (+c.nights || 0), 0);

  return (
    <div>
      <h1 style={{ marginBottom: 10, letterSpacing: '-0.025em' }}>Скелет трипа</h1>
      <div style={{ fontSize: 15, color: 'var(--muted)', marginBottom: 22, maxWidth: 620 }}>
        Перечисли города в порядке поездки. <strong style={{ color: 'var(--ink-2)' }}>Перетащи</strong> карточку за ручку слева — даты пересчитаются автоматически.
      </div>

      {/* Home anchor */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'var(--wash)', border: '1px solid var(--line-2)', borderRadius: 12 }}>
        <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--brand)', color: 'white', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <Icon name="flag" size={14} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 2 }}>Старт</div>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{home.city} <span style={{ fontWeight: 500, color: 'var(--muted)', marginLeft: 6 }}>{home.country}</span></div>
        </div>
      </div>

      {cities.length === 0 ? (
        <div style={{ marginTop: 12, padding: 28, border: '1.5px dashed var(--line)', borderRadius: 12, textAlign: 'center', color: 'var(--muted)' }}>
          <Icon name="pin" size={22} style={{ marginBottom: 8 }} />
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Куда поедем?</div>
          <div style={{ fontSize: 12.5, marginBottom: 14 }}>Добавь первый город маршрута.</div>
          <Btn variant="primary" icon="plus" onClick={addCity}>Добавить город</Btn>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
          {cities.map((c, i) => (
            <CityRow
              key={c.id}
              idx={i}
              total={cities.length}
              city={c}
              isDragging={dragId === c.id}
              isOver={overId === c.id && dragId !== c.id}
              onDragStart={onDragStart(c.id)}
              onDragOver={onDragOver(c.id)}
              onDrop={onDrop(c.id)}
              onDragEnd={onDragEnd}
              onChange={(patch) => update(c.id, patch)}
              onRemove={() => remove(c.id)}
              onMoveUp={() => setCities(cs => { const ns = [...cs]; if (i === 0) return cs; [ns[i-1], ns[i]] = [ns[i], ns[i-1]]; return recomputeDates(ns); })}
              onMoveDown={() => setCities(cs => { const ns = [...cs]; if (i === cs.length-1) return cs; [ns[i], ns[i+1]] = [ns[i+1], ns[i]]; return recomputeDates(ns); })}
            />
          ))}
          <button
            onClick={addCity}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 16px', background: 'transparent', border: '1.5px dashed var(--line)', borderRadius: 12, cursor: 'pointer', color: 'var(--muted)', fontSize: 13, fontWeight: 500 }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--brand)'; e.currentTarget.style.color = 'var(--brand)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.color = 'var(--muted)'; }}
          >
            <Icon name="plus" size={14} />
            Добавить ещё город
          </button>
        </div>
      )}

      {/* Quick-add popular */}
      {POPULAR_DEST.filter(p => !cities.find(c => c.city === p.city)).slice(0, 6).length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)', marginTop: 22, marginBottom: 10 }}>
            Популярные направления
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {POPULAR_DEST.filter(p => !cities.find(c => c.city === p.city)).slice(0, 6).map(p => (
              <button
                key={p.city}
                onClick={() => {
                  const lastCity = cities[cities.length - 1];
                  const newDate = lastCity ? addDays(lastCity.startDate, lastCity.nights || 0) : new Date().toISOString().slice(0, 10);
                  setCities(cs => [...cs, { id: Date.now(), ...p, startDate: newDate }]);
                }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 999, cursor: 'pointer', fontSize: 12.5 }}
              >
                <Icon name="plus" size={11} style={{ color: 'var(--brand)' }} />
                {p.city}
              </button>
            ))}
          </div>
        </>
      )}

      {hasError && (
        <div style={{ marginTop: 16, padding: '12px 14px', background: 'var(--warning-soft)', border: '1px solid var(--warning)', borderRadius: 10, display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13 }}>
          <Icon name="warning" size={15} style={{ color: 'var(--warning)', marginTop: 1, flexShrink: 0 }} />
          <span>Добавь хотя бы один город маршрута.</span>
        </div>
      )}

      {cities.length > 0 && (
        <div style={{ marginTop: 22, padding: '12px 16px', background: 'var(--brand-soft)', border: '1px solid var(--brand-soft-12)', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <Icon name="calendar" size={16} style={{ color: 'var(--brand)' }} />
          <div style={{ flex: 1, fontSize: 13, color: 'var(--ink-2)' }}>
            <strong>{cities.length}</strong> {cities.length < 5 ? 'города' : 'городов'} · <span style={{ fontVariantNumeric: 'tabular-nums' }}>{totalNights}</span> ночей в дороге
          </div>
          {cities[0]?.startDate && (
            <span style={{ fontSize: 12.5, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
              {cities[0].startDate} → +{totalNights}д
            </span>
          )}
        </div>
      )}

      <FooterNav>
        <Btn variant="ghost" icon="back" onClick={goPrev}>Назад</Btn>
        <div style={{ flex: 1 }} />
        <Btn variant="primary" icon="arrowR" onClick={() => { if (cities.length === 0) { setHasError(true); return; } goNext(); }}>Дальше</Btn>
      </FooterNav>
    </div>
  );
}

// ─── Step 3: Return ───────────────────────────────────────────────────────────

function StepReturn({ home, lastCity, returnMode, setReturnMode, returnCity, setReturnCity, goPrev, goNext }) {
  return (
    <div>
      <h1 style={{ marginBottom: 10, letterSpacing: '-0.025em' }}>
        Куда возвращаетесь после{' '}
        <span style={{ color: 'var(--brand)' }}>{lastCity}</span>?
      </h1>
      <div style={{ fontSize: 15, color: 'var(--muted)', marginBottom: 22, maxWidth: 540 }}>
        Чаще всего домой — но иногда удобнее остаться в последнем городе или вылететь в другую точку.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        <button
          onClick={() => setReturnMode('home')}
          style={{ padding: 16, textAlign: 'left', background: returnMode === 'home' ? 'var(--brand-soft)' : 'var(--surface)', border: '1.5px solid ' + (returnMode === 'home' ? 'var(--brand)' : 'var(--line)'), borderRadius: 12, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--brand)', color: 'white', display: 'grid', placeItems: 'center' }}>
              <Icon name="flag" size={16} />
            </div>
            <div style={{ fontWeight: 600 }}>Домой — в {home.city}</div>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.4 }}>
            Обычный возврат. Triplanio добавит обратный переезд от <strong>{lastCity}</strong> в трип.
          </div>
        </button>

        <button
          onClick={() => setReturnMode('other')}
          style={{ padding: 16, textAlign: 'left', background: returnMode === 'other' ? 'var(--brand-soft)' : 'var(--surface)', border: '1.5px solid ' + (returnMode === 'other' ? 'var(--brand)' : 'var(--line)'), borderRadius: 12, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--warm)', color: 'white', display: 'grid', placeItems: 'center' }}>
              <Icon name="globe" size={16} />
            </div>
            <div style={{ fontWeight: 600 }}>В другой город</div>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.4 }}>
            Например, если едешь дальше или летишь в командировку.
          </div>
        </button>
      </div>

      {returnMode === 'other' && (
        <div className="field">
          <label className="field__label">Город возврата</label>
          <div style={{ position: 'relative' }}>
            <Icon name="pin" size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted-2)' }} />
            <input
              className="input"
              placeholder="Куда летишь после трипа?"
              value={returnCity.city}
              onChange={(e) => {
                const coords = CITY_COORDS[e.target.value] || {};
                setReturnCity({ city: e.target.value, country: '', ...coords });
              }}
              style={{ paddingLeft: 36 }}
              autoFocus
            />
          </div>
        </div>
      )}

      <div style={{ marginTop: 18, padding: '10px 14px', background: 'var(--wash)', border: '1px solid var(--line-2)', borderRadius: 10, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <Icon name="info" size={14} style={{ color: 'var(--muted)', marginTop: 2, flexShrink: 0 }} />
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
          Можно оставить пустым и добавить обратный переезд позже из таймлайна.
        </div>
      </div>

      <FooterNav>
        <Btn variant="ghost" icon="back" onClick={goPrev}>Назад</Btn>
        <div style={{ flex: 1 }} />
        <Btn variant="primary" icon="arrowR" onClick={goNext}>Дальше</Btn>
      </FooterNav>
    </div>
  );
}

// ─── Step 4: Review ───────────────────────────────────────────────────────────

function ReviewRow({ num, name, sub, icon, iconColor, muted }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 0', position: 'relative', zIndex: 1 }}>
      <div style={{ width: 28, height: 28, borderRadius: '50%', background: icon ? iconColor : 'var(--brand)', color: 'white', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0, border: '3px solid var(--surface)' }}>
        {icon ? <Icon name={icon} size={12} /> : num}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: muted ? 'var(--muted)' : 'var(--ink)' }}>{name}</div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 1 }}>{sub}</div>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600 }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{hint}</div>}
    </div>
  );
}

function StepReview({ home, cities, returnCity, tripTitle, setTripTitle, saving, savedOk, goPrev, onSave, error }) {
  const totalNights = cities.reduce((n, c) => n + (+c.nights || 0), 0);
  const allCities = [home.city, ...cities.map(c => c.city), returnCity.city];
  const startDate = cities[0]?.startDate || '—';
  const autoTitle = cities.length === 1 ? cities[0].city : `${cities[0]?.city} → ${cities[cities.length - 1]?.city}`;

  if (savedOk) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px' }}>
        <div style={{ width: 72, height: 72, margin: '0 auto 18px', borderRadius: 18, background: 'var(--success-soft)', color: 'var(--success)', display: 'grid', placeItems: 'center' }}>
          <Icon name="check" size={36} />
        </div>
        <h1 style={{ marginBottom: 8 }}>Трип создан</h1>
        <div style={{ fontSize: 15, color: 'var(--muted)', marginBottom: 22, maxWidth: 460, margin: '0 auto 22px' }}>
          «{tripTitle || autoTitle}» — {cities.length} {cities.length < 5 ? 'города' : 'городов'}, {totalNights} ночей. Можно добавлять отели, переезды и активности.
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ marginBottom: 10, letterSpacing: '-0.025em' }}>Финальный драфт</h1>
      <div style={{ fontSize: 15, color: 'var(--muted)', marginBottom: 22, maxWidth: 620 }}>
        Проверь, всё ли на месте. После сохранения трип появится в коллекции.
      </div>

      {/* Preview card */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ height: 120, background: 'linear-gradient(135deg, hsl(210,60%,55%) 0%, hsl(195,55%,50%) 40%, hsl(25,65%,60%) 100%)', position: 'relative' }}>
          <svg viewBox="0 0 800 200" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.5 }}>
            <path d="M0 130 Q 200 80 400 110 T 800 95 L 800 200 L 0 200 Z" fill="rgba(255,255,255,.5)" />
            <path d="M0 160 Q 250 110 450 140 T 800 130 L 800 200 L 0 200 Z" fill="rgba(255,255,255,.3)" />
          </svg>
          <div style={{ position: 'absolute', left: 20, bottom: 14, color: 'white', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 24, letterSpacing: '-0.03em', textShadow: '0 2px 12px rgba(0,0,0,.3)' }}>
            {tripTitle || autoTitle}
          </div>
        </div>

        <div style={{ padding: 18 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 10 }}>
            Маршрут · {allCities.length} точек
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}>
            <div style={{ position: 'absolute', left: 13, top: 14, bottom: 14, width: 2, background: 'var(--line-2)' }} />
            <ReviewRow num="" icon="flag" iconColor="var(--brand)" name={home.city} sub={`${home.country} · старт`} muted />
            {cities.map((c, i) => (
              <ReviewRow key={c.id} num={i + 1} name={c.city} sub={`${c.country || '—'} · ${c.nights} ${c.nights == 1 ? 'ночь' : c.nights < 5 ? 'ночи' : 'ночей'}${c.startDate ? ` · с ${c.startDate}` : ''}`} />
            ))}
            <ReviewRow num="" icon={returnCity.city === home.city ? 'flag' : 'globe'} iconColor={returnCity.city === home.city ? 'var(--brand)' : 'var(--warm)'} name={returnCity.city} sub={`${returnCity.country || ''} · возврат`} muted />
          </div>
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line-2)', display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <Stat label="Начало" value={startDate} />
            <Stat label="Длительность" value={`${totalNights} ноч.`} />
            <Stat label="Городов" value={cities.length} />
          </div>
        </div>
      </div>

      {/* Trip name */}
      <div className="field" style={{ marginBottom: 16 }}>
        <label className="field__label">Название трипа</label>
        <input
          className="input"
          value={tripTitle || autoTitle}
          onChange={(e) => setTripTitle(e.target.value)}
          disabled={saving}
          style={{ fontSize: 15 }}
        />
      </div>

      {error && (
        <div style={{ padding: '12px 14px', background: 'var(--danger-soft)', border: '1px solid var(--danger)', borderRadius: 10, fontSize: 13, color: 'var(--danger)', marginBottom: 14 }}>
          {error}
        </div>
      )}

      {saving && (
        <div style={{ padding: '12px 14px', background: 'var(--brand-soft)', border: '1px solid var(--brand-soft-12)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <div style={{ width: 16, height: 16, border: '2px solid var(--brand)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
          <div style={{ flex: 1, fontSize: 13, color: 'var(--ink-2)' }}>Сохраняем трип — секунду…</div>
        </div>
      )}

      <FooterNav>
        <Btn variant="ghost" icon="back" onClick={goPrev} disabled={saving}>Назад</Btn>
        <div style={{ flex: 1 }} />
        <Btn variant="primary" icon="check" onClick={onSave} disabled={saving}>
          {saving ? 'Сохраняем…' : 'Сохранить трип'}
        </Btn>
      </FooterNav>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ManualPlanner() {
  const { user } = useAuth();
  const nav = useNavigate();

  const isPro = ['pro_monthly', 'pro_yearly', 'pro_trip'].includes(user?.subscription_status);

  // ── Fetch active trips to enforce free-plan limit ─────────────────────────
  const { data: allTrips = [], isLoading: checkingLimit } = useQuery({
    queryKey: ['trips-limit-check', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trips')
        .select('id')
        .eq('created_by', user.email);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.email && !isPro,
  });

  const { data: allVisits = [] } = useQuery({
    queryKey: ['visits-limit-check', allTrips.map(t => t.id).join(',')],
    queryFn: async () => {
      const ids = allTrips.map(t => t.id);
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from('city_visits').select('*').in('trip_id', ids);
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

  const [step, setStep]               = useState('home');
  const [home, setHome]               = useState({ city: '', country: '', lat: null, lng: null });
  const [cities, setCities]           = useState([]);
  const [returnMode, setReturnMode]   = useState('home');
  const [returnCity, setReturnCity]   = useState({ city: '', country: '', lat: null, lng: null });
  const [tripTitle, setTripTitle]     = useState('');
  const [saving, setSaving]           = useState(false);
  const [savedOk, setSavedOk]         = useState(false);
  const [savedTripId, setSavedTripId] = useState(null);
  const [error, setError]             = useState(null);

  const goNext = () => {
    const i = STEPS.findIndex(s => s.id === step);
    if (i < STEPS.length - 1) setStep(STEPS[i + 1].id);
  };
  const goPrev = () => {
    const i = STEPS.findIndex(s => s.id === step);
    if (i > 0) setStep(STEPS[i - 1].id);
  };

  const effectiveReturn = returnMode === 'home' ? home : returnCity;
  const mapHighlight = step === 'home' ? 'home' : step === 'return' ? 'return' : step === 'cities' ? 'cities' : 'all';

  const autoTitle = cities.length === 0
    ? 'Новый трип'
    : cities.length === 1
      ? cities[0].city
      : `${cities[0]?.city} → ${cities[cities.length - 1]?.city}`;

  // ── Supabase save ────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    setError(null);

    try {
      const title = (tripTitle || autoTitle).trim();

      // 1. Create trip
      const { data: trip, error: tripErr } = await supabase
        .from('trips')
        .insert({
          title,
          created_by: user.email,
          status: 'active',
          description: '',
        })
        .select()
        .single();

      if (tripErr) throw tripErr;

      // 2. Create city_visits for each city in the itinerary
      const visitsToInsert = cities.map((c) => ({
        trip_id: trip.id,
        city_name: c.city,
        start_datetime: c.startDate ? c.startDate + 'T12:00:00' : null,
        end_datetime: c.startDate && c.nights
          ? addDays(c.startDate, +c.nights) + 'T11:00:00'
          : null,
      }));

      if (visitsToInsert.length > 0) {
        const { error: visitErr } = await supabase
          .from('city_visits')
          .insert(visitsToInsert);
        if (visitErr) throw visitErr;
      }

      setSavedOk(true);
      setSavedTripId(trip.id);

      // Navigate to new trip after a short delay
      setTimeout(() => nav(`/trip/${trip.id}`), 1800);
    } catch (err) {
      console.error('Failed to save trip:', err);
      setError(err.message || 'Не удалось сохранить трип. Попробуй ещё раз.');
    } finally {
      setSaving(false);
    }
  };

  // ── Limit guard ──────────────────────────────────────────────────────────────
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
          <button className="app-header__crumb-back" onClick={() => nav('/trips')} title="К коллекции">
            <Icon name="back" size={14} />
          </button>
          <div className="app-header__brand">
            <span className="app-header__brand-name">Triplanio</span>
          </div>
        </header>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ maxWidth: 480, textAlign: 'center' }}>
            <div style={{
              width: 64, height: 64, borderRadius: 16,
              background: 'var(--warm-tint, #fff3e0)', color: 'var(--warm, #e67e22)',
              display: 'grid', placeItems: 'center', margin: '0 auto 18px',
            }}>
              <Icon name="lock" size={28} />
            </div>
            <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 700 }}>Достигнут лимит</h2>
            <p style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 24 }}>
              На Free плане доступен только <strong>1 активный трип</strong>.
              Дождись окончания текущего трипа или перейди на Pro для безлимитного создания.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Btn variant="ghost" onClick={() => nav('/trips')}>← К трипам</Btn>
              <Btn variant="primary" onClick={() => nav('/settings')}>Перейти на Pro</Btn>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg, var(--wash))' }}>
      {/* Header */}
      <header className="app-header" style={{ position: 'sticky', top: 0, zIndex: 50 }}>
        <button
          className="app-header__crumb-back"
          onClick={() => nav('/trips')}
          title="К коллекции"
        >
          <Icon name="back" size={14} />
        </button>
        <div className="app-header__brand">
          <span className="app-header__brand-name">Triplanio</span>
        </div>
        <div style={{ flex: 1 }} />
        <Stepper currentId={step} onJump={setStep} />
        <div style={{ flex: 1 }} />
        <div style={{ width: 80 }} />{/* spacer to balance stepper */}
      </header>

      {/* Body */}
      <div style={{ flex: 1, padding: '32px 24px', maxWidth: 1280, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 400px',
          gap: 24,
          alignItems: 'start',
        }}>
          {/* Form column */}
          <div style={{ minWidth: 0 }}>
            {step === 'home' && (
              <StepHome home={home} setHome={setHome} goNext={goNext} />
            )}
            {step === 'cities' && (
              <StepCities cities={cities} setCities={setCities} home={home} goPrev={goPrev} goNext={goNext} />
            )}
            {step === 'return' && (
              <StepReturn
                home={home}
                lastCity={cities[cities.length - 1]?.city || 'последний город'}
                returnMode={returnMode}
                setReturnMode={setReturnMode}
                returnCity={returnCity}
                setReturnCity={setReturnCity}
                goPrev={goPrev}
                goNext={goNext}
              />
            )}
            {step === 'review' && (
              <StepReview
                home={home}
                cities={cities}
                returnCity={effectiveReturn}
                tripTitle={tripTitle || autoTitle}
                setTripTitle={setTripTitle}
                saving={saving}
                savedOk={savedOk}
                goPrev={goPrev}
                onSave={handleSave}
                error={error}
              />
            )}
          </div>

          {/* Map column — sticky */}
          <div style={{ position: 'sticky', top: 80 }}>
            <PlannerMap
              home={home}
              cities={cities}
              returnCity={effectiveReturn}
              highlight={mapHighlight}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
