import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { supabase } from '@/api/supabaseClient';
import { TRIP_SHELL_KEY, TRIP_CONTENT_KEY, invalidateTripData } from '@/lib/trip-data';
import { sortVisits, computeTripValidation } from '@/lib/validation';
import { Icon } from '../design/icons';
import { Btn, Badge, Skeleton } from '../design/index';
import CitySearch from '@/components/cities/CitySearch';
import { getTimezone } from '@/lib/geo';
import MapView from '@/components/views/MapView';

// =====================================================================
// TRIP STRUCTURE EDITOR — "Сетка" (grid) design from the trip-structure-*
// prototype, wired to the real id-based model (city_visits + position),
// computeTripValidation conflicts, lock + save_trip_edit RPC. Live Google map.
// =====================================================================
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const TKIND = { plane: { icon: 'plane', label: 'Перелёт' }, train: { icon: 'train', label: 'Поезд' }, bus: { icon: 'bus', label: 'Автобус' }, car: { icon: 'car', label: 'На авто' }, ferry: { icon: 'ferry', label: 'Паром' } };
const PALETTE = ['#2167e2', '#1d7a4a', '#c9603a', '#9c4ad9', '#c98a1a', '#3d8aa8', '#a83e6a', '#1f8a5b', '#4a6cd9'];
const toDT = (iso) => (iso ? DateTime.fromISO(iso, { zone: 'utc' }) : null);
const WD = ['', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const fmtD = (iso) => { const d = toDT(iso); return d ? `${d.day} ${MONTHS[d.month - 1]}` : '—'; };
const fmtDW = (iso) => { const d = toDT(iso); return d ? `${d.day} ${MONTHS[d.month - 1]}, ${WD[d.weekday]}` : '—'; };
const fmtTime = (iso) => { const d = toDT(iso); return d ? d.toFormat('HH:mm') : null; };
const dayInput = (iso) => { const d = toDT(iso); return d ? d.toFormat('yyyy-MM-dd') : ''; };
const isoDay = (day, hour = 12) => (day ? DateTime.fromISO(`${day}`, { zone: 'utc' }).set({ hour, minute: 0, second: 0 }).toISO() : null);
const nightsBetween = (a, b) => { const x = toDT(a), y = toDT(b); return x && y ? Math.max(0, Math.round(y.diff(x, 'days').days)) : null; };
const dayWord = (n) => (n === 1 ? 'день' : n >= 2 && n <= 4 ? 'дня' : 'дней');
const flagEmoji = (cc) => (cc && cc.length === 2 ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 127397 + c.charCodeAt(0))) : '📍');
const isAnchor = (n) => n.kind === 'start' || n.kind === 'end';
const colorFor = (key) => { let h = 0; const s = String(key || ''); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return PALETTE[h % PALETTE.length]; };
const metaOf = (n) => ({ color: colorFor(n.external_city_id || n.city_name || n.id), flag: flagEmoji(n.country_code), country: n.country || '' });

function recompute(nodes, baseISO) {
  const firstTransit = nodes.find((n) => !isAnchor(n));
  let cursor = (baseISO ? toDT(baseISO) : toDT(firstTransit?.start_datetime)) || DateTime.utc();
  cursor = cursor.startOf('day');
  return nodes.map((n, i) => {
    if (isAnchor(n)) return { ...n, position: i };
    const nights = Number.isFinite(n.nights) ? n.nights : (nightsBetween(n.start_datetime, n.end_datetime) ?? 1);
    const start = cursor.set({ hour: 12 });
    const end = cursor.plus({ days: nights }).set({ hour: 11 });
    cursor = cursor.plus({ days: nights });
    return { ...n, start_datetime: start.toISO(), end_datetime: end.toISO(), nights, position: i };
  });
}

function buildDraft(shell, content) {
  const visits = sortVisits(shell?.cityVisits || []);
  const nodes = visits.map((v, i) => ({
    ...v,
    position: Number.isFinite(v.position) ? v.position : i,
    nights: isAnchor(v) ? null : (nightsBetween(v.start_datetime, v.end_datetime) ?? 1),
  }));
  return {
    nodes,
    hotels: content?.hotels || [],
    activities: content?.activities || [],
    transfers: content?.transfers || [],
    _edited: { hotels: {}, activities: {}, transfers: {} },
    _del: { hotels: [], activities: [], transfers: [] },
    removed: [],
  };
}

