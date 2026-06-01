import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { supabase } from '@/api/supabaseClient';
import { TRIP_SHELL_KEY, TRIP_CONTENT_KEY, invalidateTripData } from '@/lib/trip-data';
import { sortVisits, computeTripValidation } from '@/lib/validation';
import { Icon } from '../design/icons';
import { Btn, Badge, Severity, Skeleton } from '../design/index';
import CitySearch from '@/components/cities/CitySearch';
import { getTimezone } from '@/lib/geo';

// =====================================================================
// TRIP STRUCTURE EDITOR (Edit Mode / песочница) — TRIP_EDIT_MODE_TZ.
// Hybrid: prototype-style UX (start + order + nights, dates recomputed) over the
// TZ backend (city_visits explicit start/end + position). Nothing is written
// while editing — the draft lives in memory; the live conflict engine
// (validation.js → computeTripValidation) drives the panel and the HARD save
// gate. Save persists atomically via the lock-guarded save_trip_edit RPC.
// Done here: structure edit (nights/order/start), conflict resolution (edit
// booking dates / match-to-city / delete, add transfer for "no transfer"),
// lock lifecycle, batch-save. TODO next: add/remove city, drag-DnD,
// sessionStorage draft, full §3a freeze.
// =====================================================================

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const TKIND = { plane: 'Перелёт', train: 'Поезд', bus: 'Автобус', car: 'Авто', ferry: 'Паром' };
const toDT = (iso) => (iso ? DateTime.fromISO(iso, { zone: 'utc' }) : null);
const fmtD = (iso) => { const d = toDT(iso); return d ? `${d.day} ${MONTHS[d.month - 1]}` : '—'; };
const dayInput = (iso) => { const d = toDT(iso); return d ? d.toFormat('yyyy-MM-dd') : ''; };
const isoDay = (day, hour = 12) => (day ? DateTime.fromISO(`${day}`, { zone: 'utc' }).set({ hour, minute: 0, second: 0 }).toISO() : null);
const nightsBetween = (a, b) => { const x = toDT(a), y = toDT(b); return x && y ? Math.max(0, Math.round(y.diff(x, 'days').days)) : null; };
const dayWord = (n) => (n === 1 ? 'день' : n >= 2 && n <= 4 ? 'дня' : 'дней');
const nightWord = (n) => (n === 1 ? 'ночь' : n >= 2 && n <= 4 ? 'ночи' : 'ночей');
const flagEmoji = (cc) =>
  cc && cc.length === 2 ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 127397 + c.charCodeAt(0))) : '📍';
const isAnchor = (n) => n.kind === 'start' || n.kind === 'end';

// Lay transit nodes contiguously from a base date, in the CURRENT array order;
// anchors untouched; position = array index. Used after structural edits. NOT on
// load — initial dates are kept so pre-existing gaps/overlaps surface as A3.
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
    _edited: { hotels: {}, activities: {}, transfers: {} }, // existing rows touched → persist
    _del: { hotels: [], activities: [], transfers: [] },     // existing rows to delete
    removed: [],                                             // cities pulled out of the route (restorable)
  };
}

