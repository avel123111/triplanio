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
import SourceViewLoader from '@/components/budget/SourceViewLoader';
import EventEditDialog from '@/components/common/EventEditDialog';
import { useToast } from '@/components/ui/use-toast';
import HeaderActions from '@/components/HeaderActions';
import { useAuth } from '@/lib/AuthContext';
import { useTheme } from '@/lib/ThemeContext';
import { isProActive } from '@/lib/subscription';
import { useT, useI18n } from '@/lib/i18n/I18nContext';

// =====================================================================
// TRIP STRUCTURE EDITOR - "Сетка" (grid) design from the trip-structure-*
// prototype, wired to the real id-based model (city_visits + position),
// computeTripValidation conflicts, lock + save_trip_edit RPC. Live Google map.
// =====================================================================
const TKIND = { plane: { icon: 'plane', labelKey: 'tse.tk_plane' }, train: { icon: 'train', labelKey: 'transfer.train' }, bus: { icon: 'bus', labelKey: 'transfer.bus' }, car: { icon: 'car', labelKey: 'event.tk_car' }, ferry: { icon: 'ferry', labelKey: 'transfer.ferry' } };
const PALETTE = ['#2167e2', '#1d7a4a', '#c9603a', '#9c4ad9', '#c98a1a', '#3d8aa8', '#a83e6a', '#1f8a5b', '#4a6cd9'];
const toDT = (iso) => (iso ? DateTime.fromISO(iso, { zone: 'utc' }) : null);
const fmtD = (iso, loc = 'ru') => { const d = toDT(iso); return d ? d.setLocale(loc).toFormat('d LLL') : '-'; };
const fmtDW = (iso, loc = 'ru') => { const d = toDT(iso); return d ? d.setLocale(loc).toFormat('d LLL, ccc') : '-'; };
const fmtTime = (iso) => { const d = toDT(iso); return d ? d.toFormat('HH:mm') : null; };
const nightsBetween = (a, b) => { const x = toDT(a), y = toDT(b); return x && y ? Math.max(0, Math.round(y.diff(x, 'days').days)) : null; };
const dayWord = (n, t) => (n === 1 ? t('tse.day_one') : n >= 2 && n <= 4 ? t('tse.day_few') : t('tse.day_many'));
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
    if (n.kind === 'waypoint') { // single-date transit point - consumes no nights
      const d = cursor.set({ hour: 12 });
      return { ...n, start_datetime: d.toISO(), end_datetime: d.toISO(), nights: null, position: i };
    }
    const nights = Number.isFinite(n.nights) ? n.nights : (nightsBetween(n.start_datetime, n.end_datetime) ?? 1);
    const start = cursor.set({ hour: 12 });
    const end = cursor.plus({ days: nights }).set({ hour: 11 });
    cursor = cursor.plus({ days: nights });
    return { ...n, start_datetime: start.toISO(), end_datetime: end.toISO(), nights, position: i };
  });
}

function buildDraft(shell) {
  const visits = sortVisits(shell?.cityVisits || []);
  const nodes = visits.map((v, i) => ({
    ...v,
    position: Number.isFinite(v.position) ? v.position : i,
    nights: (isAnchor(v) || v.kind === 'waypoint') ? null : (nightsBetween(v.start_datetime, v.end_datetime) ?? 1),
  }));
  // Draft holds ONLY structure (nodes + removed cities + a FIXED trip start date).
  // Bookings are read LIVE from `content` (edits/adds via real dialogs → DB → refetch).
  const firstTransit = nodes.find((n) => !isAnchor(n));
  const startDate = firstTransit?.start_datetime
    ? DateTime.fromISO(firstTransit.start_datetime, { zone: 'utc' }).toISO()
    : (shell?.trip?.start_date ? DateTime.fromISO(`${shell.trip.start_date}T12:00:00`, { zone: 'utc' }).toISO() : null);
  return { nodes, removed: [], startDate };
}