export default function TripStructureEdit() {
  const { tripId } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [draft, setDraft] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [lock, setLock] = useState('acquiring');
  const [saving, setSaving] = useState(false);
  const [resolve, setResolve] = useState(null);
  const [adding, setAdding] = useState(false);
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const acquiredRef = React.useRef(false);
  const DRAFT_KEY = `ts-edit-${tripId}`;
  const clearDraftStore = () => { try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } };
  const onBack = () => { clearDraftStore(); nav(`/trip/${tripId}`); };
  const histRef = React.useRef([]);
  const baseRef = React.useRef(null); // JSON of the originally-loaded draft (for Reset)
  const editDraft = (updater) => { setDraft((d) => { if (!d) return d; histRef.current.push(JSON.stringify(d)); if (histRef.current.length > 120) histRef.current.shift(); return updater(d); }); setDirty(true); };
  const undo = () => { const prev = histRef.current.pop(); if (prev == null) return; setDraft(JSON.parse(prev)); setDirty(prev !== baseRef.current); };
  const reset = () => { if (!baseRef.current) return; histRef.current = []; setDraft(JSON.parse(baseRef.current)); setDirty(false); clearDraftStore(); };

  const { data: shell, isLoading: loadingShell, error: shellError } = useQuery({
    queryKey: TRIP_SHELL_KEY(tripId),
    queryFn: async () => { const { data, error } = await supabase.functions.invoke('getTripDetails', { body: { tripId, include: ['shell'] } }); if (error) throw error; return data; },
    enabled: !!tripId,
  });
  const { data: content, isLoading: loadingContent } = useQuery({
    queryKey: TRIP_CONTENT_KEY(tripId),
    queryFn: async () => { const { data, error } = await supabase.functions.invoke('getTripDetails', { body: { tripId, include: ['content'] } }); if (error) throw error; return data; },
    enabled: !!tripId && !loadingShell,
  });

  useEffect(() => {
    if (draft || !shell || !content) return;
    if (!baseRef.current) baseRef.current = JSON.stringify(buildDraft(shell, content));
    try { const saved = sessionStorage.getItem(DRAFT_KEY); if (saved) { const p = JSON.parse(saved); if (p?.draft) { setDraft(p.draft); setDirty(!!p.dirty); return; } } } catch { /* ignore */ }
    setDraft(buildDraft(shell, content));
  }, [shell, content, draft, DRAFT_KEY]);

  useEffect(() => { if (draft && dirty) { try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ draft, dirty })); } catch { /* quota */ } } }, [draft, dirty, DRAFT_KEY]);

  useEffect(() => {
    if (!tripId) return;
    let alive = true;
    supabase.rpc('acquire_trip_lock', { p_trip: tripId }).then(({ data, error }) => {
      if (!alive) return;
      if (error) { setLock('error'); return; }
      acquiredRef.current = !!data?.ok;
      setLock(data?.ok ? 'held' : 'blocked');
    }).catch(() => { if (alive) setLock('error'); });
    const hb = setInterval(() => { supabase.rpc('heartbeat_trip_lock', { p_trip: tripId }); }, 5 * 60 * 1000);
    const onUnload = () => { if (acquiredRef.current) supabase.rpc('release_trip_lock', { p_trip: tripId }); };
    window.addEventListener('beforeunload', onUnload);
    return () => { alive = false; clearInterval(hb); window.removeEventListener('beforeunload', onUnload); if (acquiredRef.current) { supabase.rpc('release_trip_lock', { p_trip: tripId }); acquiredRef.current = false; } };
  }, [tripId]);

  const trip = shell?.trip;
  const issues = useMemo(() => (draft ? computeTripValidation({ visits: draft.nodes, hotels: draft.hotels, activities: draft.activities, transfers: draft.transfers }) : []), [draft]);
  const errors = issues.filter((i) => i.level === 'error').length;
  const warns = issues.length - errors;
  const blocked = issues.length > 0;

  // ---- structural edits ----
  const applyNodes = (nextNodes, baseISO) => editDraft((d) => ({ ...d, nodes: recompute(nextNodes, baseISO) }));
  const nudgeNights = (id, delta) => applyNodes(draft.nodes.map((n) => (n.id === id ? { ...n, nights: Math.max(1, Math.min(60, (n.nights || 1) + delta)) } : n)));
  const shiftStart = (delta) => { const first = draft.nodes.find((n) => !isAnchor(n)); const base = first ? toDT(first.start_datetime)?.plus({ days: delta }).toISO() : null; applyNodes(draft.nodes, base); };
  const moveTo = (from, to) => {
    if (from == null || to == null || from === to) return;
    editDraft((d) => {
      const arr = d.nodes.slice();
      if (isAnchor(arr[from])) return d;
      const [m] = arr.splice(from, 1);
      let t = to > from ? to - 1 : to;
      const lo = arr[0]?.kind === 'start' ? 1 : 0;
      const hi = arr[arr.length - 1]?.kind === 'end' ? arr.length - 1 : arr.length;
      t = Math.max(lo, Math.min(hi, t));
      arr.splice(t, 0, m);
      return { ...d, nodes: recompute(arr) };
    });
  };
  const removeCity = (id) => editDraft((d) => { const node = d.nodes.find((n) => n.id === id); if (!node || isAnchor(node)) return d; return { ...d, nodes: recompute(d.nodes.filter((n) => n.id !== id)), removed: [...d.removed, node] }; });
  const removeEndpoint = (id) => editDraft((d) => ({ ...d, nodes: recompute(d.nodes.filter((n) => n.id !== id)), removed: [...d.removed, d.nodes.find((n) => n.id === id)].filter(Boolean) }));
  const restoreCity = (id) => editDraft((d) => {
    const node = d.removed.find((n) => n.id === id); if (!node) return d;
    const arr = d.nodes.slice();
    if (node.kind === 'start') arr.unshift(node);
    else if (node.kind === 'end') arr.push(node);
    else { const endIdx = arr.findIndex((n) => n.kind === 'end'); arr.splice(endIdx === -1 ? arr.length : endIdx, 0, node); }
    return { ...d, nodes: recompute(arr), removed: d.removed.filter((n) => n.id !== id) };
  });
  const addCity = (city, kind = 'transit') => {
    const node = {
      id: 'tmp-' + Math.random().toString(36).slice(2), kind,
      city_name: city.city_name, country: city.country || null, country_code: city.country_code || null,
      latitude: city.latitude ?? null, longitude: city.longitude ?? null,
      timezone: city.timezone || 'UTC', external_city_id: city.external_city_id || null,
      nights: kind === 'transit' ? 2 : null, start_datetime: null, end_datetime: null,
    };
    editDraft((d) => {
      const arr = d.nodes.slice();
      if (kind === 'start') arr.unshift(node);
      else if (kind === 'end') arr.push(node);
      else { const endIdx = arr.findIndex((n) => n.kind === 'end'); arr.splice(endIdx === -1 ? arr.length : endIdx, 0, node); }
      return { ...d, nodes: recompute(arr) };
    });
  };
  const onPickCity = async (c, kind) => {
    setAdding(false);
    let tz = 'UTC';
    try { tz = (await getTimezone(c.latitude, c.longitude)) || 'UTC'; } catch { /* keep */ }
    addCity({ ...c, timezone: tz }, kind);
  };

  // ---- booking edits ----
  const mark = (d, kind, id) => ({ ...d._edited, [kind]: { ...d._edited[kind], [id]: true } });
  const t_isNew = (d, id) => !!d.transfers.find((t) => t.id === id)?.__new;
  const editHotel = (id, ci, co) => editDraft((d) => ({ ...d, hotels: d.hotels.map((h) => h.id === id ? { ...h, check_in_datetime: ci, check_out_datetime: co } : h), _edited: mark(d, 'hotels', id) }));
  const editActivity = (id, s, e) => editDraft((d) => ({ ...d, activities: d.activities.map((a) => a.id === id ? { ...a, start_datetime: s, end_datetime: e } : a), _edited: mark(d, 'activities', id) }));
  const editTransfer = (id, s, e) => editDraft((d) => ({ ...d, transfers: d.transfers.map((t) => t.id === id ? { ...t, start_datetime: s, end_datetime: e } : t), _edited: t_isNew(d, id) ? d._edited : mark(d, 'transfers', id) }));
  const delBooking = (kind, id) => editDraft((d) => { const arr = d[kind].filter((x) => x.id !== id); const wasNew = kind === 'transfers' && t_isNew(d, id); const _del = wasNew ? d._del : { ...d._del, [kind]: [...d._del[kind], id] }; return { ...d, [kind]: arr, _del }; });
  const addTransfer = (fromId, toId, kind) => {
    const byId = new Map(draft.nodes.map((n) => [n.id, n]));
    const from = byId.get(fromId), to = byId.get(toId);
    editDraft((d) => ({ ...d, transfers: [...d.transfers, { id: 'tmp-' + Math.random().toString(36).slice(2), __new: true, from_city_visit_id: fromId, to_city_visit_id: toId, from_city_name: from?.city_name, to_city_name: to?.city_name, start_datetime: from?.end_datetime || to?.start_datetime || null, end_datetime: to?.start_datetime || from?.end_datetime || null, transport_type: kind, carrier: null }] }));
  };

  const onSave = async () => {
    if (!draft || blocked || saving) return;
    setSaving(true);
    const isTmp = (id) => String(id).startsWith('tmp-');
    const p_nodes = draft.nodes.filter((n) => !isTmp(n.id)).map((n) => ({ id: n.id, start_datetime: n.start_datetime ?? null, end_datetime: n.end_datetime ?? null, position: n.position }));
    const p_cities_new = draft.nodes.filter((n) => isTmp(n.id)).map((n) => ({ tmp: n.id, city_name: n.city_name, country: n.country ?? null, country_code: n.country_code ?? null, latitude: n.latitude ?? null, longitude: n.longitude ?? null, timezone: n.timezone ?? null, external_city_id: n.external_city_id ?? null, kind: n.kind || 'transit', start_datetime: n.start_datetime ?? null, end_datetime: n.end_datetime ?? null, position: n.position }));
    const p_edits = {
      hotels: draft.hotels.filter((h) => draft._edited.hotels[h.id]).map((h) => ({ id: h.id, check_in_datetime: h.check_in_datetime ?? null, check_out_datetime: h.check_out_datetime ?? null })),
      activities: draft.activities.filter((a) => draft._edited.activities[a.id]).map((a) => ({ id: a.id, start_datetime: a.start_datetime ?? null, end_datetime: a.end_datetime ?? null })),
      transfers_upd: draft.transfers.filter((t) => !t.__new && draft._edited.transfers[t.id]).map((t) => ({ id: t.id, start_datetime: t.start_datetime ?? null, end_datetime: t.end_datetime ?? null })),
      transfers_new: draft.transfers.filter((t) => t.__new).map((t) => ({ from_city_visit_id: t.from_city_visit_id, to_city_visit_id: t.to_city_visit_id, start_datetime: t.start_datetime ?? null, end_datetime: t.end_datetime ?? null, transport_type: t.transport_type ?? null, carrier: t.carrier ?? null })),
    };
    const p_deletes = { ...draft._del, cities: (draft.removed || []).filter((n) => !isTmp(n.id)).map((n) => n.id) };
    const { error } = await supabase.rpc('save_trip_edit', { p_trip: tripId, p_nodes, p_cities_new, p_edits, p_deletes });
    setSaving(false);
    if (error) { alert('Не удалось сохранить: ' + (error.message || error)); return; }
    acquiredRef.current = false;
    clearDraftStore();
    invalidateTripData(qc, tripId);
    nav(`/trip/${tripId}`);
  };

  if (shellError) return <div style={{ padding: 40, textAlign: 'center' }}><div className="sev sev--error">Не удалось загрузить трип: {String(shellError.message || shellError)}</div></div>;
  if (lock === 'blocked' || lock === 'error') {
    return (
      <div style={{ maxWidth: 640, margin: '40px auto', padding: 16 }}>
        <div className={`sev sev--${lock === 'blocked' ? 'warning' : 'error'}`}>
          <span className="sev__icon"><Icon name="warning" size={16} /></span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>{lock === 'blocked' ? 'Трип сейчас редактируется' : 'Не удалось войти в режим редактирования'}</div>
            <div style={{ fontSize: 12.5 }}>{lock === 'blocked' ? 'Кто-то уже редактирует структуру этого трипа. Попробуйте позже.' : 'Не получилось занять блокировку. Попробуйте ещё раз.'}</div>
            <div style={{ marginTop: 12 }}><Btn variant="ghost" icon="back" onClick={() => nav(`/trip/${tripId}`)}>Назад к трипу</Btn></div>
          </div>
        </div>
      </div>
    );
  }
  if (loadingShell || loadingContent || !draft || lock === 'acquiring') {
    return <div style={{ maxWidth: 1380, margin: '0 auto', padding: 16 }}><Skeleton w="40%" h={28} style={{ marginBottom: 18 }} /><Skeleton w="100%" h={120} style={{ marginBottom: 10 }} /><Skeleton w="100%" h={120} /></div>;
  }

  const ordered = sortVisits(draft.nodes);
  const byId = new Map(ordered.map((n) => [n.id, n]));
  const transit = ordered.filter((n) => !isAnchor(n));
  const startDate = transit[0]?.start_datetime;
  const endDate = transit[transit.length - 1]?.end_datetime;
  const totalNights = nightsBetween(startDate, endDate);
  const canUndo = histRef.current.length > 0;
  const membersCount = content?.members?.length || 0;
  const cityConflicts = (id) => issues.filter((i) => i.cityId === id).length;
  const transferFor = (aId, bId) => draft.transfers.find((t) => t.from_city_visit_id === aId && t.to_city_visit_id === bId);
  const transferMismatch = (t) => !!t && issues.some((i) => i.transferId === t.id && ['D1', 'D2', 'D3', 'D4'].includes(i.code));
  let stayNum = 0;

  // assemble rows: each node + the connector to the next node
  const rows = [];
  ordered.forEach((n, idx) => {
    rows.push({ kind: 'node', node: n, idx, stayNum: isAnchor(n) ? null : ++stayNum });
    const next = ordered[idx + 1];
    if (next) rows.push({ kind: 'leg', a: n, b: next });
  });

  return (
    <div style={{ maxWidth: 1380, margin: '0 auto', padding: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', paddingBottom: 14, marginBottom: 16, borderBottom: '1px solid var(--line-2)' }}>
        <button onClick={onBack} title="Назад (отменить правки)" className="ts-step" style={{ width: 38, height: 38, background: 'var(--surface)', border: '1px solid var(--line)', flexShrink: 0 }}><Icon name="back" size={16} /></button>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <div className="eyebrow" style={{ color: 'var(--brand)', marginBottom: 5 }}>Редактирование структуры</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 26, marginBottom: 0, letterSpacing: '-0.02em' }}>{trip?.title || '…'}</h1>
            {membersCount > 0 && <Badge variant="quiet"><Icon name="lock" size={11} /> {membersCount} уч.</Badge>}
          </div>
          <div className="muted num" style={{ fontSize: 13, marginTop: 6 }}>{fmtD(startDate)} → {fmtD(endDate)}{totalNights != null ? ` · ${totalNights} ${dayWord(totalNights)}` : ''} · {transit.length} {transit.length === 1 ? 'город' : 'городов'}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
          {blocked && <Badge variant="warm" icon="warning">{errors ? `${errors} ошибок` : `${warns} предупр.`}</Badge>}
          <Btn variant="ghost" size="sm" icon="back" onClick={undo} disabled={!canUndo}>Отменить</Btn>
          <Btn variant="ghost" size="sm" icon="refresh" onClick={reset} disabled={!dirty}>Сброс</Btn>
          <Btn variant="primary" size="sm" icon="check" disabled={!dirty || blocked || saving} onClick={onSave}>{saving ? 'Сохраняю…' : 'Сохранить'}</Btn>
        </div>
      </div>

      <div className="ts-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22, alignItems: 'start' }}>
        {/* LEFT — structure table */}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <span className="eyebrow">Старт трипа</span>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 9, padding: 2 }}>
              <button className="ts-step" onClick={() => shiftStart(-1)} title="раньше"><Icon name="back" size={13} /></button>
              <span className="num" style={{ padding: '0 8px', fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtDW(startDate)}</span>
              <button className="ts-step" onClick={() => shiftStart(1)} title="позже"><Icon name="chev" size={13} /></button>
            </div>
            <span className="muted" style={{ fontSize: 11.5 }}>двигает весь трип</span>
          </div>

          <div>
            {rows.map((r, i) => {
              const first = i === 0, last = i === rows.length - 1;
              if (r.kind === 'leg') {
                const t = transferFor(r.a.id, r.b.id);
                return <GridTransfer key={`leg-${r.a.id}-${r.b.id}`} a={r.a} b={r.b} t={t} mismatch={transferMismatch(t)} first={first} last={last}
                  onOpen={() => setResolve(t ? { code: transferMismatch(t) ? 'D1' : 'D-edit', transferId: t.id } : { code: 'E1', fromId: r.a.id, toId: r.b.id })} />;
              }
              const n = r.node;
              if (isAnchor(n)) return <GridEndpoint key={n.id} node={n} first={first} last={last} onRemove={() => removeEndpoint(n.id)} />;
              return <GridNode key={n.id} seg={n} stayNum={r.stayNum} first={n === transit[0]} firstRow={first} last={last}
                conflictCount={cityConflicts(n.id)}
                onNightsMinus={() => nudgeNights(n.id, -1)} onNightsPlus={() => nudgeNights(n.id, 1)}
                onShiftMinus={() => shiftStart(-1)} onShiftPlus={() => shiftStart(1)}
                onUp={r.idx > 0 && !isAnchor(ordered[r.idx - 1]) ? () => moveTo(r.idx, r.idx - 1) : null}
                onDown={r.idx < ordered.length - 1 && !isAnchor(ordered[r.idx + 1]) ? () => moveTo(r.idx, r.idx + 1) : null}
                onRemove={() => removeCity(n.id)}
                drag={{ dragging: dragIdx === r.idx, dropping: overIdx === r.idx && dragIdx !== null && dragIdx !== r.idx,
                  onDragStart: () => setDragIdx(r.idx), onDragOver: () => setOverIdx(r.idx),
                  onDrop: () => { moveTo(dragIdx, r.idx); setDragIdx(null); setOverIdx(null); }, onDragEnd: () => { setDragIdx(null); setOverIdx(null); } }} />;
            })}
          </div>

          <AddPointButton onOpen={() => setAdding(true)} />
          <RemovedTray removed={draft.removed} onRestore={restoreCity} />
        </div>

        {/* RIGHT — live map + warnings */}
        <div className="ts-rightcol" style={{ position: 'sticky', top: 14, height: 'calc(100vh - 128px)', minHeight: 520, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ flex: 1, minHeight: 220, borderRadius: 16, overflow: 'hidden', border: '1px solid var(--line)', boxShadow: 'var(--shadow-soft)' }}>
            <MapView visits={draft.nodes} transfers={draft.transfers} visitsById={Object.fromEntries(draft.nodes.map((v) => [v.id, v]))} showStartEnd colorScheme={typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'DARK' : 'LIGHT'} />
          </div>
          <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
            <WarningsPanel issues={issues} errors={errors} warns={warns} onOpen={setResolve} />
          </div>
        </div>
      </div>

      {resolve && <ResolveModal conflict={resolve} draft={draft} byId={byId} actions={{ editHotel, editActivity, editTransfer, delBooking, addTransfer }} onClose={() => setResolve(null)} />}
      {adding && <AddPointDialog onPick={onPickCity} onClose={() => setAdding(false)} />}

      <style>{`
        .ts-step { border: none; background: transparent; border-radius: 8px; color: var(--ink-2); cursor: pointer; display: grid; place-items: center; width: 26px; height: 26px; }
        .ts-step:hover { background: var(--wash); }
        .ts-step:disabled { opacity: .3; cursor: default; }
        .ts-in { width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 9px; background: var(--surface); color: var(--ink); font-size: 13px; }
        @media (max-width: 1080px) { .ts-grid { grid-template-columns: 1fr !important; } .ts-rightcol { position: static !important; height: auto !important; } }
      `}</style>
    </div>
  );
}