export default function TripStructureEdit() {
  const { tripId } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [draft, setDraft] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [lock, setLock] = useState('acquiring'); // 'acquiring' | 'held' | 'blocked' | 'error'
  const [saving, setSaving] = useState(false);
  const [resolve, setResolve] = useState(null); // conflict being resolved (or synthetic {code:'E1',...})
  const [adding, setAdding] = useState(false);  // add-city picker open
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const acquiredRef = React.useRef(false);
  const DRAFT_KEY = `ts-edit-${tripId}`;
  const clearDraftStore = () => { try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } };
  const onBack = () => { clearDraftStore(); nav(`/trip/${tripId}`); };

  const { data: shell, isLoading: loadingShell, error: shellError } = useQuery({
    queryKey: TRIP_SHELL_KEY(tripId),
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('getTripDetails', { body: { tripId, include: ['shell'] } });
      if (error) throw error;
      return data;
    },
    enabled: !!tripId,
  });
  const { data: content, isLoading: loadingContent } = useQuery({
    queryKey: TRIP_CONTENT_KEY(tripId),
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('getTripDetails', { body: { tripId, include: ['content'] } });
      if (error) throw error;
      return data;
    },
    enabled: !!tripId && !loadingShell,
  });

  // Build draft once data is in — but prefer a sessionStorage draft if the user
  // was mid-edit (survives reload, TZ §8.5).
  useEffect(() => {
    if (draft || !shell || !content) return;
    try {
      const saved = sessionStorage.getItem(DRAFT_KEY);
      if (saved) { const p = JSON.parse(saved); if (p?.draft) { setDraft(p.draft); setDirty(!!p.dirty); return; } }
    } catch { /* ignore corrupt store */ }
    setDraft(buildDraft(shell, content));
  }, [shell, content, draft, DRAFT_KEY]);

  // Persist the draft for reload resilience.
  useEffect(() => {
    if (draft && dirty) { try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ draft, dirty })); } catch { /* quota */ } }
  }, [draft, dirty, DRAFT_KEY]);

  // Edit Mode lock: acquire on mount, heartbeat ~5 min, release on exit. TZ §3.
  useEffect(() => {
    if (!tripId) return;
    let alive = true;
    supabase.rpc('acquire_trip_lock', { p_trip: tripId })
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) { setLock('error'); return; }
        acquiredRef.current = !!data?.ok;
        setLock(data?.ok ? 'held' : 'blocked');
      })
      .catch(() => { if (alive) setLock('error'); });
    const hb = setInterval(() => { supabase.rpc('heartbeat_trip_lock', { p_trip: tripId }); }, 5 * 60 * 1000);
    const onUnload = () => { if (acquiredRef.current) supabase.rpc('release_trip_lock', { p_trip: tripId }); };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      alive = false;
      clearInterval(hb);
      window.removeEventListener('beforeunload', onUnload);
      if (acquiredRef.current) { supabase.rpc('release_trip_lock', { p_trip: tripId }); acquiredRef.current = false; }
    };
  }, [tripId]);

  const trip = shell?.trip;
  const issues = useMemo(
    () => (draft ? computeTripValidation({ visits: draft.nodes, hotels: draft.hotels, activities: draft.activities, transfers: draft.transfers }) : []),
    [draft],
  );
  const errors = issues.filter((i) => i.level === 'error').length;
  const warns = issues.length - errors;
  const blocked = issues.length > 0;

  // ---- structural edits ----
  const applyNodes = (nextNodes, baseISO) => { setDraft((d) => ({ ...d, nodes: recompute(nextNodes, baseISO) })); setDirty(true); };
  const nudgeNights = (id, delta) =>
    applyNodes(draft.nodes.map((n) => (n.id === id ? { ...n, nights: Math.max(1, Math.min(30, (n.nights || 1) + delta)) } : n)));
  const moveNode = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= draft.nodes.length) return;
    if (isAnchor(draft.nodes[idx]) || isAnchor(draft.nodes[j])) return;
    const next = draft.nodes.slice();
    [next[idx], next[j]] = [next[j], next[idx]];
    applyNodes(next);
  };
  const shiftStart = (delta) => {
    const first = draft.nodes.find((n) => !isAnchor(n));
    const base = first ? toDT(first.start_datetime)?.plus({ days: delta }).toISO() : null;
    applyNodes(draft.nodes, base);
  };
  // Drag-reorder: move node from index → index, clamped into the transit band
  // (never before a start anchor / after an end anchor).
  const moveTo = (from, to) => {
    if (from == null || to == null || from === to) return;
    setDraft((d) => {
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
    setDirty(true);
  };
  // Remove a city → tray (restorable). Its bookings stay and surface as orphans
  // (B3/D6) that must be resolved (delete booking or restore city) before saving.
  const removeCity = (id) => {
    setDraft((d) => {
      const node = d.nodes.find((n) => n.id === id);
      if (!node || isAnchor(node)) return d;
      return { ...d, nodes: recompute(d.nodes.filter((n) => n.id !== id)), removed: [...d.removed, node] };
    });
    setDirty(true);
  };
  const restoreCity = (id) => {
    setDraft((d) => {
      const node = d.removed.find((n) => n.id === id);
      if (!node) return d;
      const arr = d.nodes.slice();
      const endIdx = arr.findIndex((n) => n.kind === 'end');
      arr.splice(endIdx === -1 ? arr.length : endIdx, 0, node);
      return { ...d, nodes: recompute(arr), removed: d.removed.filter((n) => n.id !== id) };
    });
    setDirty(true);
  };
  // Add a brand-new city (tmp id → inserted by save_trip_edit, ends remapped).
  const addCity = (city) => {
    const node = {
      id: 'tmp-' + Math.random().toString(36).slice(2), kind: 'transit',
      city_name: city.city_name, country: city.country || null, country_code: city.country_code || null,
      latitude: city.latitude ?? null, longitude: city.longitude ?? null,
      timezone: city.timezone || 'UTC', external_city_id: city.external_city_id || null,
      nights: 2, start_datetime: null, end_datetime: null,
    };
    setDraft((d) => {
      const arr = d.nodes.slice();
      const endIdx = arr.findIndex((n) => n.kind === 'end');
      arr.splice(endIdx === -1 ? arr.length : endIdx, 0, node);
      return { ...d, nodes: recompute(arr) };
    });
    setDirty(true);
  };
  const onPickCity = async (c) => {
    setAdding(false);
    let tz = 'UTC';
    try { tz = (await getTimezone(c.latitude, c.longitude)) || 'UTC'; } catch { /* keep UTC */ }
    addCity({ ...c, timezone: tz });
  };

  // ---- booking edits (draft only) ----
  const mark = (d, kind, id) => ({ ...d._edited, [kind]: { ...d._edited[kind], [id]: true } });
  const editHotel = (id, ci, co) => { setDraft((d) => ({ ...d, hotels: d.hotels.map((h) => h.id === id ? { ...h, check_in_datetime: ci, check_out_datetime: co } : h), _edited: mark(d, 'hotels', id) })); setDirty(true); };
  const editActivity = (id, s, e) => { setDraft((d) => ({ ...d, activities: d.activities.map((a) => a.id === id ? { ...a, start_datetime: s, end_datetime: e } : a), _edited: mark(d, 'activities', id) })); setDirty(true); };
  const editTransfer = (id, s, e) => { setDraft((d) => ({ ...d, transfers: d.transfers.map((t) => t.id === id ? { ...t, start_datetime: s, end_datetime: e } : t), _edited: t_isNew(d, id) ? d._edited : mark(d, 'transfers', id) })); setDirty(true); };
  const t_isNew = (d, id) => !!d.transfers.find((t) => t.id === id)?.__new;
  const delBooking = (kind, id) => {
    setDraft((d) => {
      const arr = d[kind].filter((x) => x.id !== id);
      const wasNew = kind === 'transfers' && t_isNew(d, id);
      const _del = wasNew ? d._del : { ...d._del, [kind]: [...d._del[kind], id] };
      return { ...d, [kind]: arr, _del };
    });
    setDirty(true);
  };
  const addTransfer = (fromId, toId, kind) => {
    const byId = new Map(draft.nodes.map((n) => [n.id, n]));
    const from = byId.get(fromId), to = byId.get(toId);
    const t = {
      id: 'tmp-' + Math.random().toString(36).slice(2), __new: true,
      from_city_visit_id: fromId, to_city_visit_id: toId,
      from_city_name: from?.city_name, to_city_name: to?.city_name,
      start_datetime: from?.end_datetime || to?.start_datetime || null,
      end_datetime: to?.start_datetime || from?.end_datetime || null,
      transport_type: kind, carrier: null,
    };
    setDraft((d) => ({ ...d, transfers: [...d.transfers, t] }));
    setDirty(true);
  };

  // ---- save ----
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
    const p_deletes = { ...draft._del, cities: (draft.removed || []).filter((n) => !String(n.id).startsWith('tmp-')).map((n) => n.id) };
    const { error } = await supabase.rpc('save_trip_edit', { p_trip: tripId, p_nodes, p_cities_new, p_edits, p_deletes });
    setSaving(false);
    if (error) { alert('Не удалось сохранить: ' + (error.message || error)); return; }
    acquiredRef.current = false; // RPC released the lock
    clearDraftStore();
    invalidateTripData(qc, tripId);
    nav(`/trip/${tripId}`);
  };

  const hasTransfer = (aId, bId) => draft?.transfers.some((t) => t.from_city_visit_id === aId && t.to_city_visit_id === bId);

  if (shellError) {
    return <div style={{ padding: 40, textAlign: 'center' }}><Severity level="error" title="Не удалось загрузить трип">{String(shellError.message || shellError)}</Severity></div>;
  }
  if (lock === 'blocked' || lock === 'error') {
    return (
      <div style={{ maxWidth: 720, margin: '40px auto', padding: 16 }}>
        <Severity level={lock === 'blocked' ? 'warning' : 'error'}
          title={lock === 'blocked' ? 'Трип сейчас редактируется' : 'Не удалось войти в режим редактирования'}>
          {lock === 'blocked'
            ? 'Кто-то уже редактирует структуру этого трипа. Попробуйте позже.'
            : 'Не получилось занять блокировку редактирования. Попробуйте ещё раз.'}
          <div style={{ marginTop: 12 }}><Btn variant="ghost" icon="back" onClick={() => nav(`/trip/${tripId}`)}>Назад к трипу</Btn></div>
        </Severity>
      </div>
    );
  }
  if (loadingShell || loadingContent || !draft || lock === 'acquiring') {
    return (
      <div style={{ maxWidth: 1380, margin: '0 auto', padding: 16 }}>
        <Skeleton w="40%" h={28} style={{ marginBottom: 18 }} />
        <Skeleton w="100%" h={120} style={{ marginBottom: 10 }} />
        <Skeleton w="100%" h={120} />
      </div>
    );
  }

  const byId = new Map(draft.nodes.map((n) => [n.id, n]));
  const transit = draft.nodes.filter((n) => !isAnchor(n));
  const conflictCityIds = new Set(issues.filter((i) => i.cityId).map((i) => i.cityId));
  const startDate = transit[0]?.start_datetime;
  const endDate = transit[transit.length - 1]?.end_datetime;
  const totalNights = nightsBetween(startDate, endDate);

  return (
    <div style={{ maxWidth: 1380, margin: '0 auto', padding: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', paddingBottom: 16, marginBottom: 16, borderBottom: '1px solid var(--line-2)' }}>
        <button onClick={onBack} title="Назад к трипу (отменить правки)"
          style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--line)', cursor: 'pointer', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <Icon name="back" size={16} />
        </button>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <div className="eyebrow" style={{ color: 'var(--brand)', marginBottom: 5 }}>Редактирование структуры</div>
          <h1 style={{ fontSize: 26, marginBottom: 4, letterSpacing: '-0.02em' }}>{trip?.title || '…'}</h1>
          <div className="muted num" style={{ fontSize: 13 }}>
            {fmtD(startDate)} → {fmtD(endDate)}{totalNights != null ? ` · ${totalNights} ${dayWord(totalNights)}` : ''} · {transit.length} {transit.length === 1 ? 'город' : 'города/ов'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          {blocked && <Badge variant="warm" icon="warning">{errors ? `${errors} ошибок` : `${warns} предупр.`}</Badge>}
          <Btn variant="primary" size="sm" icon="check" disabled={!dirty || blocked || saving} onClick={onSave}>{saving ? 'Сохраняю…' : 'Сохранить'}</Btn>
        </div>
      </div>

      <div className="ts-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22, alignItems: 'start' }}>
        {/* LEFT — structure */}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <span className="eyebrow">Старт трипа</span>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 9, padding: 2 }}>
              <button className="ts-step" onClick={() => shiftStart(-1)} title="на день раньше"><Icon name="back" size={13} /></button>
              <span className="num" style={{ padding: '0 8px', fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtD(startDate)}</span>
              <button className="ts-step" onClick={() => shiftStart(1)} title="на день позже"><Icon name="chev" size={13} /></button>
            </div>
            <span className="muted" style={{ fontSize: 11.5 }}>двигает весь трип</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {draft.nodes.map((n, idx) => {
              const prev = draft.nodes[idx - 1];
              return (
                <React.Fragment key={n.id}>
                  {prev && (
                    <ConnectorRow present={hasTransfer(prev.id, n.id)} a={prev} b={n}
                      onAdd={() => setResolve({ code: 'E1', fromId: prev.id, toId: n.id })} />
                  )}
                  <NodeRow
                    node={n}
                    cityConflicts={issues.filter((i) => i.cityId === n.id).length}
                    onNights={(d) => nudgeNights(n.id, d)}
                    onUp={!isAnchor(n) && idx > 0 && !isAnchor(draft.nodes[idx - 1]) ? () => moveNode(idx, -1) : null}
                    onDown={!isAnchor(n) && idx < draft.nodes.length - 1 && !isAnchor(draft.nodes[idx + 1]) ? () => moveNode(idx, 1) : null}
                    onRemove={!isAnchor(n) ? () => removeCity(n.id) : null}
                    drag={!isAnchor(n) ? {
                      dragging: dragIdx === idx,
                      dropping: overIdx === idx && dragIdx !== null && dragIdx !== idx,
                      onDragStart: () => setDragIdx(idx),
                      onDragOver: () => setOverIdx(idx),
                      onDrop: () => { moveTo(dragIdx, idx); setDragIdx(null); setOverIdx(null); },
                      onDragEnd: () => { setDragIdx(null); setOverIdx(null); },
                    } : null}
                  />
                </React.Fragment>
              );
            })}
          </div>

          <button onClick={() => setAdding(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', marginTop: 12, padding: '12px', borderRadius: 12, cursor: 'pointer', background: 'var(--brand-soft)', border: '1px solid var(--line)', color: 'var(--brand)', fontSize: 13, fontWeight: 600 }}>
            <Icon name="plus" size={15} /> Добавить город
          </button>

          <RemovedTray removed={draft.removed} onRestore={restoreCity} />

          <div className="muted" style={{ fontSize: 11.5, marginTop: 14, padding: '10px 12px', borderRadius: 10, background: 'var(--wash)', border: '1px dashed var(--line)' }}>
            Дальше: добавление новых городов и перетаскивание — следующий шаг.
          </div>
        </div>

        {/* RIGHT — map + conflicts */}
        <div style={{ position: 'sticky', top: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ height: 220, borderRadius: 12, background: 'var(--wash)', border: '1px solid var(--line)', overflow: 'hidden', padding: 8 }}>
            <RouteMap nodes={transit} conflictCityIds={conflictCityIds} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="eyebrow">Конфликты</span>
            {issues.length === 0
              ? <Badge variant="success" icon="check">всё сходится</Badge>
              : <Badge variant="warm">{errors ? `${errors} ошибок · ` : ''}{warns} предупр.</Badge>}
          </div>
          {issues.length === 0 ? (
            <div className="muted" style={{ fontSize: 13, padding: '16px 0' }}>Нет конфликтов — структуру можно сохранить.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {issues.map((c, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <Severity level={c.level === 'error' ? 'error' : 'warning'} title={c.message}
                    action={<Btn size="sm" variant="ghost" onClick={() => setResolve(c)}>Исправить</Btn>}>
                    <span className="muted num" style={{ fontSize: 11 }}>{c.code}</span>
                  </Severity>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {resolve && <ResolveModal conflict={resolve} draft={draft} byId={byId}
        actions={{ editHotel, editActivity, editTransfer, delBooking, addTransfer }}
        onClose={() => setResolve(null)} />}

      {adding && (
        <div onClick={() => setAdding(false)} style={{ position: 'fixed', inset: 0, zIndex: 999, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', background: 'rgba(15,23,42,.45)', backdropFilter: 'blur(4px)', padding: '12vh 16px 16px' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: 18, width: 460, maxWidth: '100%', boxShadow: 'var(--shadow-pop)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ fontSize: 16, margin: 0 }}>Добавить город</h2>
              <button className="ts-step" onClick={() => setAdding(false)}><Icon name="close" size={16} /></button>
            </div>
            <CitySearch onSelect={onPickCity} />
          </div>
        </div>
      )}

      <style>{`
        .ts-step { width: 26px; height: 26px; border: none; background: transparent; border-radius: 8px; color: var(--ink-2); cursor: pointer; display: grid; place-items: center; }
        .ts-step:hover { background: var(--wash); }
        .ts-step:disabled { opacity: .3; cursor: default; }
        .ts-in { width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 9px; background: var(--surface); color: var(--ink); font-size: 13px; }
        @media (max-width: 1080px) { .ts-grid { grid-template-columns: 1fr !important; } }
      `}</style>
    </div>
  );
}

// ---- a city / anchor block ----
function NodeRow({ node, cityConflicts, onNights, onUp, onDown, onRemove, drag }) {
  const anchor = isAnchor(node);
  return (
    <div
      draggable={!!drag}
      onDragStart={drag?.onDragStart}
      onDragOver={drag ? (e) => { e.preventDefault(); drag.onDragOver?.(); } : undefined}
      onDrop={drag ? (e) => { e.preventDefault(); drag.onDrop?.(); } : undefined}
      onDragEnd={drag?.onDragEnd}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12,
        background: 'var(--surface)',
        border: '1px solid ' + (drag?.dropping ? 'var(--brand)' : 'var(--line)'),
        boxShadow: drag?.dropping ? '0 0 0 3px var(--brand-soft)' : 'none',
        opacity: drag?.dragging ? 0.5 : 1,
      }}>
      {drag && <span title="перетащить" style={{ cursor: 'grab', color: 'var(--muted-2)', flexShrink: 0, display: 'grid', placeItems: 'center' }}><Icon name="more" size={14} /></span>}
      <span style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--wash)', display: 'grid', placeItems: 'center', fontSize: 15, flexShrink: 0 }}>
        {anchor ? <Icon name="flag" size={15} /> : flagEmoji(node.country_code)}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          {node.city_name || (node.kind === 'start' ? 'Старт' : node.kind === 'end' ? 'Финиш' : 'Город')}
          {cityConflicts > 0 && <Badge variant="warm">{cityConflicts}</Badge>}
        </div>
        <div className="muted num" style={{ fontSize: 12, marginTop: 2 }}>
          {anchor ? (node.kind === 'start' ? 'начало поездки' : 'конец поездки') : `${fmtD(node.start_datetime)} → ${fmtD(node.end_datetime)}`}
        </div>
      </div>
      {!anchor && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, background: 'var(--wash)', border: '1px solid var(--line)', borderRadius: 8, padding: 2 }}>
            <button className="ts-step" onClick={() => onNights(-1)} title="минус ночь"><Icon name="back" size={12} /></button>
            <span className="num" style={{ padding: '0 4px', fontSize: 12, fontWeight: 600, minWidth: 54, textAlign: 'center' }}>{node.nights} {nightWord(node.nights)}</span>
            <button className="ts-step" onClick={() => onNights(1)} title="плюс ночь"><Icon name="chev" size={12} /></button>
          </div>
          <button className="ts-step" disabled={!onUp} onClick={onUp || undefined} title="выше"><Icon name="chev" size={13} style={{ transform: 'rotate(-90deg)' }} /></button>
          <button className="ts-step" disabled={!onDown} onClick={onDown || undefined} title="ниже"><Icon name="chev" size={13} style={{ transform: 'rotate(90deg)' }} /></button>
          {onRemove && <button className="ts-step" onClick={onRemove} title="убрать город из маршрута"><Icon name="trash" size={13} /></button>}
        </div>
      )}
    </div>
  );
}

// ---- removed-cities tray (restorable) ----
function RemovedTray({ removed, onRestore }) {
  if (!removed || removed.length === 0) return null;
  return (
    <div style={{ marginTop: 14, padding: '11px 13px', borderRadius: 12, background: 'var(--wash)', border: '1px dashed var(--line)' }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>Убраны из маршрута</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {removed.map((n) => (
          <button key={n.id} onClick={() => onRestore(n.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 999, background: 'var(--surface)', border: '1px solid var(--line)', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>
            <Icon name="plus" size={12} style={{ color: 'var(--brand)' }} /> {flagEmoji(n.country_code)} {n.city_name}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---- connector between two nodes: transfer present / "no transfer" (clickable to add) ----
function ConnectorRow({ present, a, b, onAdd }) {
  const sameCity = (a.external_city_id && b.external_city_id && a.external_city_id === b.external_city_id)
    || (a.city_name && a.city_name === b.city_name);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0 6px 22px' }}>
      {present ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--brand)' }}>
          <Icon name="plane" size={13} /> переезд
        </span>
      ) : sameCity ? (
        <span className="muted" style={{ fontSize: 12 }}>тот же город</span>
      ) : (
        <button onClick={onAdd} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--danger)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
          <Icon name="warning" size={13} /> нет переезда — добавить
        </button>
      )}
    </div>
  );
}

// ---- lightweight route map (projects node lat/long into an SVG box) ----
function RouteMap({ nodes, conflictCityIds }) {
  const pts = (nodes || []).filter((n) => Number.isFinite(n.latitude) && Number.isFinite(n.longitude));
  if (pts.length < 2) {
    return <div className="muted" style={{ height: '100%', display: 'grid', placeItems: 'center', fontSize: 12, textAlign: 'center', padding: 8 }}>Карта появится, когда у городов будут координаты</div>;
  }
  const W = 100, H = 100, pad = 12;
  const lats = pts.map((p) => p.latitude), lons = pts.map((p) => p.longitude);
  const minLa = Math.min(...lats), maxLa = Math.max(...lats), minLo = Math.min(...lons), maxLo = Math.max(...lons);
  const px = (lo) => (maxLo === minLo ? W / 2 : pad + (lo - minLo) / (maxLo - minLo) * (W - 2 * pad));
  const py = (la) => (maxLa === minLa ? H / 2 : pad + (maxLa - la) / (maxLa - minLa) * (H - 2 * pad)); // lat inverted
  const coords = pts.map((p) => ({ x: px(p.longitude), y: py(p.latitude), n: p }));
  const path = coords.map((c, i) => (i ? 'L' : 'M') + c.x.toFixed(1) + ' ' + c.y.toFixed(1)).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', display: 'block' }}>
      <path d={path} fill="none" stroke="var(--brand)" strokeWidth="0.6" strokeDasharray="2 1.6" opacity="0.7" />
      {coords.map((c) => (
        <circle key={c.n.id} cx={c.x} cy={c.y} r="2.4"
          fill={conflictCityIds.has(c.n.id) ? 'var(--danger)' : 'var(--brand)'}
          stroke="var(--surface)" strokeWidth="0.9" />
      ))}
    </svg>
  );
}

// ---- resolution modal ----
function ResolveModal({ conflict, draft, byId, actions, onClose }) {
  const code = conflict.code;
  const isHotel = ['B1', 'B2', 'B3'].includes(code);
  const isActivity = ['C1', 'C2', 'C3'].includes(code);
  const isTransfer = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'].includes(code);
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
  const del = () => {
    if (isHotel) actions.delBooking('hotels', hotel.id);
    else if (isActivity) actions.delBooking('activities', act.id);
    else if (isTransfer) actions.delBooking('transfers', tr.id);
    onClose();
  };
  const addLeg = () => { actions.addTransfer(conflict.fromId, conflict.toId, kind); onClose(); };

  const title = isAdd ? `${fromN?.city_name || ''} → ${toN?.city_name || ''}`
    : hotel?.name || (act ? (act.title || act.name) : (tr ? `${fromN?.city_name || ''} → ${toN?.city_name || ''}` : 'Конфликт'));

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,.45)', backdropFilter: 'blur(4px)', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: 20, width: 460, maxWidth: '100%', boxShadow: 'var(--shadow-pop)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ fontSize: 17, marginBottom: 2 }}>{title}</h2>
            <div className="muted" style={{ fontSize: 12 }}>{conflict.message}</div>
          </div>
          <button className="ts-step" onClick={onClose}><Icon name="close" size={16} /></button>
        </div>

        {isCity && (
          <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
            Поправьте ночи, порядок или старт города в списке слева — даты пересчитаются автоматически.
            <div style={{ marginTop: 14, textAlign: 'right' }}><Btn variant="primary" size="sm" onClick={onClose}>Понятно</Btn></div>
          </div>
        )}

        {isAdd && (
          <div>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Чем едем</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
              {Object.keys(TKIND).map((k) => (
                <button key={k} onClick={() => setKind(k)} style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flex: 1, minWidth: 64, padding: '10px 6px', borderRadius: 10, cursor: 'pointer',
                  background: kind === k ? 'var(--brand-soft)' : 'var(--surface)', border: '1px solid ' + (kind === k ? 'var(--brand)' : 'var(--line)'),
                  color: kind === k ? 'var(--brand)' : 'var(--ink-2)',
                }}><Icon name={k} size={16} /><span style={{ fontSize: 11, fontWeight: 600 }}>{TKIND[k]}</span></button>
              ))}
            </div>
            <div style={{ textAlign: 'right' }}><Btn variant="primary" icon="plus" onClick={addLeg}>Добавить переезд</Btn></div>
          </div>
        )}

        {(isHotel || isActivity || isTransfer) && (
          <div>
            {code === 'B3' || code === 'C3' || code === 'D5' || code === 'D6' ? (
              <div className="muted" style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 14 }}>
                {code === 'D5' ? 'Маршрут изменился — этот переезд больше не между соседними узлами. Удалите его или верните прежний порядок.' : 'Бронь осталась без города. Удалите её или верните город в маршрут (добавление города — следующий шаг).'}
              </div>
            ) : (
              <>
                <div className="eyebrow" style={{ marginBottom: 8 }}>{isHotel ? 'Даты брони' : isTransfer ? 'Дата переезда' : 'Дата активности'}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <div><label className="muted" style={{ fontSize: 11 }}>{isHotel ? 'Заезд' : isTransfer ? 'Вылет' : 'Начало'}</label>
                    <input className="ts-in" type="date" value={d1} onChange={(e) => setD1(e.target.value)} /></div>
                  <div><label className="muted" style={{ fontSize: 11 }}>{isHotel ? 'Выезд' : isTransfer ? 'Прилёт' : 'Конец'}</label>
                    <input className="ts-in" type="date" value={d2} onChange={(e) => setD2(e.target.value)} /></div>
                </div>
                {(city || (fromN && toN)) && (
                  <button onClick={matchCity} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 11px', borderRadius: 9, cursor: 'pointer', background: 'var(--brand-soft)', border: '1px solid var(--brand-soft-12, var(--line))', color: 'var(--brand)', fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>
                    <Icon name="refresh" size={13} /> Подогнать под город
                  </button>
                )}
              </>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
              <Btn variant="ghost" icon="trash" onClick={del}>Удалить</Btn>
              {!(code === 'B3' || code === 'C3' || code === 'D5' || code === 'D6') && (
                <Btn variant="primary" icon="check" onClick={applyDates}>Применить</Btn>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