export default function TripStructureEdit() {
  const { tripId } = useParams();
  const t = useT();
  const { lang } = useI18n();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const { isDark, toggle: toggleTheme } = useTheme();
  const accountPro = isProActive(user);
  const [draft, setDraft] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [lock, setLock] = useState('acquiring');
  const [saving, setSaving] = useState(false);
  const [viewEvent, setViewEvent] = useState(null); // {kind,id,warning} - real EventModal
  const [addLeg, setAddLeg] = useState(null);        // {fromVisit,toVisit} - real transfer create dialog
  const [adding, setAdding] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null); // city pending delete-confirm
  const [dragIdx, setDragIdx] = useState(null);   // ordered index of the city being dragged
  const [overGap, setOverGap] = useState(null);   // insertion position (index in `ordered`) the city would drop into
  const [undoStack, setUndoStack] = useState([]); // history of draft snapshots (JSON) for step-undo
  const endDrag = () => { setDragIdx(null); setOverGap(null); };
  const dropAt = (gap) => { if (dragIdx !== null) moveTo(dragIdx, gap); endDrag(); };
  const acquiredRef = React.useRef(false);
  const DRAFT_KEY = `ts-edit-${tripId}`;
  const clearDraftStore = () => { try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } };
  // Отмена редактирования: выбросить черновик, СНЯТЬ лок (статус editing) и вернуться на таймлайн.
  const cancelEdit = async () => {
    clearDraftStore();
    if (acquiredRef.current) { acquiredRef.current = false; try { await supabase.rpc('release_trip_lock', { p_trip: tripId }); } catch { /* ignore */ } }
    nav(`/trip/${tripId}`);
  };
  const baseRef = React.useRef(null); // JSON of the originally-loaded draft (for Reset)
  // Every structural mutation funnels through editDraft → snapshot the pre-edit
  // draft onto the undo stack (cap 50), apply, mark dirty. `undo` pops one step.
  const editDraft = (updater) => {
    if (draft) setUndoStack((s) => [...s.slice(-49), JSON.stringify(draft)]);
    setDraft((d) => (d ? updater(d) : d));
    setDirty(true);
  };
  const undo = () => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    setDraft(JSON.parse(prev));
    setDirty(baseRef.current != null && prev !== baseRef.current);
  };
  const canUndo = undoStack.length > 0;
  // Сброс: вернуть к загруженному состоянию, оставаясь в редакторе.
  const reset = () => { if (!baseRef.current) return; setDraft(JSON.parse(baseRef.current)); setDirty(false); setUndoStack([]); clearDraftStore(); };

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
    if (!baseRef.current) baseRef.current = JSON.stringify(buildDraft(shell));
    try { const saved = sessionStorage.getItem(DRAFT_KEY); if (saved) { const p = JSON.parse(saved); if (p?.draft) { setDraft(p.draft); setDirty(!!p.dirty); return; } } } catch { /* ignore */ }
    setDraft(buildDraft(shell));
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
  // Bookings are read LIVE from content. Exclude bookings of cities slated for
  // deletion (else they'd surface as orphans that block the very save that
  // cascade-deletes them).
  const removedIds = useMemo(() => new Set((draft?.removed || []).map((n) => n.id)), [draft]);
  const liveHotels = useMemo(() => (content?.hotels || []).filter((h) => !removedIds.has(h.city_visit_id)), [content, removedIds]);
  const liveActivities = useMemo(() => (content?.activities || []).filter((a) => !removedIds.has(a.city_visit_id)), [content, removedIds]);
  const liveTransfers = useMemo(() => (content?.transfers || []).filter((t) => !removedIds.has(t.from_city_visit_id) && !removedIds.has(t.to_city_visit_id)), [content, removedIds]);
  const issues = useMemo(() => (draft ? computeTripValidation({ visits: draft.nodes, hotels: liveHotels, activities: liveActivities, transfers: liveTransfers }) : []), [draft, liveHotels, liveActivities, liveTransfers]);
  const errors = issues.filter((i) => i.level === 'error').length;
  const warns = issues.length - errors;
  const blocked = issues.length > 0;

  // ---- structural edits ----
  // Trip start (d.startDate) is FIXED until shiftStart changes it; every recompute
  // lays cities contiguously FROM that fixed date, so reorder/nights never move it.
  const applyNodes = (nextNodes) => editDraft((d) => ({ ...d, nodes: recompute(nextNodes, d.startDate) }));
  const nudgeNights = (id, delta) => applyNodes(draft.nodes.map((n) => (n.id === id ? { ...n, nights: Math.max(1, Math.min(60, (n.nights || 1) + delta)) } : n)));
  const shiftStart = (delta) => editDraft((d) => {
    const base = d.startDate ? toDT(d.startDate).plus({ days: delta }).toISO() : null;
    return { ...d, startDate: base, nodes: recompute(d.nodes, base) };
  });
  const moveTo = (from, to) => {
    if (from == null || to == null || from === to) return;
    editDraft((d) => {
      const arr = sortVisits(d.nodes); // base = exactly the rendered row order (indices match r.idx)
      if (isAnchor(arr[from])) return d;
      const [m] = arr.splice(from, 1);
      let t = to > from ? to - 1 : to;
      const lo = arr[0]?.kind === 'start' ? 1 : 0;
      const hi = arr[arr.length - 1]?.kind === 'end' ? arr.length - 1 : arr.length;
      t = Math.max(lo, Math.min(hi, t));
      arr.splice(t, 0, m);
      return { ...d, nodes: recompute(arr, d.startDate) };
    });
  };
  // Remove a city → confirm first. On confirm the city AND its attached bookings
  // leave the draft (the city goes to the tray; on save save_trip_edit deletes the
  // city + children). Bookings are stashed on the node so Restore brings them back.
  const removeCity = (id) => { const n = draft.nodes.find((x) => x.id === id); if (n && !isAnchor(n)) setConfirmDel(n); };
  const doRemoveCity = (id) => {
    editDraft((d) => {
      const node = d.nodes.find((n) => n.id === id); if (!node || isAnchor(node)) return d;
      // bookings stay in `content`; they're filtered out of conflicts via removedIds
      // and cascade-deleted on save (p_deletes.cities).
      return { ...d, nodes: recompute(d.nodes.filter((n) => n.id !== id), d.startDate), removed: [...d.removed, node] };
    });
    setConfirmDel(null);
  };
  const removeEndpoint = (id) => editDraft((d) => ({ ...d, nodes: recompute(d.nodes.filter((n) => n.id !== id), d.startDate), removed: [...d.removed, d.nodes.find((n) => n.id === id)].filter(Boolean) }));
  const restoreCity = (id) => editDraft((d) => {
    const node = d.removed.find((n) => n.id === id); if (!node) return d;
    const arr = d.nodes.slice();
    if (node.kind === 'start') arr.unshift(node);
    else if (node.kind === 'end') arr.push(node);
    else { const endIdx = arr.findIndex((n) => n.kind === 'end'); arr.splice(endIdx === -1 ? arr.length : endIdx, 0, node); }
    return { ...d, nodes: recompute(arr, d.startDate), removed: d.removed.filter((n) => n.id !== id) };
  });
  const addCity = (city, kind = 'transit') => {
    if ((kind === 'start' && draft.nodes.some((n) => n.kind === 'start')) || (kind === 'end' && draft.nodes.some((n) => n.kind === 'end'))) {
      toast({ description: kind === 'start' ? t('tse.start_already_set') : t('tse.end_already_set') });
      return;
    }
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
      return { ...d, nodes: recompute(arr, d.startDate) };
    });
  };
  const onPickCity = async (c, kind) => {
    setAdding(false);
    let tz = 'UTC';
    try { tz = (await getTimezone(c.latitude, c.longitude)) || 'UTC'; } catch { /* keep */ }
    addCity({ ...c, timezone: tz }, kind);
  };

  // ---- conflict / transfer dialogs (REAL app dialogs → write to DB → refetch) ----
  const openConflict = (c) => {
    if (c.hotelId) setViewEvent({ kind: 'hotel', id: c.hotelId, warning: c.message });
    else if (c.activityId) setViewEvent({ kind: 'activity', id: c.activityId, warning: c.message });
    else if (c.transferId) setViewEvent({ kind: 'transfer', id: c.transferId, warning: c.message });
    else toast({ description: `${c.message} ${t('tse.fix_hint_suffix')}` });
  };
  const openTransferRow = (a, b, t) => {
    if (t) {
      // Hierarchy guarantees ≤1 issue per transfer → show that real message.
      const issue = issues.find((i) => i.transferId === t.id);
      setViewEvent({ kind: 'transfer', id: t.id, warning: issue?.message || null });
      return;
    }
    setAddLeg({ fromVisit: a, toVisit: b });
  };

  const onSave = async () => {
    if (!draft || blocked || saving) return;
    setSaving(true);
    const isTmp = (id) => String(id).startsWith('tmp-');
    const p_nodes = draft.nodes.filter((n) => !isTmp(n.id)).map((n) => ({ id: n.id, start_datetime: n.start_datetime ?? null, end_datetime: n.end_datetime ?? null, position: n.position }));
    const p_cities_new = draft.nodes.filter((n) => isTmp(n.id)).map((n) => ({ tmp: n.id, city_name: n.city_name, country: n.country ?? null, country_code: n.country_code ?? null, latitude: n.latitude ?? null, longitude: n.longitude ?? null, timezone: n.timezone ?? null, external_city_id: n.external_city_id ?? null, kind: n.kind || 'transit', start_datetime: n.start_datetime ?? null, end_datetime: n.end_datetime ?? null, position: n.position }));
    // Bookings are edited/added via real dialogs (already in DB) - structure-only save.
    const p_edits = {};
    const p_deletes = { cities: (draft.removed || []).filter((n) => !isTmp(n.id)).map((n) => n.id) };
    const { error } = await supabase.rpc('save_trip_edit', { p_trip: tripId, p_nodes, p_cities_new, p_edits, p_deletes });
    setSaving(false);
    if (error) { alert(t('tse.err_save') + (error.message || error)); return; }
    acquiredRef.current = false;
    clearDraftStore();
    invalidateTripData(qc, tripId);
    nav(`/trip/${tripId}`);
  };

  // Persistent app-header - rendered in EVERY branch (loading / blocked / error /
  // ready) so it never blanks out while the lock RPC + queries resolve. The page
  // title (name · dates · nights) lives in the LEFT column, not here; the header
  // is the global app bar + the editor action buttons.
  //   Undo     = revert the last single action (step back).
  //   Отменить = discard ALL edits, release the lock, return to the timeline.
  //   Сброс    = discard all edits but STAY in the editor.
  const headerEl = (
    <header className="app-header">
      <button className="app-header__crumb-back" onClick={cancelEdit} title={t('tse.exit_editor')}>
        <Icon name="back" size={15} />
      </button>
      <div className="app-header__brand" onClick={cancelEdit} style={{ cursor: 'pointer' }}>
        <img src="/triplanio-logo.svg" alt="Triplanio" style={{ width: 28, height: 28, borderRadius: 7, flexShrink: 0 }} />
        <span className="app-header__brand-name">Triplanio</span>
      </div>
      <div className="app-header__crumb">
        <span className="app-header__crumb-sep">/</span>
        <div className="app-header__crumb-trip">
          <span style={{ fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '320px' }}>
            {trip?.title || '…'}
          </span>
        </div>
      </div>
      {draft && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          {blocked && <Badge variant="warm" icon="warning">{errors ? t('tse.errors_short', { n: errors }) : t('tse.warns_short', { n: warns })}</Badge>}
          <Btn variant="ghost" size="sm" icon="undo" onClick={undo} disabled={!canUndo} title={t('tse.step_back_title')}>{t('tse.step_back')}</Btn>
          <Btn variant="ghost" size="sm" icon="refresh" onClick={reset} disabled={!dirty} title={t('tse.reset_title')}>{t('tse.reset')}</Btn>
          <Btn variant="ghost" size="sm" icon="close" onClick={cancelEdit} title={t('tse.cancel_title')}>{t('tse.cancel')}</Btn>
          <Btn variant="primary" size="sm" icon="check" disabled={!dirty || blocked || saving} onClick={onSave}>{saving ? t('tse.saving') : t('common.save')}</Btn>
        </div>
      )}
      <HeaderActions user={user} isPro={accountPro} isDark={isDark} onToggleTheme={toggleTheme} />
    </header>
  );

  if (shellError) return <>{headerEl}<div style={{ padding: 40, textAlign: 'center' }}><div className="sev sev--error">{t('tse.err_load')}{String(shellError.message || shellError)}</div></div></>;
  if (lock === 'blocked' || lock === 'error') {
    return (
      <>{headerEl}
      <div style={{ maxWidth: 640, margin: '40px auto', padding: 16 }}>
        <div className={`sev sev--${lock === 'blocked' ? 'warning' : 'error'}`}>
          <span className="sev__icon"><Icon name="warning" size={16} /></span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>{lock === 'blocked' ? t('tse.locked_title') : t('tse.lock_err_title')}</div>
            <div style={{ fontSize: 12.5 }}>{lock === 'blocked' ? t('tse.locked_desc') : t('tse.lock_err_desc')}</div>
            <div style={{ marginTop: 12 }}><Btn variant="ghost" icon="back" onClick={() => nav(`/trip/${tripId}`)}>{t('tse.back_to_trip')}</Btn></div>
          </div>
        </div>
      </div>
      </>
    );
  }
  if (loadingShell || loadingContent || !draft || lock === 'acquiring') {
    return <>{headerEl}<div style={{ maxWidth: 1380, margin: '0 auto', padding: 16 }}><Skeleton w="40%" h={28} style={{ marginBottom: 18 }} /><Skeleton w="100%" h={120} style={{ marginBottom: 10 }} /><Skeleton w="100%" h={120} /></div></>;
  }

  const ordered = sortVisits(draft.nodes);
  const seq = ordered.filter((n) => !isAnchor(n));          // cities + waypoints, in order
  const cities = seq.filter((n) => n.kind === 'transit');   // stays only (for count/numbering)
  const startDate = seq[0]?.start_datetime;
  const endDate = seq[seq.length - 1]?.end_datetime;
  const totalNights = nightsBetween(startDate, endDate);
  const membersCount = content?.members?.length || 0;
  const cityConflicts = (id) => issues.filter((i) => i.cityId === id).length;
  const transferFor = (aId, bId) => liveTransfers.find((t) => t.from_city_visit_id === aId && t.to_city_visit_id === bId);
  // A transfer row is flagged (orange "не совпадает") when it has ANY conflict -   // date mismatch (D2), non-adjacent (D5) or dangling (D6).
  const transferMismatch = (t) => !!t && issues.some((i) => i.transferId === t.id);
  let stayNum = 0;

  // assemble rows: each node + the connector to the next node
  const rows = [];
  ordered.forEach((n, idx) => {
    rows.push({ kind: 'node', node: n, idx, stayNum: n.kind === 'transit' ? ++stayNum : null });
    const next = ordered[idx + 1];
    if (next) rows.push({ kind: 'leg', a: n, b: next, gap: idx + 1 }); // gap = insert position between a and b
  });
  const draggedName = dragIdx !== null ? (ordered[dragIdx]?.city_name || t('event.city')) : '';

  return (
    <div className="ts-screen" style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--surface)' }}>
    {headerEl}
    <div className="ts-grid" style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, overflow: 'hidden' }}>
        {/* LEFT - page title + cities (scrolling list) */}
        <div className="ts-col-left" style={{ minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0, borderRight: '1px solid var(--line)', background: 'var(--surface)' }}>
          {/* page title */}
          <div style={{ flexShrink: 0, padding: '16px 20px 14px', borderBottom: '1px solid var(--line-2)' }}>
            <div className="eyebrow" style={{ color: 'var(--brand)', marginBottom: 5 }}>{t('tse.section_eyebrow')}</div>
            <h1 style={{ fontSize: 22, lineHeight: 1.15, marginBottom: 6, letterSpacing: '-0.02em' }}>{trip?.title || '…'}</h1>
            <div className="muted num" style={{ fontSize: 12.5 }}>{fmtD(startDate, lang)} - {fmtD(endDate, lang)}{totalNights != null ? ` · ${totalNights} ${dayWord(totalNights, t)}` : ''} · {cities.length} {cities.length === 1 ? t('trip.cities_count_one') : t('trip.cities_count_many')}{membersCount > 0 ? ` · ${t('tse.members_short', { n: membersCount })}` : ''}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <span className="eyebrow" style={{ fontSize: 10 }}>{t('planner.trip_start')}</span>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 9, padding: 2 }}>
                <button className="ts-step" onClick={() => shiftStart(-1)} title={t('tse.start_earlier')}><Icon name="back" size={13} /></button>
                <span className="num" style={{ padding: '0 8px', fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtDW(startDate)}</span>
                <button className="ts-step" onClick={() => shiftStart(1)} title={t('tse.start_later')}><Icon name="chev" size={13} /></button>
              </div>
              <span className="muted" style={{ fontSize: 11 }}>{t('tse.moves_whole_trip')}</span>
            </div>
          </div>

          <div className="scrollbar-thin ts-leftscroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 20px 18px' }}>
          <div>
            {rows.map((r, i) => {
              const first = i === 0, last = i === rows.length - 1;
              if (r.kind === 'leg') {
                const t = transferFor(r.a.id, r.b.id);
                const transfer = <GridTransfer key={`leg-${r.a.id}-${r.b.id}`} a={r.a} b={r.b} t={t} mismatch={transferMismatch(t)} first={first} last={last}
                  onOpen={() => openTransferRow(r.a, r.b, t)} />;
                // While dragging, every leg is a drop target. The hovered gap
                // hides its transfer plate and shows a city-sized placeholder
                // marking exactly where the city lands.
                if (dragIdx === null) return transfer;
                const activeGap = overGap === r.gap;
                return (
                  <div key={`gap-${r.a.id}-${r.b.id}`}
                    onDragOver={(e) => { e.preventDefault(); setOverGap(r.gap); }}
                    onDrop={(e) => { e.preventDefault(); dropAt(r.gap); }}>
                    {activeGap ? <DropSlot label={draggedName} /> : transfer}
                  </div>
                );
              }
              const n = r.node;
              if (isAnchor(n)) return <GridEndpoint key={n.id} node={n} first={first} last={last} onRemove={() => removeEndpoint(n.id)} />;
              return <GridNode key={n.id} seg={n} stayNum={r.stayNum} first={n === cities[0]} firstRow={first} last={last}
                conflictCount={cityConflicts(n.id)}
                onNightsMinus={() => nudgeNights(n.id, -1)} onNightsPlus={() => nudgeNights(n.id, 1)}
                onShiftMinus={() => shiftStart(-1)} onShiftPlus={() => shiftStart(1)}
                onUp={r.idx > 0 && !isAnchor(ordered[r.idx - 1]) ? () => moveTo(r.idx, r.idx - 1) : null}
                onDown={r.idx < ordered.length - 1 && !isAnchor(ordered[r.idx + 1]) ? () => moveTo(r.idx, r.idx + 1) : null}
                onRemove={() => removeCity(n.id)}
                drag={{ dragging: dragIdx === r.idx,
                  onDragStart: () => setDragIdx(r.idx),
                  onDragOver: () => { if (dragIdx !== null && dragIdx !== r.idx) setOverGap(r.idx); }, // hovering a city = insert in the gap above it
                  onDrop: () => { if (dragIdx !== r.idx) dropAt(r.idx); else endDrag(); },
                  onDragEnd: endDrag }} />;
            })}
          </div>

          {dragIdx !== null && ordered[ordered.length - 1]?.kind !== 'end' && (
            <div onDragOver={(e) => { e.preventDefault(); setOverGap(ordered.length); }}
              onDrop={(e) => { e.preventDefault(); dropAt(ordered.length); }}
              style={{ height: 38, marginTop: 8, borderRadius: 10, border: '2px dashed ' + (overGap === ordered.length ? 'var(--brand)' : 'var(--line)'), background: overGap === ordered.length ? 'var(--brand-soft)' : 'transparent', display: 'grid', placeItems: 'center', color: overGap === ordered.length ? 'var(--brand)' : 'var(--muted)', fontSize: 12, fontWeight: 600 }}>
              {t('tse.move_to_end')}
            </div>
          )}
          <AddPointButton onOpen={() => setAdding(true)} />
          <RemovedTray removed={draft.removed} onRestore={restoreCity} />
          </div>{/* /ts-leftscroll */}
        </div>

        {/* RIGHT - map (top 70%) + warnings (bottom 30%), flush edge-to-edge,
            split by a divider, no gap/padding anywhere. Each scrolls on its own. */}
        <div className="ts-col-right" style={{ minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--surface)' }}>
          <div className="ts-map" style={{ flex: '7 1 0', minHeight: 0, overflow: 'hidden', borderBottom: '1px solid var(--line)' }}>
            <MapView visits={draft.nodes} transfers={liveTransfers} visitsById={Object.fromEntries(draft.nodes.map((v) => [v.id, v]))} showStartEnd colorScheme={typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'DARK' : 'LIGHT'} />
          </div>
          <div className="ts-warn" style={{ flex: '3 1 0', minHeight: 0, display: 'flex' }}>
            <WarningsPanel issues={issues} errors={errors} warns={warns} onOpen={openConflict} />
          </div>
        </div>
      </div>

      {viewEvent && (
        <SourceViewLoader
          kind={viewEvent.kind} id={viewEvent.id} open canEdit warning={viewEvent.warning}
          onOpenChange={(o) => { if (!o) { setViewEvent(null); qc.invalidateQueries({ queryKey: TRIP_CONTENT_KEY(tripId) }); } }}
        />
      )}
      {addLeg && (
        <EventEditDialog
          open kind="transfer" tripId={tripId} fromVisit={addLeg.fromVisit} toVisit={addLeg.toVisit}
          defaultCurrency={trip?.details?.main_currency || 'EUR'}
          onOpenChange={(o) => { if (!o) { setAddLeg(null); qc.invalidateQueries({ queryKey: TRIP_CONTENT_KEY(tripId) }); } }}
        />
      )}
      {adding && <AddPointDialog onPick={onPickCity} onClose={() => setAdding(false)} hasStart={ordered.some((n) => n.kind === 'start')} hasEnd={ordered.some((n) => n.kind === 'end')} />}
      {confirmDel && (
        <div onClick={() => setConfirmDel(null)} style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,.45)', backdropFilter: 'blur(4px)', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', overflow: 'hidden', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, width: 420, maxWidth: '100%', boxShadow: 'var(--shadow-pop)' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: 'var(--danger)' }} />
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '18px 18px 8px' }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--danger-soft)', color: 'var(--danger)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name="trash" size={17} /></div>
              <div style={{ flex: 1, minWidth: 0 }}><h2 style={{ fontSize: 17, marginBottom: 2 }}>{t('tse.delete_city_q', { city: confirmDel.city_name })}</h2></div>
              <button className="ts-step" onClick={() => setConfirmDel(null)}><Icon name="close" size={16} /></button>
            </div>
            <div style={{ padding: '0 18px 8px', fontSize: 13, lineHeight: 1.55, color: 'var(--ink-2)' }}>
              {t('tse.delete_city_desc')}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 18px 18px' }}>
              <Btn variant="ghost" onClick={() => setConfirmDel(null)}>{t('common.cancel')}</Btn>
              <Btn variant="danger-solid" icon="trash" onClick={() => doRemoveCity(confirmDel.id)}>{t('tse.delete_city')}</Btn>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .ts-step { border: none; background: transparent; border-radius: 8px; color: var(--ink-2); cursor: pointer; display: grid; place-items: center; width: 26px; height: 26px; }
        .ts-step:hover { background: var(--wash); }
        .ts-step:disabled { opacity: .3; cursor: default; }
        .ts-in { width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 9px; background: var(--surface); color: var(--ink); font-size: 13px; }
        @media (max-width: 1080px) {
          .ts-screen { height: auto !important; min-height: 100vh; overflow: visible !important; }
          .ts-grid { grid-template-columns: 1fr !important; overflow: visible !important; }
          .ts-leftscroll { overflow: visible !important; }
          .ts-map { flex: 0 0 340px !important; }
          .ts-warn { flex: 0 0 auto !important; min-height: 300px; }
        }
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
  const t = useT();
  if (!n) return null;
  return <span title={t('tse.conflicts_n', { n })} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 999, background: 'var(--warning-soft)', color: 'var(--warning)', fontSize: 11, fontWeight: 700 }}><Icon name="warning" size={10} /> {n}</span>;
}
function Acts({ onUp, onDown, onRemove }) {
  const t = useT();
  return <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
    <button className="ts-step" style={{ width: 23, height: 23 }} onClick={onUp || undefined} disabled={!onUp} title={t('tse.move_up')}><Icon name="chev" size={12} style={{ transform: 'rotate(-90deg)' }} /></button>
    <button className="ts-step" style={{ width: 23, height: 23 }} onClick={onDown || undefined} disabled={!onDown} title={t('tse.move_down')}><Icon name="chev" size={12} style={{ transform: 'rotate(90deg)' }} /></button>
    {onRemove && <button className="ts-step" style={{ width: 23, height: 23, color: 'var(--muted)' }} onClick={onRemove} title={t('tse.remove')}><Icon name="trash" size={12} /></button>}
  </div>;
}
function GCell({ label, iso, editable, onPlus }) {
  const t = useT();
  const { lang } = useI18n();
  return <div style={{ minWidth: 0 }}>
    <div style={{ fontSize: 8.5, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted-2)', fontWeight: 700 }}>{label}</div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <span className="num" style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtD(iso, lang)}</span>
      {editable ? <button className="ts-step" style={{ width: 16, height: 16, marginLeft: 1 }} onClick={onPlus} title={t('tse.start_later')}><Icon name="chev" size={9} /></button>
        : <span style={{ width: 16, height: 16, display: 'grid', placeItems: 'center', color: 'var(--muted-2)' }} title={t('tse.follows_prev')}><Icon name="lock" size={9} /></span>}
    </div>
  </div>;
}

function GridNode({ seg, stayNum, first, firstRow, last, conflictCount, onNightsMinus, onNightsPlus, onShiftMinus, onShiftPlus, onUp, onDown, onRemove, drag }) {
  const t = useT();
  const { lang } = useI18n();
  const m = metaOf(seg);
  const dragAttrs = {
    draggable: true,
    onDragStart: (e) => { e.dataTransfer.effectAllowed = 'move'; drag.onDragStart(); },
    onDragEnd: drag.onDragEnd,
    onDragOver: (e) => { e.preventDefault(); drag.onDragOver(); },
    onDrop: (e) => { e.preventDefault(); drag.onDrop(); },
  };
  if (seg.kind === 'waypoint') {
    return (
      <div {...dragAttrs} style={{ ...rowStyle(firstRow, last), display: 'grid', gridTemplateColumns: GCOLS, alignItems: 'center', gap: 9, padding: '9px 11px', background: `color-mix(in srgb, ${m.color} 5%, var(--surface))`, opacity: drag.dragging ? 0.4 : 1, transition: 'opacity .1s ease' }}>
        <span style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--surface)', border: '1.5px dashed ' + m.color, color: m.color, display: 'grid', placeItems: 'center', cursor: 'grab' }}><Icon name="arrowSwap" size={11} /></span>
        <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 13.5 }}>{m.flag}</span>
          <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{seg.city_name}</span>
          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--ev-transfer)', textTransform: 'uppercase', letterSpacing: '.05em', padding: '2px 6px', borderRadius: 999, background: 'var(--ev-transfer-soft)', whiteSpace: 'nowrap' }}>{t('tse.layover')}</span>
          <Conf n={conflictCount} />
        </div>
        <div style={{ gridColumn: '3 / 5', textAlign: 'center' }}>
          <div style={{ fontSize: 8.5, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted-2)', fontWeight: 700 }}>{t('tse.transit')}</div>
          <div className="num" style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtD(seg.start_datetime, lang)}</div>
        </div>
        <span style={{ textAlign: 'center', color: 'var(--muted-2)', fontSize: 12 }}>-</span>
        <Acts onUp={onUp} onDown={onDown} onRemove={onRemove} />
      </div>
    );
  }
  return (
    <div draggable onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; drag.onDragStart(); }} onDragEnd={drag.onDragEnd}
      onDragOver={(e) => { e.preventDefault(); drag.onDragOver(); }} onDrop={(e) => { e.preventDefault(); drag.onDrop(); }}
      style={{ ...rowStyle(firstRow, last), display: 'grid', gridTemplateColumns: GCOLS, alignItems: 'center', gap: 9, padding: '14px 11px', opacity: drag.dragging ? 0.4 : 1, transition: 'opacity .1s ease' }}>
      <span style={{ width: 24, height: 24, borderRadius: 6, background: m.color, color: 'white', fontSize: 11, fontWeight: 700, display: 'grid', placeItems: 'center', cursor: 'grab' }}>{stayNum}</span>
      <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ fontSize: 13.5 }}>{m.flag}</span>
        <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{seg.city_name}</span>
        {m.country && <span className="muted" style={{ fontSize: 10.5, whiteSpace: 'nowrap' }}>{m.country}</span>}
        <Conf n={conflictCount} />
      </div>
      <GCell label={t('tse.checkin')} iso={seg.start_datetime} editable={first} onMinus={onShiftMinus} onPlus={onShiftPlus} />
      <GCell label={t('tse.checkout')} iso={seg.end_datetime} editable onMinus={onNightsMinus} onPlus={onNightsPlus} />
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 1, background: 'var(--wash)', border: '1px solid var(--line-2)', borderRadius: 7, padding: 1 }}>
        <button className="ts-step" style={{ width: 20, height: 20 }} onClick={onNightsMinus} disabled={seg.nights <= 1}><Icon name="close" size={9} style={{ transform: 'rotate(45deg)' }} /></button>
        <span className="num" style={{ minWidth: 26, textAlign: 'center', fontSize: 11.5, fontWeight: 700 }}>{seg.nights}{t('planner.night_short')}</span>
        <button className="ts-step" style={{ width: 20, height: 20 }} onClick={onNightsPlus}><Icon name="plus" size={9} /></button>
      </div>
      <Acts onUp={onUp} onDown={onDown} onRemove={onRemove} />
    </div>
  );
}