// ---- grouped-table row borders (settings-card look) ----
function rowStyle(first, last) {
  return {
    background: 'var(--surface)',
    borderLeft: '1px solid var(--line)', borderRight: '1px solid var(--line)',
    borderTop: first ? '1px solid var(--line)' : 'none',
    borderBottom: '1px solid ' + (last ? 'var(--line)' : 'var(--line-2)'),
    borderTopLeftRadius: first ? 14 : 0, borderTopRightRadius: first ? 14 : 0,
    borderBottomLeftRadius: last ? 14 : 0, borderBottomRightRadius: last ? 14 : 0,
  };
}
const GCOLS = '26px minmax(0,1fr) 62px 62px auto auto';

function Conf({ n }) {
  if (!n) return null;
  return <span title={`${n} конфликт(а)`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 999, background: 'var(--warning-soft)', color: 'var(--warning)', fontSize: 11, fontWeight: 700 }}><Icon name="warning" size={10} /> {n}</span>;
}
function Acts({ onUp, onDown, onRemove }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
    <button className="ts-step" style={{ width: 23, height: 23 }} onClick={onUp || undefined} disabled={!onUp} title="выше"><Icon name="chev" size={12} style={{ transform: 'rotate(-90deg)' }} /></button>
    <button className="ts-step" style={{ width: 23, height: 23 }} onClick={onDown || undefined} disabled={!onDown} title="ниже"><Icon name="chev" size={12} style={{ transform: 'rotate(90deg)' }} /></button>
    {onRemove && <button className="ts-step" style={{ width: 23, height: 23, color: 'var(--muted)' }} onClick={onRemove} title="убрать"><Icon name="trash" size={12} /></button>}
  </div>;
}
function GCell({ label, iso, editable, onPlus }) {
  return <div style={{ minWidth: 0 }}>
    <div style={{ fontSize: 8.5, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted-2)', fontWeight: 700 }}>{label}</div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <span className="num" style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtD(iso)}</span>
      {editable ? <button className="ts-step" style={{ width: 16, height: 16, marginLeft: 1 }} onClick={onPlus} title="позже"><Icon name="chev" size={9} /></button>
        : <span style={{ width: 16, height: 16, display: 'grid', placeItems: 'center', color: 'var(--muted-2)' }} title="следует за прошлым"><Icon name="lock" size={9} /></span>}
    </div>
  </div>;
}

function GridNode({ seg, stayNum, first, firstRow, last, conflictCount, onNightsMinus, onNightsPlus, onShiftMinus, onShiftPlus, onUp, onDown, onRemove, drag }) {
  const m = metaOf(seg);
  return (
    <div draggable onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; drag.onDragStart(); }} onDragEnd={drag.onDragEnd}
      onDragOver={(e) => { e.preventDefault(); drag.onDragOver(); }} onDrop={(e) => { e.preventDefault(); drag.onDrop(); }}
      style={{ ...rowStyle(firstRow, last), display: 'grid', gridTemplateColumns: GCOLS, alignItems: 'center', gap: 9, padding: '14px 11px', opacity: drag.dragging ? 0.4 : 1, boxShadow: drag.dropping ? 'inset 0 2px 0 var(--brand)' : 'none' }}>
      <span style={{ width: 24, height: 24, borderRadius: 6, background: m.color, color: 'white', fontSize: 11, fontWeight: 700, display: 'grid', placeItems: 'center', cursor: 'grab' }}>{stayNum}</span>
      <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ fontSize: 13.5 }}>{m.flag}</span>
        <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{seg.city_name}</span>
        {m.country && <span className="muted" style={{ fontSize: 10.5, whiteSpace: 'nowrap' }}>{m.country}</span>}
        <Conf n={conflictCount} />
      </div>
      <GCell label="Заезд" iso={seg.start_datetime} editable={first} onMinus={onShiftMinus} onPlus={onShiftPlus} />
      <GCell label="Выезд" iso={seg.end_datetime} editable onMinus={onNightsMinus} onPlus={onNightsPlus} />
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 1, background: 'var(--wash)', border: '1px solid var(--line-2)', borderRadius: 7, padding: 1 }}>
        <button className="ts-step" style={{ width: 20, height: 20 }} onClick={onNightsMinus} disabled={seg.nights <= 1}><Icon name="close" size={9} style={{ transform: 'rotate(45deg)' }} /></button>
        <span className="num" style={{ minWidth: 26, textAlign: 'center', fontSize: 11.5, fontWeight: 700 }}>{seg.nights}н</span>
        <button className="ts-step" style={{ width: 20, height: 20 }} onClick={onNightsPlus}><Icon name="plus" size={9} /></button>
      </div>
      <Acts onUp={onUp} onDown={onDown} onRemove={onRemove} />
    </div>
  );
}

function GridTransfer({ a, b, t, mismatch, first, last, onOpen }) {
  const sameCity = (a.external_city_id && b.external_city_id && a.external_city_id === b.external_city_id) || (a.city_name && a.city_name === b.city_name);
  if (sameCity && !t) {
    return <div style={{ ...rowStyle(first, last), padding: '5px 11px', fontSize: 11, color: 'var(--muted)', background: 'var(--wash)' }}>тот же город — переезд не нужен</div>;
  }
  if (!t) {
    return <button onClick={onOpen} style={{ ...rowStyle(first, last), display: 'flex', alignItems: 'center', gap: 8, padding: '6px 11px', width: '100%', textAlign: 'left', cursor: 'pointer', fontFamily: 'var(--font-body)', background: 'var(--wash)' }}>
      <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--surface)', border: '1.5px dashed var(--warning)', color: 'var(--warning)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name="plus" size={11} /></span>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--warning)' }}>Добавить переезд</span>
      <span className="muted" style={{ fontSize: 10.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.city_name} → {b.city_name}</span>
      <Icon name="chev" size={11} style={{ color: 'var(--muted-2)', marginLeft: 'auto', flexShrink: 0 }} />
    </button>;
  }
  const meta = TKIND[t.transport_type] || TKIND.train;
  const fg = mismatch ? 'var(--warning)' : 'var(--ev-transfer)';
  const dep = fmtTime(t.start_datetime), arr = fmtTime(t.end_datetime);
  return <button onClick={onOpen} style={{ ...rowStyle(first, last), display: 'grid', gridTemplateColumns: GCOLS, alignItems: 'center', gap: 9, padding: '9px 11px', width: '100%', textAlign: 'left', cursor: 'pointer', fontFamily: 'var(--font-body)', background: mismatch ? 'var(--warning-soft)' : 'var(--ev-transfer-soft)', boxShadow: 'inset 3px 0 0 ' + fg }}>
    <span style={{ width: 24, height: 24, borderRadius: '50%', background: fg, color: 'white', display: 'grid', placeItems: 'center' }}><Icon name={mismatch ? 'warning' : meta.icon} size={13} /></span>
    <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: fg, whiteSpace: 'nowrap' }}>{meta.label}{mismatch ? ' · не совпадает' : ''}</span>
      <span className="num muted" style={{ fontSize: 10.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fmtD(t.start_datetime)}{t.carrier ? ' · ' + t.carrier : ''}</span>
    </div>
    <div><div style={{ fontSize: 8.5, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted-2)', fontWeight: 700 }}>Отпр</div><div className="num" style={{ fontSize: 12, fontWeight: 700, color: dep ? 'var(--ink)' : 'var(--muted-2)' }}>{dep || '—'}</div></div>
    <div><div style={{ fontSize: 8.5, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted-2)', fontWeight: 700 }}>Приб</div><div className="num" style={{ fontSize: 12, fontWeight: 700, color: arr ? 'var(--ink)' : 'var(--muted-2)' }}>{arr || '—'}</div></div>
    <span />
    <Icon name="chev" size={13} style={{ color: fg, justifySelf: 'end' }} />
  </button>;
}

function GridEndpoint({ node, first, last, onRemove }) {
  const isStart = node.kind === 'start';
  const accent = isStart ? 'var(--success)' : 'var(--warm, var(--brand))';
  const m = metaOf(node);
  return <div style={{ ...rowStyle(first, last), display: 'flex', alignItems: 'center', gap: 10, padding: '11px' }}>
    <span style={{ width: 24, height: 24, borderRadius: 6, background: 'color-mix(in srgb, ' + accent + ' 14%, transparent)', color: accent, display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name="flag" size={13} /></span>
    <span style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.09em', fontWeight: 700, color: accent, flexShrink: 0 }}>{isStart ? 'Старт' : 'Финиш'}</span>
    <span style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0 }}>{m.flag} {node.city_name}</span>
    <span className="muted" style={{ fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>· {isStart ? 'Прилёт' : 'Вылет'}</span>
    <button className="ts-step" style={{ width: 24, height: 24, color: 'var(--muted)', marginLeft: 'auto', flexShrink: 0 }} onClick={onRemove} title="убрать"><Icon name="close" size={13} /></button>
  </div>;
}

function AddPointButton({ onOpen }) {
  return <button onClick={onOpen} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', marginTop: 12, padding: '12px', borderRadius: 12, cursor: 'pointer', background: 'var(--brand-soft)', border: '1px solid var(--brand-soft-12, var(--line))', color: 'var(--brand)', fontSize: 13, fontWeight: 600 }}>
    <Icon name="plus" size={15} /> Добавить точку маршрута
  </button>;
}

const POINT_TYPES = [
  { id: 'transit', label: 'Город', icon: 'bed', sub: 'Остановка с ночёвками' },
  { id: 'start', label: 'Старт', icon: 'flag', sub: 'Начало поездки' },
  { id: 'end', label: 'Финиш', icon: 'flag', sub: 'Конец поездки' },
];
function AddPointDialog({ onPick, onClose }) {
  const [type, setType] = useState('transit');
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 999, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', background: 'rgba(15,23,42,.45)', backdropFilter: 'blur(4px)', padding: '10vh 16px 16px' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: 18, width: 480, maxWidth: '100%', boxShadow: 'var(--shadow-pop)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Добавить точку</h2>
          <button className="ts-step" onClick={onClose}><Icon name="close" size={16} /></button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 7, marginBottom: 14 }}>
          {POINT_TYPES.map((pt) => {
            const active = type === pt.id;
            return <button key={pt.id} onClick={() => setType(pt.id)} title={pt.sub} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, padding: '11px 6px', borderRadius: 11, cursor: 'pointer', background: active ? 'var(--brand-soft)' : 'var(--surface)', border: '1px solid ' + (active ? 'var(--brand)' : 'var(--line)'), color: active ? 'var(--brand)' : 'var(--ink-2)' }}>
              <Icon name={pt.icon} size={17} /><span style={{ fontSize: 11.5, fontWeight: 600 }}>{pt.label}</span>
            </button>;
          })}
        </div>
        <CitySearch onSelect={(c) => onPick(c, type)} />
      </div>
    </div>
  );
}