// Empty city-sized slot shown at the hovered gap during drag - replaces the
// transfer plate there so it reads as "the dragged city drops in HERE".
function DropSlot({ label }) {
  const t = useT();
  return (
    <div style={{ height: 56, margin: '4px 0', borderRadius: 11, border: '2px dashed var(--brand)', background: 'var(--brand-soft)', display: 'flex', alignItems: 'center', gap: 9, padding: '0 14px', color: 'var(--brand)', pointerEvents: 'none' }}>
      <span style={{ width: 24, height: 24, borderRadius: 6, border: '2px dashed var(--brand)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name="plus" size={13} /></span>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 11.5, opacity: 0.75, marginLeft: 'auto' }}>{t('tse.lands_here')}</span>
    </div>
  );
}

function GridTransfer({ a, b, t, mismatch, first, last, onOpen }) {
  const tx = useT();
  const { lang } = useI18n();
  const sameCity = (a.external_city_id && b.external_city_id && a.external_city_id === b.external_city_id) || (a.city_name && a.city_name === b.city_name);
  if (sameCity && !t) {
    return <div style={{ ...rowStyle(first, last), padding: '5px 11px', fontSize: 11, color: 'var(--muted)', background: 'var(--wash)' }}>{tx('tse.same_city_no_transfer')}</div>;
  }
  if (!t) {
    return <button onClick={onOpen} style={{ ...rowStyle(first, last), display: 'flex', alignItems: 'center', gap: 8, padding: '6px 11px', width: '100%', textAlign: 'left', cursor: 'pointer', fontFamily: 'var(--font-body)', background: 'var(--wash)' }}>
      <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--surface)', border: '1.5px dashed var(--warning)', color: 'var(--warning)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name="plus" size={11} /></span>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--warning)' }}>{tx('tse.add_transfer')}</span>
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
      <span style={{ fontSize: 13, fontWeight: 700, color: fg, whiteSpace: 'nowrap' }}>{tx(meta.labelKey)}{mismatch ? tx('tse.mismatch_suffix') : ''}</span>
      <span className="num muted" style={{ fontSize: 10.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fmtD(t.start_datetime, lang)}{t.carrier ? ' · ' + t.carrier : ''}</span>
    </div>
    <div><div style={{ fontSize: 8.5, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted-2)', fontWeight: 700 }}>{tx('tse.dep_short')}</div><div className="num" style={{ fontSize: 12, fontWeight: 700, color: dep ? 'var(--ink)' : 'var(--muted-2)' }}>{dep || '-'}</div></div>
    <div><div style={{ fontSize: 8.5, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted-2)', fontWeight: 700 }}>{tx('tse.arr_short')}</div><div className="num" style={{ fontSize: 12, fontWeight: 700, color: arr ? 'var(--ink)' : 'var(--muted-2)' }}>{arr || '-'}</div></div>
    <span />
    <Icon name="chev" size={13} style={{ color: fg, justifySelf: 'end' }} />
  </button>;
}

function GridEndpoint({ node, first, last, onRemove }) {
  const t = useT();
  const isStart = node.kind === 'start';
  const accent = isStart ? 'var(--success)' : 'var(--warm, var(--brand))';
  const m = metaOf(node);
  return <div
    style={{ ...rowStyle(first, last), display: 'flex', alignItems: 'center', gap: 10, padding: '11px' }}>
    <span style={{ width: 24, height: 24, borderRadius: 6, background: 'color-mix(in srgb, ' + accent + ' 14%, transparent)', color: accent, display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name="flag" size={13} /></span>
    <span style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.09em', fontWeight: 700, color: accent, flexShrink: 0 }}>{isStart ? t('ai_plan.start') : t('ai_plan.end')}</span>
    <span style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0 }}>{m.flag} {node.city_name}</span>
    <span className="muted" style={{ fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>· {isStart ? t('tse.arrival_word') : t('tse.departure_word')}</span>
    <button className="ts-step" style={{ width: 24, height: 24, color: 'var(--muted)', marginLeft: 'auto', flexShrink: 0 }} onClick={onRemove} title={t('tse.remove')}><Icon name="close" size={13} /></button>
  </div>;
}

function AddPointButton({ onOpen }) {
  const t = useT();
  return <button onClick={onOpen} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', marginTop: 12, padding: '12px', borderRadius: 12, cursor: 'pointer', background: 'var(--brand-soft)', border: '1px solid var(--brand-soft-12, var(--line))', color: 'var(--brand)', fontSize: 13, fontWeight: 600 }}>
    <Icon name="plus" size={15} /> {t('tse.add_point_btn')}
  </button>;
}

const POINT_TYPES = [
  { id: 'transit', labelKey: 'event.city', icon: 'bed', subKey: 'tse.pt_transit_sub' },
  { id: 'waypoint', labelKey: 'tse.pt_waypoint', icon: 'arrowSwap', subKey: 'tse.pt_waypoint_sub' },
  { id: 'start', labelKey: 'ai_plan.start', icon: 'flag', subKey: 'tse.pt_start_sub' },
  { id: 'end', labelKey: 'ai_plan.end', icon: 'flag', subKey: 'tse.pt_end_sub' },
];
function AddPointDialog({ onPick, onClose, hasStart, hasEnd }) {
  const t = useT();
  const [type, setType] = useState('transit');
  const disabledFor = (id) => (id === 'start' && hasStart) || (id === 'end' && hasEnd);
  const meta = POINT_TYPES.find((p) => p.id === type);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 999, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', background: 'rgba(15,23,42,.45)', backdropFilter: 'blur(4px)', padding: '10vh 16px 16px' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative', overflow: 'hidden', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, width: 480, maxWidth: '100%', boxShadow: 'var(--shadow-pop)' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: 'var(--brand)' }} />
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '18px 18px 12px' }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--brand-soft)', color: 'var(--brand)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name="pin" size={17} /></div>
          <div style={{ flex: 1, minWidth: 0 }}><h2 style={{ fontSize: 17, marginBottom: 2 }}>{t('tse.add_point')}</h2><div className="muted" style={{ fontSize: 12 }}>{t('tse.add_point_hint')}</div></div>
          <button className="ts-step" onClick={onClose}><Icon name="close" size={16} /></button>
        </div>
        <div style={{ padding: '0 18px 18px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 7, marginBottom: 10 }}>
            {POINT_TYPES.map((pt) => {
              const dis = disabledFor(pt.id), active = type === pt.id;
              return <button key={pt.id} disabled={dis} onClick={() => setType(pt.id)} title={dis ? t('tse.already_set') : t(pt.subKey)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, padding: '11px 6px', borderRadius: 11, cursor: dis ? 'not-allowed' : 'pointer', background: active ? 'var(--brand-soft)' : 'var(--surface)', border: '1px solid ' + (active ? 'var(--brand)' : 'var(--line)'), color: dis ? 'var(--muted-2)' : active ? 'var(--brand)' : 'var(--ink-2)', opacity: dis ? 0.5 : 1 }}>
                <Icon name={pt.icon} size={17} /><span style={{ fontSize: 11.5, fontWeight: 600 }}>{t(pt.labelKey)}</span>
              </button>;
            })}
          </div>
          <div className="muted" style={{ fontSize: 11.5, marginBottom: 10 }}>{meta ? t(meta.subKey) : ''}</div>
          <CitySearch onSelect={(c) => onPick(c, type)} />
        </div>
      </div>
    </div>
  );
}

function RemovedTray({ removed, onRestore }) {
  const t = useT();
  if (!removed || removed.length === 0) return null;
  return <div style={{ marginTop: 14, padding: '11px 13px', borderRadius: 12, background: 'var(--wash)', border: '1px dashed var(--line)' }}>
    <div className="eyebrow" style={{ marginBottom: 8 }}>{t('tse.removed_from_route')}</div>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {removed.map((n) => <button key={n.id} onClick={() => onRestore(n.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 999, background: 'var(--surface)', border: '1px solid var(--line)', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>
        <Icon name="plus" size={12} style={{ color: 'var(--brand)' }} /> {flagEmoji(n.country_code)} {n.city_name}
      </button>)}
    </div>
  </div>;
}

// ---- warnings panel (yellow plates) ----
const PLATE_META = { hotel: { icon: 'bed', labelKey: 'event.type_hotel' }, transfer: { icon: 'train', labelKey: 'event.type_transfer' }, activity: { icon: 'spark', labelKey: 'event.type_activity' }, city: { icon: 'pin', labelKey: 'event.city' } };
function plateType(code) {
  if (code[0] === 'B') return 'hotel';
  if (code[0] === 'C') return 'activity';
  if (code[0] === 'D') return 'transfer';
  if (code === 'E1' || code === 'E3') return 'transfer';
  return 'city';
}
function WarningsPanel({ issues, errors, warns, onOpen }) {
  const t = useT();
  const has = issues.length > 0;
  return (
    <div style={{ flex: 1, width: '100%', minWidth: 0, background: 'var(--surface)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '10px 13px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 9, flexShrink: 0 }}>
        <div style={{ width: 26, height: 26, borderRadius: 7, background: has ? 'var(--warning-soft)' : 'var(--success-soft)', color: has ? 'var(--warning)' : 'var(--success)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name={has ? 'warning' : 'check'} size={15} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, fontFamily: 'var(--font-display)', letterSpacing: '-0.01em' }}>{t('tse.conflicts')}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{has ? t('tse.click_to_fix') : t('tse.all_consistent')}</div>
        </div>
        {has && <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
          {errors > 0 && <span style={{ padding: '3px 8px', borderRadius: 999, background: 'var(--danger-soft)', color: 'var(--danger)', fontSize: 11.5, fontWeight: 700 }}>{errors}</span>}
          {warns > 0 && <span style={{ padding: '3px 8px', borderRadius: 999, background: 'var(--warning-soft)', color: 'var(--warning)', fontSize: 11.5, fontWeight: 700 }}>{warns}</span>}
        </div>}
      </div>
      {!has ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24, color: 'var(--muted)' }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: 'var(--success-soft)', color: 'var(--success)', display: 'grid', placeItems: 'center', marginBottom: 14 }}><Icon name="check" size={26} /></div>
          <div style={{ fontWeight: 600, color: 'var(--ink)', fontSize: 15, marginBottom: 6 }}>{t('tse.no_conflicts')}</div>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, maxWidth: 250 }}>{t('tse.no_conflicts_desc')}</div>
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
  const t = useT();
  const type = plateType(c.code);
  const tm = PLATE_META[type];
  const isError = c.level === 'error';
  const stripe = isError ? 'var(--danger)' : 'var(--warning)';
  return (
    <button onClick={onClick} style={{ display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', fontFamily: 'var(--font-body)', flexShrink: 0, borderRadius: 9, border: '1px solid color-mix(in srgb, ' + stripe + ' 40%, transparent)', background: isError ? 'var(--danger-soft)' : 'var(--warning-soft)', padding: '7px 10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
        <span style={{ width: 20, height: 20, borderRadius: 6, background: 'color-mix(in srgb, ' + stripe + ' 22%, transparent)', color: stripe, display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name={tm.icon} size={12} /></span>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink)' }}>{t(tm.labelKey)}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: stripe }}>
          <span style={{ width: 4, height: 4, borderRadius: '50%', background: stripe }} />{isError ? t('tse.link_broken') : t('tse.mismatch')}
        </span>
        <span className="num" style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--muted-2)' }}>{c.code}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.45 }}>{c.message}</div>
    </button>
  );
}

// (ResolveModal removed - conflicts now open the real EventModal via SourceViewLoader,
//  and "Добавить переезд" opens the real EventEditDialog. TRIP_EDIT_MODE test #8/#9.)