function RemovedTray({ removed, onRestore }) {
  if (!removed || removed.length === 0) return null;
  return <div style={{ marginTop: 14, padding: '11px 13px', borderRadius: 12, background: 'var(--wash)', border: '1px dashed var(--line)' }}>
    <div className="eyebrow" style={{ marginBottom: 8 }}>Убраны из маршрута</div>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {removed.map((n) => <button key={n.id} onClick={() => onRestore(n.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 999, background: 'var(--surface)', border: '1px solid var(--line)', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>
        <Icon name="plus" size={12} style={{ color: 'var(--brand)' }} /> {flagEmoji(n.country_code)} {n.city_name}
      </button>)}
    </div>
  </div>;
}

// ---- warnings panel (yellow plates) ----
const PLATE_META = { hotel: { icon: 'bed', label: 'Отель' }, transfer: { icon: 'train', label: 'Трансфер' }, activity: { icon: 'spark', label: 'Активность' }, city: { icon: 'pin', label: 'Город' } };
function plateType(code) {
  if (code[0] === 'B') return 'hotel';
  if (code[0] === 'C') return 'activity';
  if (code[0] === 'D') return 'transfer';
  if (code === 'E1' || code === 'E3') return 'transfer';
  return 'city';
}
function WarningsPanel({ issues, errors, warns, onOpen }) {
  const has = issues.length > 0;
  return (
    <div style={{ flex: 1, width: '100%', minWidth: 0, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden', boxShadow: 'var(--shadow-soft)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '10px 13px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 9, flexShrink: 0 }}>
        <div style={{ width: 26, height: 26, borderRadius: 7, background: has ? 'var(--warning-soft)' : 'var(--success-soft)', color: has ? 'var(--warning)' : 'var(--success)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name={has ? 'warning' : 'check'} size={15} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, fontFamily: 'var(--font-display)', letterSpacing: '-0.01em' }}>Конфликты</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{has ? 'Нажми на конфликт, чтобы исправить' : 'Всё согласовано'}</div>
        </div>
        {has && <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
          {errors > 0 && <span style={{ padding: '3px 8px', borderRadius: 999, background: 'var(--danger-soft)', color: 'var(--danger)', fontSize: 11.5, fontWeight: 700 }}>{errors}</span>}
          {warns > 0 && <span style={{ padding: '3px 8px', borderRadius: 999, background: 'var(--warning-soft)', color: 'var(--warning)', fontSize: 11.5, fontWeight: 700 }}>{warns}</span>}
        </div>}
      </div>
      {!has ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24, color: 'var(--muted)' }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: 'var(--success-soft)', color: 'var(--success)', display: 'grid', placeItems: 'center', marginBottom: 14 }}><Icon name="check" size={26} /></div>
          <div style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 15, marginBottom: 6 }}>Конфликтов нет</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, maxWidth: 250 }}>Отели, переезды и активности совпадают с датами и порядком городов.</div>
        </div>
      ) : (
        <div className="scrollbar-thin" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 9, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {issues.map((c, i) => <WarningPlate key={i} c={c} onClick={() => onOpen(c)} />)}
        </div>
      )}
    </div>
  );
}
function WarningPlate({ c, onClick }) {
  const type = plateType(c.code);
  const tm = PLATE_META[type];
  const isError = c.level === 'error';
  const stripe = isError ? 'var(--danger)' : 'var(--warning)';
  return (
    <button onClick={onClick} style={{ display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', fontFamily: 'var(--font-body)', flexShrink: 0, borderRadius: 9, border: '1px solid color-mix(in srgb, ' + stripe + ' 40%, transparent)', background: isError ? 'var(--danger-soft)' : 'var(--warning-soft)', padding: '7px 10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
        <span style={{ width: 20, height: 20, borderRadius: 6, background: 'color-mix(in srgb, ' + stripe + ' 22%, transparent)', color: stripe, display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name={tm.icon} size={12} /></span>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink)' }}>{tm.label}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: stripe }}>
          <span style={{ width: 4, height: 4, borderRadius: '50%', background: stripe }} />{isError ? 'связь разорвана' : 'не совпадает'}
        </span>
        <span className="num" style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--muted-2)' }}>{c.code}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.45 }}>{c.message}</div>
    </button>
  );
}

// ---- resolution modal ----
function ResolveModal({ conflict, draft, byId, actions, onClose }) {
  const code = conflict.code;
  const isHotel = ['B1', 'B2', 'B3'].includes(code);
  const isActivity = ['C1', 'C2', 'C3'].includes(code);
  const isTransfer = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D-edit'].includes(code);
  const isAdd = code === 'E1';
  const isCity = ['A1', 'A2', 'A3-gap', 'A3-overlap'].includes(code);

  const hotel = isHotel ? draft.hotels.find((h) => h.id === conflict.hotelId) : null;
  const act = isActivity ? draft.activities.find((a) => a.id === conflict.activityId) : null;
  const tr = isTransfer ? draft.transfers.find((t) => t.id === conflict.transferId) : null;
  const city = conflict.cityId ? byId.get(conflict.cityId) : null;
  const fromN = tr ? byId.get(tr.from_city_visit_id) : (isAdd ? byId.get(conflict.fromId) : null);
  const toN = tr ? byId.get(tr.to_city_visit_id) : (isAdd ? byId.get(conflict.toId) : null);

  const [d1, setD1] = useState(dayInput(hotel?.check_in_datetime || act?.start_datetime || tr?.start_datetime));
  const [d2, setD2] = useState(dayInput(hotel?.check_out_datetime || act?.end_datetime || tr?.end_datetime));
  const [kind, setKind] = useState('train');

  const meta = { hotel: { color: 'var(--ev-hotel)', icon: 'bed', label: 'Отель' }, activity: { color: 'var(--ev-activity)', icon: 'spark', label: 'Активность' }, transfer: { color: 'var(--ev-transfer)', icon: 'plane', label: 'Трансфер' } }[isHotel ? 'hotel' : isActivity ? 'activity' : 'transfer'];
  const applyDates = () => {
    if (isHotel) actions.editHotel(hotel.id, isoDay(d1, 15), isoDay(d2, 11));
    else if (isActivity) actions.editActivity(act.id, isoDay(d1, 10), isoDay(d2 || d1, 12));
    else if (isTransfer) actions.editTransfer(tr.id, isoDay(d1, 12), isoDay(d2 || d1, 14));
    onClose();
  };
  const matchCity = () => {
    if (isHotel && city) { setD1(dayInput(city.start_datetime)); setD2(dayInput(city.end_datetime)); }
    else if (isActivity && city) { setD1(dayInput(city.start_datetime)); setD2(dayInput(city.start_datetime)); }
    else if (isTransfer && fromN && toN) { setD1(dayInput(fromN.end_datetime)); setD2(dayInput(toN.start_datetime)); }
  };
  const del = () => { if (isHotel) actions.delBooking('hotels', hotel.id); else if (isActivity) actions.delBooking('activities', act.id); else if (isTransfer) actions.delBooking('transfers', tr.id); onClose(); };
  const addLeg = () => { actions.addTransfer(conflict.fromId, conflict.toId, kind); onClose(); };
  const structural = code === 'B3' || code === 'C3' || code === 'D5' || code === 'D6';
  const title = isAdd ? `${fromN?.city_name || ''} → ${toN?.city_name || ''}` : (hotel?.name || (act ? (act.title || act.name) : (tr ? `${fromN?.city_name || ''} → ${toN?.city_name || ''}` : 'Конфликт')));

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,.45)', backdropFilter: 'blur(4px)', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', overflow: 'hidden', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, width: 480, maxWidth: '100%', boxShadow: 'var(--shadow-pop)' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: isAdd || isCity ? 'var(--brand)' : meta.color }} />
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '18px 18px 12px' }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--wash)', color: isAdd || isCity ? 'var(--brand)' : meta.color, display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name={isAdd ? 'plane' : isCity ? 'pin' : meta.icon} size={17} /></div>
          <div style={{ flex: 1, minWidth: 0 }}><h2 style={{ fontSize: 17, marginBottom: 2 }}>{title}</h2><div className="muted" style={{ fontSize: 12 }}>{conflict.message || ''}</div></div>
          <button className="ts-step" onClick={onClose}><Icon name="close" size={16} /></button>
        </div>
        <div style={{ padding: '0 18px 18px' }}>
          {isCity && <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>Поправьте ночи, порядок или старт города в списке слева — даты пересчитаются.<div style={{ marginTop: 14, textAlign: 'right' }}><Btn variant="primary" size="sm" onClick={onClose}>Понятно</Btn></div></div>}
          {isAdd && <div>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Чем едем</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
              {Object.keys(TKIND).map((k) => <button key={k} onClick={() => setKind(k)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flex: 1, minWidth: 64, padding: '10px 6px', borderRadius: 10, cursor: 'pointer', background: kind === k ? 'var(--brand-soft)' : 'var(--surface)', border: '1px solid ' + (kind === k ? 'var(--brand)' : 'var(--line)'), color: kind === k ? 'var(--brand)' : 'var(--ink-2)' }}><Icon name={TKIND[k].icon} size={16} /><span style={{ fontSize: 11, fontWeight: 600 }}>{TKIND[k].label}</span></button>)}
            </div>
            <div style={{ textAlign: 'right' }}><Btn variant="primary" icon="plus" onClick={addLeg}>Добавить переезд</Btn></div>
          </div>}
          {(isHotel || isActivity || isTransfer) && <div>
            {structural ? <div className="muted" style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 14 }}>{code === 'D5' ? 'Маршрут изменился — переезд больше не между соседними городами. Удалите его или верните прежний порядок.' : 'Бронь осталась без города. Удалите её или верните город из трея «Убраны из маршрута».'}</div>
              : <>
                <div className="eyebrow" style={{ marginBottom: 8 }}>{isHotel ? 'Даты брони' : isTransfer ? 'Дата переезда' : 'Дата активности'}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <div><label className="muted" style={{ fontSize: 11 }}>{isHotel ? 'Заезд' : isTransfer ? 'Вылет' : 'Начало'}</label><input className="ts-in" type="date" value={d1} onChange={(e) => setD1(e.target.value)} /></div>
                  <div><label className="muted" style={{ fontSize: 11 }}>{isHotel ? 'Выезд' : isTransfer ? 'Прилёт' : 'Конец'}</label><input className="ts-in" type="date" value={d2} onChange={(e) => setD2(e.target.value)} /></div>
                </div>
                {(city || (fromN && toN)) && <button onClick={matchCity} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 11px', borderRadius: 9, cursor: 'pointer', background: 'var(--brand-soft)', border: '1px solid var(--brand-soft-12, var(--line))', color: 'var(--brand)', fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}><Icon name="refresh" size={13} /> Подогнать под город</button>}
              </>}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
              <Btn variant="ghost" icon="trash" onClick={del}>Удалить</Btn>
              {!structural && <Btn variant="primary" icon="check" onClick={applyDates}>Применить</Btn>}
            </div>
          </div>}
        </div>
      </div>
    </div>
  );
}
