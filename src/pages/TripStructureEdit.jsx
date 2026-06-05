import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { supabase } from '@/api/supabaseClient';
import { TRIP_SHELL_KEY, TRIP_CONTENT_KEY, invalidateTripData } from '@/lib/trip-data';
import { sortVisits, validateTrip, primaryIssues } from '@/lib/validation';
import { Icon } from '../design/icons';
import { Btn, Badge, Skeleton } from '../design/index';
import CitySearch from '@/components/cities/CitySearch';
import { getTimezone } from '@/lib/geo';
import MapView from '@/components/views/MapView';
import EventSourcePanel from '@/components/common/EventSourcePanel';
import CityPanel from '@/components/common/CityPanel';
import ForkPartnerModal from '@/components/bookings/ForkPartnerModal';
import EventEditDialog from '@/components/common/EventEditDialog';
import { ConflictsPanel } from '@/components/common/ValidationUI';
import { useToast } from '@/components/ui/use-toast';
import HeaderActions from '@/components/HeaderActions';
import { useAuth } from '@/lib/AuthContext';
import { useTheme } from '@/lib/ThemeContext';
import { isProActive, useTripProStatus } from '@/lib/subscription';
import { useT, useI18n } from '@/lib/i18n/I18nContext';
import TripSidebar from '@/components/trips/TripSidebar';
import ShareDialog from '@/components/trips/ShareDialog';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel } from '@/components/ui/alert-dialog';

// =====================================================================
// TRIP STRUCTURE EDITOR - "Сетка" (grid) design from the trip-structure-*
// prototype, wired to the real id-based model (city_visits + position),
// validateTrip conflicts (unified engine), lock + save_trip_edit RPC. Live Google map.
// =====================================================================
const TKIND = { plane: { icon: 'plane', labelKey: 'tse.tk_plane' }, train: { icon: 'train', labelKey: 'transfer.train' }, bus: { icon: 'bus', labelKey: 'transfer.bus' }, car: { icon: 'car', labelKey: 'event.tk_car' }, ferry: { icon: 'ferry', labelKey: 'transfer.ferry' } };
const PALETTE = ['#2167e2', '#1d7a4a', '#c9603a', '#9c4ad9', '#c98a1a', '#3d8aa8', '#a83e6a', '#1f8a5b', '#4a6cd9'];
const toDT = (iso) => (iso ? DateTime.fromISO(iso, { zone: 'utc' }) : null);
const fmtD = (iso, loc = 'ru') => { const d = toDT(iso); return d ? d.setLocale(loc).toFormat('d MMM') : '-'; };
const fmtDW = (iso, loc = 'ru') => { const d = toDT(iso); return d ? d.setLocale(loc).toFormat('d MMM, ccc') : '-'; };
const nightsBetween = (a, b) => { const x = toDT(a), y = toDT(b); return x && y ? Math.max(0, Math.round(y.diff(x, 'days').days)) : null; };
// Calendar-day helpers. nights/gap are counted by DATE (not by the raw timestamp),
// so a checkout stored at 23:59 isn't rounded up to an extra night. This is what
// makes recompute idempotent on load: re-deriving dates from (nights, gap)
// reproduces exactly what's stored, so editor = timeline = DB.
const dayOf = (iso) => { const d = toDT(iso); return d ? d.startOf('day') : null; };
const dayDiff = (aIso, bIso) => { const a = dayOf(aIso), b = dayOf(bIso); return a && b ? Math.round(b.diff(a, 'days').days) : null; };
const dayWord = (n, t) => (n === 1 ? t('tse.day_one') : n >= 2 && n <= 4 ? t('tse.day_few') : t('tse.day_many'));
const flagEmoji = (cc) => (cc && cc.length === 2 ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 127397 + c.charCodeAt(0))) : '📍');
const isAnchor = (n) => n.kind === 'start' || n.kind === 'end';
// A city added in the editor but not yet saved carries a 'tmp-…' id (no real uuid
// until save_trip_edit inserts it). A LIVE transfer write to such a city fails the
// uuid type, so transfer creation is gated until the new city is saved.
const isTmpId = (id) => String(id || '').startsWith('tmp-');
const colorFor = (key) => { let h = 0; const s = String(key || ''); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return PALETTE[h % PALETTE.length]; };
const metaOf = (n) => ({ color: colorFor(n.external_city_id || n.city_name || n.id), flag: flagEmoji(n.country_code), country: n.country || '' });

// Single chain laid out from the trip-start day. Each node carries its own
// `nights` AND `gap` (= days between the previous node's checkout and this node's
// check-in, e.g. 1 for an overnight flight). One formula, no special cases:
//   start = previousEnd + gap;  end = start + nights;  cursor = end
// Consequences that fall out for free:
//   • move the start  → cursor moves → ALL nodes shift by the same delta;
//   • change a middle node's nights → its end moves → ALL nodes AFTER it shift by
//     the same delta, nodes before it are untouched;
//   • gaps (night transfers) are preserved, never invented or erased.
// Pure DATE math → idempotent: with unchanged (nights, gap) it reproduces the
// stored dates exactly, so opening the editor never moves anything.
function recompute(nodes, baseISO) {
  const firstTransit = nodes.find((n) => !isAnchor(n));
  let cursor = (baseISO ? toDT(baseISO) : toDT(firstTransit?.start_date)) || DateTime.utc();
  cursor = cursor.startOf('day');
  let seen = false; // the first non-anchor node anchors the trip start (gap forced 0)
  return nodes.map((n, i) => {
    if (isAnchor(n)) return { ...n, position: i };
    const gap = seen && Number.isFinite(n.gap) ? n.gap : 0;
    const startDay = cursor.plus({ days: gap });
    seen = true;
    if (n.kind === 'waypoint') { // single-date transit point - consumes no nights
      const d = startDay.toISODate();
      cursor = startDay;
      return { ...n, start_date: d, end_date: d, nights: null, gap, position: i };
    }
    const nights = Math.max(0, Number.isFinite(n.nights) ? n.nights : (dayDiff(n.start_date, n.end_date) ?? 1));
    const startD = startDay.toISODate();
    const endD = (nights > 0 ? startDay.plus({ days: nights }) : startDay).toISODate();
    cursor = startDay.plus({ days: nights });
    return { ...n, start_date: startD, end_date: endD, nights, gap, position: i };
  });
}

function buildDraft(shell, transfers = []) {
  const visits = sortVisits(shell?.cityVisits || []);
  // nights = stored date span. gap (days between the previous checkout and this
  // check-in) now comes from the INCOMING transfer's day_change flag: an overnight
  // / day-change transfer means this city starts +1 day after the previous one.
  // No incoming transfer or day_change=false → gap 0 (flush). Source of truth =
  // transfers.day_change; the stored city dates are just the baked-in result.
  const dayChangeByTo = new Map();
  for (const tr of (transfers || [])) {
    if (tr?.to_city_visit_id) dayChangeByTo.set(tr.to_city_visit_id, !!tr.day_change);
  }
  const nodes = visits.map((v, i) => {
    const base = { ...v, position: Number.isFinite(v.position) ? v.position : i };
    if (isAnchor(v)) return { ...base, nights: null, gap: null };
    const sd = dayOf(v.start_date), ed = dayOf(v.end_date);
    const isWp = v.kind === 'waypoint';
    const nights = isWp ? null : Math.max(0, (sd && ed ? Math.round(ed.diff(sd, 'days').days) : 1));
    const gap = dayChangeByTo.get(v.id) ? 1 : 0;
    return { ...base, nights, gap };
  });
  // Draft holds ONLY structure (nodes + removed cities + a FIXED trip start date).
  // Bookings are read LIVE from `content` (edits/adds via real dialogs → DB → refetch).
  const firstTransit = nodes.find((n) => !isAnchor(n));
  const startDate = firstTransit?.start_date || (shell?.trip?.start_date || null);
  return { nodes, removed: [], startDate };
}

export default function TripStructureEdit() {
  const { tripId } = useParams();
  const t = useT();
  const { lang } = useI18n();
  const nav = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const { isDark, toggle: toggleTheme } = useTheme();
  const accountPro = isProActive(user);
  const [draft, setDraft] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [lock, setLock] = useState('acquiring');
  const [saving, setSaving] = useState(false);
  // Left-column panel FSM (replaces the old view/add modals). null = the city
  // list; otherwise the left pane swaps in-place to a panel:
  //   { type:'event', kind, id, warning }    - view/edit/delete a booking (EventSourcePanel)
  //   { type:'createTransfer', fromVisit, toVisit } - create a transfer (EventEditDialog panel variant)
  const [leftPanel, setLeftPanel] = useState(null);
  const closeLeftPanel = () => setLeftPanel(null);
  // A11y: when an in-place left panel opens, move focus into it (its back button
  // if present) so keyboard/SR users land in the new context; Esc closes it.
  const leftPaneRef = useRef(null);
  useEffect(() => {
    if (!leftPanel || !leftPaneRef.current) return;
    const el = leftPaneRef.current.querySelector('.te-back, button, [tabindex]') || leftPaneRef.current;
    requestAnimationFrame(() => el?.focus?.({ preventScroll: true }));
  }, [leftPanel]);
  const [showWarn, setShowWarn] = useState(false); // collapsible warnings overlay on the map
  const [showMap, setShowMap] = useState(true); // hide the map to give the itinerary full width
  const [confirmDel, setConfirmDel] = useState(null); // city pending delete-confirm
  const [previewTransfer, setPreviewTransfer] = useState(null); // synthetic leg drawn on the map while creating a transfer
  const [pendingLeave, setPendingLeave] = useState(null); // navigation target awaiting the unsaved-changes prompt
  const [dragIdx, setDragIdx] = useState(null);   // ordered index of the city being dragged
  const [overGap, setOverGap] = useState(null);   // insertion position (index in `ordered`) the city would drop into
  const [undoStack, setUndoStack] = useState([]); // history of draft snapshots (JSON) for step-undo
  const endDrag = () => { setDragIdx(null); setOverGap(null); };
  const justDraggedRef = useRef(false); // suppress the click that fires right after a drag
  // FLIP refs: animate non-dragged rows smoothly to their new slot during drag.
  const rowElRefs = useRef(new Map());     // node id -> row element
  const prevRectsRef = useRef(new Map());  // node id -> top, captured just before a reorder
  const setRowRef = (id) => (el) => { if (el) rowElRefs.current.set(id, el); else rowElRefs.current.delete(id); };
  const captureRects = () => { const m = new Map(); rowElRefs.current.forEach((el, id) => { if (el) m.set(id, el.getBoundingClientRect().top); }); prevRectsRef.current = m; };
  // Pointer-drag state. dragInfoRef holds the LIVE gesture (id, where the row was
  // grabbed, whether it actually moved). liveRef mirrors render values the window
  // listeners need; dragHandlersRef holds the per-render move/end closures behind
  // two STABLE dispatchers so add/removeEventListener pair up correctly.
  const dragInfoRef = useRef(null);
  const liveRef = useRef({ ordered: [], displayNodes: [] });
  const dragHandlersRef = useRef({ move: () => {}, end: () => {} });
  const stableMove = useRef((e) => dragHandlersRef.current.move(e)).current;
  const stableEnd = useRef((e) => dragHandlersRef.current.end(e)).current;
  // FLIP: after the preview order changes, slide each row from where it WAS to
  // where it is now — the list rearranges smoothly. The lifted (dragged) row is
  // skipped: its transform follows the pointer and is managed inline.
  useLayoutEffect(() => {
    const prev = prevRectsRef.current;
    if (!prev || prev.size === 0) return;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { prevRectsRef.current = new Map(); return; }
    const draggedId = dragInfoRef.current?.id;
    rowElRefs.current.forEach((el, id) => {
      if (!el || id === draggedId) return;
      const prevTop = prev.get(id);
      if (prevTop == null) return;
      const dy = prevTop - el.getBoundingClientRect().top;
      if (Math.abs(dy) < 0.5) return;
      el.style.transition = 'none';
      el.style.transform = `translateY(${dy}px)`;
      el.getBoundingClientRect(); // force reflow so the next line animates
      el.style.transition = 'transform .26s cubic-bezier(0.34, 1.28, 0.5, 1)';
      el.style.transform = '';
    });
    prevRectsRef.current = new Map();
  }, [dragIdx, overGap]);
  const acquiredRef = React.useRef(false);
  const DRAFT_KEY = `ts-edit-${tripId}`;
  const clearDraftStore = () => { try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } };
  // Leave the editor for `to`: drop the draft and RELEASE THE EDIT LOCK immediately.
  const leaveNow = async (to) => {
    clearDraftStore();
    if (acquiredRef.current) { acquiredRef.current = false; try { await supabase.rpc('release_trip_lock', { p_trip: tripId }); } catch { /* ignore */ } }
    nav(typeof to === 'string' ? to : `/trip/${tripId}`);
  };
  // Guarded navigation away: prompt to save first if there are unsaved changes.
  const guardedLeave = (to) => { if (dirty) setPendingLeave(typeof to === 'string' ? to : `/trip/${tripId}`); else leaveNow(to); };
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
    staleTime: 30000, // reuse TripView's cached shell on entry → no reload flicker
  });
  const { data: content, isLoading: loadingContent } = useQuery({
    queryKey: TRIP_CONTENT_KEY(tripId),
    queryFn: async () => { const { data, error } = await supabase.functions.invoke('getTripDetails', { body: { tripId, include: ['content'] } }); if (error) throw error; return data; },
    enabled: !!tripId && !loadingShell,
  });

  // Build the draft SYNCHRONOUSLY during render (not in an effect) the moment
  // shell+content are available — they're cached from TripView, so the editor
  // paints on the very first render with no skeleton frame (no entry flicker).
  if (draft === null && shell && content) {
    if (!baseRef.current) baseRef.current = JSON.stringify(buildDraft(shell, content.transfers));
    let initial = null, initialDirty = false;
    try { const saved = sessionStorage.getItem(DRAFT_KEY); if (saved) { const p = JSON.parse(saved); if (p?.draft) { initial = p.draft; initialDirty = !!p.dirty; } } } catch { /* ignore */ }
    setDraft(initial || buildDraft(shell, content.transfers));
    if (initialDirty) setDirty(true);
  }

  useEffect(() => { if (draft && dirty) { try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ draft, dirty })); } catch { /* quota */ } } }, [draft, dirty, DRAFT_KEY]);

  // Cities created OUTSIDE the draft (layover waypoints, etc.) arrive via the shell
  // refetch — merge them into the draft so they appear without a page reload.
  useEffect(() => {
    if (!draft || !shell?.cityVisits) return;
    const known = new Set(draft.nodes.map((n) => n.id));
    const removed = new Set((draft.removed || []).map((n) => n.id));
    const missing = shell.cityVisits.filter((v) => v && !known.has(v.id) && !removed.has(v.id) && !String(v.id).startsWith('tmp-'));
    if (missing.length === 0) return;
    editDraft((d) => {
      const add = missing.map((v) => {
        const base = { ...v, position: Number.isFinite(v.position) ? v.position : 999 };
        if (isAnchor(v)) return { ...base, nights: null, gap: null };
        const sd = dayOf(v.start_date), ed = dayOf(v.end_date);
        const isWp = v.kind === 'waypoint';
        const nights = isWp ? null : Math.max(0, (sd && ed ? Math.round(ed.diff(sd, 'days').days) : 1));
        return { ...base, nights, gap: 0 };
      });
      return { ...d, nodes: recompute(sortVisits([...d.nodes, ...add]), d.startDate) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shell]);

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
  // Trip-level Pro for the shared sidebar's "upgrade" card — owner-aware, via the
  // same CACHED hook as TripView so the card doesn't re-flash on the edit boundary.
  const { isPro: tripIsPro, resolved: tripProResolved } = useTripProStatus(tripId, trip?.is_pro_trip);
  // Bookings are read LIVE from content. Exclude bookings of cities slated for
  // deletion (else they'd surface as orphans that block the very save that
  // cascade-deletes them).
  const removedIds = useMemo(() => new Set((draft?.removed || []).map((n) => n.id)), [draft]);
  const liveHotels = useMemo(() => (content?.hotels || []).filter((h) => !removedIds.has(h.city_visit_id)), [content, removedIds]);
  const liveActivities = useMemo(() => (content?.activities || []).filter((a) => !removedIds.has(a.city_visit_id)), [content, removedIds]);
  const liveTransfers = useMemo(() => (content?.transfers || []).filter((t) => !removedIds.has(t.from_city_visit_id) && !removedIds.has(t.to_city_visit_id)), [content, removedIds]);
  // While creating a transfer, draw a synthetic leg on the map (shaped by the
  // picked transport type) so the route appears instantly, before saving.
  const mapTransfers = useMemo(() => {
    if (!previewTransfer) return liveTransfers;
    const others = liveTransfers.filter((t) => !(t.from_city_visit_id === previewTransfer.from_city_visit_id && t.to_city_visit_id === previewTransfer.to_city_visit_id));
    return [...others, previewTransfer];
  }, [liveTransfers, previewTransfer]);
  useEffect(() => { if (!(leftPanel?.type === 'create' && leftPanel.kind === 'transfer')) setPreviewTransfer(null); }, [leftPanel]);
  // Open a create form straight away when arriving from a timeline "add manually"
  // (the warning → partner modal → manual). Intent travels in the route state.
  const createIntentRef = useRef(false);
  useEffect(() => {
    if (createIntentRef.current || !draft) return;
    const intent = location.state?.create;
    const editIntent = location.state?.edit;
    if (!intent && !editIntent) return;
    createIntentRef.current = true;
    const byId = (id) => draft.nodes.find((n) => n.id === id);
    if (intent?.kind === 'hotel') {
      const v = byId(intent.cityVisitId);
      if (v) setLeftPanel({ type: 'create', kind: 'hotel', visit: v });
    } else if (intent?.kind === 'transfer') {
      const fromVisit = byId(intent.fromId), toVisit = byId(intent.toId);
      if (fromVisit && toVisit) setLeftPanel({ type: 'create', kind: 'transfer', fromVisit, toVisit });
    } else if (editIntent?.kind && editIntent?.id) {
      // Edit-from-timeline: open the entity's panel straight into edit mode.
      setLeftPanel({ type: 'event', kind: editIntent.kind, id: editIntent.id, autoEdit: true });
    }
    nav(location.pathname + (location.search || ''), { replace: true, state: {} }); // consume the intent
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);
  // Native browser prompt on close/refresh while there are unsaved structure edits.
  useEffect(() => {
    const h = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);
  // Unified engine: validateTrip emits codes; primaryIssues collapses to <=1 per
  // entity (anti-pile). Adapt to the shape this screen already consumes
  // (resolved message + cityId/hotelId/activityId/transferId aliases + 'warn' level).
  const issues = useMemo(() => {
    if (!draft) return [];
    const raw = primaryIssues(validateTrip({ visits: draft.nodes, hotels: liveHotels, activities: liveActivities, transfers: liveTransfers }));
    return raw.map((i) => ({
      // All validation issues are advisory in the editor: nothing blocks Save.
      // Engine-level severity is collapsed to 'warn' so errors never gate saving
      // and the whole list renders as (orange) warnings.
      level: 'warn',
      code: i.code,
      message: t(`validation.${i.code}`, i.values),
      // raw refs for describeIssue/ConflictsPanel:
      entityKind: i.entityKind,
      entityId: i.entityId,
      values: i.values,
      // aliases consumed by openConflict / cityConflicts / transferMismatch:
      cityId: i.entityKind === 'city' ? i.entityId : undefined,
      hotelId: i.entityKind === 'hotel' ? i.entityId : undefined,
      activityId: i.entityKind === 'activity' ? i.entityId : undefined,
      transferId: i.entityKind === 'transfer' ? i.entityId : undefined,
      fromId: i.fromId,
      toId: i.toId,
    }));
  }, [draft, liveHotels, liveActivities, liveTransfers, t]);
  const errors = issues.filter((i) => i.level === 'error').length; // always 0 now (all issues are 'warn')
  const warns = issues.length - errors;
  // Validation NEVER blocks save anymore: every issue is a non-blocking warning.
  // Save is gated only by dirty/saving (and the trip lock, handled separately).
  const blocked = false;
  // Count of UNSAVED structural changes vs the loaded baseline (added/removed/
  // moved cities, changed nights/dates/overnight) — shown in the header.
  const changeCount = useMemo(() => {
    if (!draft || !dirty || !baseRef.current) return 0;
    let base; try { base = JSON.parse(baseRef.current); } catch { return 0; }
    const baseById = new Map((base.nodes || []).map((n) => [n.id, n]));
    let c = (draft.removed || []).filter((n) => !String(n.id).startsWith('tmp-')).length;
    for (const n of draft.nodes) {
      const b = baseById.get(n.id);
      if (!b) { c++; continue; }
      if (b.position !== n.position || b.start_date !== n.start_date || b.end_date !== n.end_date || (b.nights || 0) !== (n.nights || 0) || (b.gap || 0) !== (n.gap || 0)) c++;
    }
    return c;
  }, [draft, dirty]);

  // ---- structural edits ----
  // Trip start (d.startDate) is FIXED until shiftStart changes it. recompute chains
  // nodes from that date preserving each node's nights+gap, so editing one node only
  // moves the nodes after it; the start and earlier nodes never move.
  const applyNodes = (nextNodes) => editDraft((d) => ({ ...d, nodes: recompute(nextNodes, d.startDate) }));
  // Mirror the live transfers' day_change flag into the draft's city gaps. The
  // overnight toggle lives in the transfer panels and writes day_change LIVE; this
  // turns that flag into the date cascade (the destination city + every following
  // one shift ±1). buildDraft already seeds the gaps on load, so the signature
  // matches there and this fires ONLY on a real change (panel toggle/edit), marking
  // the structure dirty so the shifted dates get persisted on Save.
  const overnightSig = useMemo(
    () => (liveTransfers || []).filter((tr) => tr.day_change).map((tr) => tr.to_city_visit_id).sort().join(','),
    [liveTransfers],
  );
  useEffect(() => {
    if (!draft) return;
    const onSet = new Set(overnightSig ? overnightSig.split(',') : []);
    const firstId = sortVisits(draft.nodes).find((n) => !isAnchor(n))?.id; // recompute pins this city's gap to 0
    let changed = false;
    const next = draft.nodes.map((n) => {
      if (isAnchor(n)) return n;
      const want = (onSet.has(n.id) && n.id !== firstId) ? 1 : 0;
      if ((n.gap || 0) !== want) { changed = true; return { ...n, gap: want }; }
      return n;
    });
    if (changed) applyNodes(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overnightSig]);
  // Nights 0..60. Hitting 0 turns a city into a waypoint (a 0-night transit
  // stop); raising a waypoint above 0 turns it back into a transit city.
  const nudgeNights = (id, delta) => applyNodes(draft.nodes.map((n) => {
    if (n.id !== id) return n;
    const cur = n.kind === 'waypoint' ? 0 : (n.nights || 0);
    const next = Math.max(0, Math.min(60, cur + delta));
    return next === 0 ? { ...n, kind: 'waypoint', nights: 0 } : { ...n, kind: 'transit', nights: next };
  }));
  const shiftStart = (delta) => editDraft((d) => {
    const base = d.startDate ? toDT(d.startDate).plus({ days: delta }).toISO() : null;
    return { ...d, startDate: base, nodes: recompute(d.nodes, base) };
  });
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
      nights: kind === 'transit' ? 2 : null, gap: 0, start_date: null, end_date: null,
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
    closeLeftPanel();
    let tz = 'UTC';
    try { tz = (await getTimezone(c.latitude, c.longitude)) || 'UTC'; } catch { /* keep */ }
    addCity({ ...c, timezone: tz }, kind);
  };

  // ---- conflict / transfer dialogs (REAL app dialogs → write to DB → refetch) ----
  const openConflict = (c) => {
    if (c.hotelId) setLeftPanel({ type: 'event', kind: 'hotel', id: c.hotelId, warning: c.message });
    else if (c.activityId) setLeftPanel({ type: 'event', kind: 'activity', id: c.activityId, warning: c.message });
    else if (c.transferId) setLeftPanel({ type: 'event', kind: 'transfer', id: c.transferId, warning: c.message });
    else toast({ description: `${c.message} ${t('tse.fix_hint_suffix')}` });
  };
  const openTransferRow = (a, b, tr) => {
    if (tr) {
      // Hierarchy guarantees ≤1 issue per transfer → show that real message.
      const issue = issues.find((i) => i.transferId === tr.id);
      setLeftPanel({ type: 'event', kind: 'transfer', id: tr.id, warning: issue?.message || null });
      return;
    }
    if (isTmpId(a?.id) || isTmpId(b?.id)) { toast({ description: t('tse.save_new_city_first') }); return; }
    setLeftPanel({ type: 'pick', kind: 'transfer', fromVisit: a, toVisit: b });
  };

  const onSave = async (dest) => {
    if (!draft || blocked || saving) return;
    setSaving(true);
    const isTmp = (id) => String(id).startsWith('tmp-');
    const p_nodes = draft.nodes.filter((n) => !isTmp(n.id)).map((n) => ({ id: n.id, start_date: n.start_date ?? null, end_date: n.end_date ?? null, position: n.position, kind: n.kind || 'transit' }));
    const p_cities_new = draft.nodes.filter((n) => isTmp(n.id)).map((n) => ({ tmp: n.id, city_name: n.city_name, country: n.country ?? null, country_code: n.country_code ?? null, latitude: n.latitude ?? null, longitude: n.longitude ?? null, timezone: n.timezone ?? null, external_city_id: n.external_city_id ?? null, kind: n.kind || 'transit', start_date: n.start_date ?? null, end_date: n.end_date ?? null, position: n.position }));
    // Bookings (incl. each transfer's day_change) are written LIVE via the panels;
    // the structure save only persists the recomputed city dates + positions.
    const p_edits = {};
    const p_deletes = { cities: (draft.removed || []).filter((n) => !isTmp(n.id)).map((n) => n.id) };
    const { error } = await supabase.rpc('save_trip_edit', { p_trip: tripId, p_nodes, p_cities_new, p_edits, p_deletes });
    if (error) { setSaving(false); alert(t('tse.err_save') + (error.message || error)); return; }
    clearDraftStore();
    invalidateTripData(qc, tripId);
    setPendingLeave(null);
    // Save + LEAVE (from the unsaved-changes prompt): release the lock and navigate.
    if (typeof dest === 'string') {
      acquiredRef.current = false;
      setSaving(false);
      nav(dest);
      return;
    }
    // Save + STAY (header button): save_trip_edit released the lock, so re-acquire
    // it, then rebuild the draft from the freshly-saved server state (new cities get
    // their real ids; the diff baseline + dirty reset to "saved").
    try { const lr = await supabase.rpc('acquire_trip_lock', { p_trip: tripId }); acquiredRef.current = !!lr?.data?.ok; } catch { /* keep editing best-effort */ }
    try { await Promise.all([qc.refetchQueries({ queryKey: TRIP_SHELL_KEY(tripId) }), qc.refetchQueries({ queryKey: TRIP_CONTENT_KEY(tripId) })]); } catch { /* ignore */ }
    baseRef.current = null;
    setUndoStack([]);
    setDirty(false);
    setDraft(null); // → synchronous rebuild from fresh shell/content on next render
    setSaving(false);
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
      <button className="app-header__crumb-back" onClick={() => guardedLeave(`/trip/${tripId}`)} title={t('tse.exit_editor')}>
        <Icon name="back" size={15} />
      </button>
      <div className="app-header__brand" onClick={() => guardedLeave('/trips')} style={{ cursor: 'pointer' }}>
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
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0, marginLeft: 'auto', paddingLeft: 14, borderLeft: '1px solid var(--line)' }}>
          {changeCount > 0 && <Badge variant="brand" icon="edit">{t('tse.unsaved_count', { n: changeCount })}</Badge>}
          <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <Btn variant="quiet" size="sm" icon="undo" onClick={undo} disabled={!canUndo} title={t('tse.step_back_title')}>{t('tse.step_back')}</Btn>
            <Btn variant="quiet" size="sm" icon="refresh" onClick={reset} disabled={!dirty} title={t('tse.reset_title')}>{t('tse.reset')}</Btn>
            <Btn variant="quiet" size="sm" icon="map" onClick={() => setShowMap((v) => !v)} className={showMap ? 'is-on' : ''} title={showMap ? t('tse.hide_map') : t('tse.show_map')} ariaLabel={showMap ? t('tse.hide_map') : t('tse.show_map')} ariaPressed={showMap} />
          </div>
          <Btn variant="primary" size="sm" icon="check" disabled={!dirty || blocked || saving} onClick={() => onSave()}>{saving ? t('tse.saving') : t('common.save')}</Btn>
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
            <div style={{ fontSize: 'var(--fs-meta)' }}>{lock === 'blocked' ? t('tse.locked_desc') : t('tse.lock_err_desc')}</div>
            <div style={{ marginTop: 12 }}><Btn variant="ghost" icon="back" onClick={() => nav(`/trip/${tripId}`)}>{t('tse.back_to_trip')}</Btn></div>
          </div>
        </div>
      </div>
      </>
    );
  }
  // Don't gate the whole screen on the lock RPC — shell/content are cached (shared
  // with TripView) so the editor paints instantly; the lock resolves in the
  // background (and the blocked/error branch above takes over only if it fails).
  if (loadingShell || loadingContent || !draft) {
    return <>{headerEl}<div style={{ maxWidth: 1380, margin: '0 auto', padding: 16 }}><Skeleton w="40%" h={28} style={{ marginBottom: 18 }} /><Skeleton w="100%" h={120} style={{ marginBottom: 10 }} /><Skeleton w="100%" h={120} /></div></>;
  }

  const ordered = sortVisits(draft.nodes);
  const seq = ordered.filter((n) => !isAnchor(n));          // cities + waypoints, in order
  const cities = seq.filter((n) => n.kind === 'transit');   // stays only (for count/numbering)
  const startDate = seq[0]?.start_date;
  const endDate = seq[seq.length - 1]?.end_date;
  const totalNights = nightsBetween(startDate, endDate);
  const membersCount = content?.members?.length || 0;
  const myMember = (content?.members || []).find((m) => m.user_id === user?.id);
  const myRole = myMember?.role || (trip?.created_by === user?.id ? 'owner' : 'viewer');
  const isOwner = myRole === 'owner';
  const cityConflicts = (id) => issues.filter((i) => i.cityId === id).length;
  const transferFor = (aId, bId) => liveTransfers.find((t) => t.from_city_visit_id === aId && t.to_city_visit_id === bId);
  // A transfer row is flagged (orange "не совпадает") when it has ANY conflict -   // date mismatch (D2), non-adjacent (D5) or dangling (D6).
  const transferMismatch = (t) => !!t && issues.some((i) => i.transferId === t.id);
  // booking lookups for the inline list cells + city panel
  const hotelFor = (id) => liveHotels.find((h) => h.city_visit_id === id);
  // Multiple hotels per city are allowed (parity with activities); the city
  // panel lists them all, while the compact grid cell still shows the first.
  const hotelsFor = (id) => liveHotels.filter((h) => h.city_visit_id === id);
  const actsFor = (id) => liveActivities.filter((a) => a.city_visit_id === id);
  const hotelWarnId = (hid) => !!hid && issues.some((i) => i.hotelId === hid);
  const actWarnId = (aid) => !!aid && issues.some((i) => i.activityId === aid);
  const arrivalFor = (id) => liveTransfers.find((t) => t.to_city_visit_id === id);
  const departureFor = (id) => liveTransfers.find((t) => t.from_city_visit_id === id);
  // panel navigation
  const openCity = (id) => { if (justDraggedRef.current) { justDraggedRef.current = false; return; } setLeftPanel({ type: 'city', id }); };
  const openEvent = (kind, id) => setLeftPanel({ type: 'event', kind, id, warning: (issues.find((i) => i[`${kind}Id`] === id)?.message) || null });
  // hotel/transfer have partner offers → show the PickPanel ("Развилка") first;
  // activities have none → straight to the form.
  const createBooking = (kind, node) => setLeftPanel(kind === 'hotel' ? { type: 'pick', kind, visit: node } : { type: 'create', kind, visit: node });
  // Stay numbering (only nights-cities are numbered).
  const stayNumById = {};
  { let sc = 0; ordered.forEach((n) => { if (n.kind === 'transit') stayNumById[n.id] = ++sc; }); }
  // Live preview order while dragging: the dragged node is shown already moved to
  // the hovered slot (FLIP animates the shuffle). Anchors stay pinned at the ends.
  const displayNodes = (() => {
    if (dragIdx == null || overGap == null || overGap === dragIdx || overGap === dragIdx + 1) return ordered;
    const arr = ordered.slice();
    const [m] = arr.splice(dragIdx, 1);
    let t = overGap > dragIdx ? overGap - 1 : overGap;
    const lo = arr[0]?.kind === 'start' ? 1 : 0;
    const hi = arr[arr.length - 1]?.kind === 'end' ? arr.length - 1 : arr.length;
    t = Math.max(lo, Math.min(hi, t));
    arr.splice(t, 0, m);
    return arr;
  })();
  // Keyboard reorder (a11y): move a city one slot up/down, clamped inside the
  // start/end anchors. Same applyNodes path as drag, so dates recompute identically.
  const moveNodeById = (id, dir) => {
    const idx = ordered.findIndex((n) => n.id === id);
    if (idx < 0 || isAnchor(ordered[idx])) return;
    const arr = ordered.slice();
    const [node] = arr.splice(idx, 1);
    const lo = arr[0]?.kind === 'start' ? 1 : 0;
    const hi = arr[arr.length - 1]?.kind === 'end' ? arr.length - 1 : arr.length;
    const j = Math.max(lo, Math.min(hi, idx + dir));
    if (j === idx) return;
    arr.splice(j, 0, node);
    captureRects();
    applyNodes(arr);
  };
  // Arm a pointer drag from ANYWHERE on the row. It becomes a real drag only once
  // the pointer crosses a small threshold, so a plain tap still opens the city.
  // Presses on inner controls (steppers, booking cells, links) are ignored.
  const armDrag = (e, dIdx, nodeId) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Touch: only the grip starts a drag, so swiping a card still scrolls the list.
    // Mouse: the whole card is draggable.
    if (e.pointerType !== 'mouse' && !e.target?.closest?.('.te-grip')) return;
    if (e.target?.closest?.('.te-stepper, .te-step, .te-cellbtn, .te-actchip, .te-hotelicon, .te-addmini, a, input, select, textarea')) return;
    const rowEl = rowElRefs.current.get(nodeId);
    if (!rowEl) return;
    const rect = rowEl.getBoundingClientRect();
    dragInfoRef.current = { id: nodeId, dIdx, startX: e.clientX, startY: e.clientY, grabOffset: e.clientY - rect.top, ty: 0, activated: false, lastTarget: null };
    window.addEventListener('pointermove', stableMove);
    window.addEventListener('pointerup', stableEnd, { once: true });
    window.addEventListener('pointercancel', stableEnd, { once: true });
  };
  // Per-render move/end closures (read live values), reached via the stable
  // dispatchers above so the window listeners pair up across re-renders.
  dragHandlersRef.current.move = (e) => {
    const info = dragInfoRef.current; if (!info) return;
    if (!info.activated) { // promote arm → real drag once past the threshold
      if (Math.hypot(e.clientX - info.startX, e.clientY - info.startY) < 5) return;
      info.activated = true;
      setDragIdx(info.dIdx); setOverGap(null);
      document.body.style.userSelect = 'none';
    }
    const rowEl = rowElRefs.current.get(info.id);
    if (rowEl) {
      const naturalTop = rowEl.getBoundingClientRect().top - info.ty;
      info.ty = (e.clientY - info.grabOffset) - naturalTop;
      rowEl.style.transition = 'none';
      rowEl.style.transform = `translateY(${info.ty}px) scale(1.015)`;
    }
    // Hit-test: first row (excluding the lifted one) whose midpoint is below the
    // pointer = insertion gap; below all → move-to-end (ordered.length).
    const ord = liveRef.current.ordered || [];
    let target = ord.length;
    for (let i = 0; i < ord.length; i++) {
      const nd = ord[i]; if (nd.id === info.id) continue;
      const el = rowElRefs.current.get(nd.id); if (!el) continue;
      const r = el.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { target = i; break; }
    }
    if (target !== info.lastTarget) { info.lastTarget = target; captureRects(); setOverGap(target); }
  };
  dragHandlersRef.current.end = () => {
    window.removeEventListener('pointermove', stableMove);
    document.body.style.userSelect = '';
    const info = dragInfoRef.current;
    if (!info || !info.activated) { // a tap, not a drag → let the row click open the city
      dragInfoRef.current = null;
      return;
    }
    // A real drag happened → suppress the click that fires after pointerup, then commit.
    justDraggedRef.current = true;
    setTimeout(() => { justDraggedRef.current = false; }, 60);
    const rowEl = rowElRefs.current.get(info.id);
    const order = (liveRef.current.displayNodes || []).map((n) => n.id);
    if (rowEl) { // spring the lifted row from its pointer position into its slot
      rowEl.style.transition = 'transform .44s cubic-bezier(0.34, 1.3, 0.5, 1)';
      rowEl.style.transform = 'translateY(0) scale(1)';
    }
    // Commit AFTER the settle so the final DOM order lands without a visible jump.
    setTimeout(() => {
      if (dragInfoRef.current !== info) return;
      editDraft((d) => {
        const byId = new Map(d.nodes.map((n) => [n.id, n]));
        const nextNodes = order.map((id) => byId.get(id)).filter(Boolean);
        return { ...d, nodes: recompute(nextNodes, d.startDate) };
      });
      if (rowEl) { rowEl.style.transition = ''; rowEl.style.transform = ''; }
      dragInfoRef.current = null;
      endDrag();
    }, 230);
  };
  // Mirror live render values for the window listeners (they can't close over
  // post-early-return locals directly).
  liveRef.current = { ordered, displayNodes };
  // Transfers whose from/to cities are NOT adjacent in the route (or dangle on a
  // removed city) — shown in the "out of plan" tray instead of a connector.
  const adjPairs = new Set();
  for (let k = 0; k < ordered.length - 1; k++) adjPairs.add(`${ordered[k].id}>${ordered[k + 1].id}`);
  const outOfPlanTransfers = liveTransfers.filter((tr) => !adjPairs.has(`${tr.from_city_visit_id}>${tr.to_city_visit_id}`));
  const nodeName = (id) => draft.nodes.find((n) => n.id === id)?.city_name || '?';

  // Left-column panel (in-place, replaces the old modals). null → city list.
  let leftPanelEl = null;
  if (leftPanel?.type === 'cityadd') {
    leftPanelEl = (
      <CityAddPanel
        onPick={onPickCity} onBack={closeLeftPanel}
        hasStart={ordered.some((n) => n.kind === 'start')} hasEnd={ordered.some((n) => n.kind === 'end')}
      />
    );
  } else if (leftPanel?.type === 'event') {
    leftPanelEl = (
      <EventSourcePanel
        kind={leftPanel.kind} id={leftPanel.id} warning={leftPanel.warning}
        autoEdit={leftPanel.autoEdit} canEdit onClose={closeLeftPanel}
      />
    );
  } else if (leftPanel?.type === 'pick') {
    leftPanelEl = (
      <ForkPartnerModal
        open variant="panel" type={leftPanel.kind} tripId={tripId} trip={trip}
        visit={leftPanel.visit} fromVisit={leftPanel.fromVisit} toVisit={leftPanel.toVisit}
        onManual={() => setLeftPanel({ type: 'create', kind: leftPanel.kind, visit: leftPanel.visit, fromVisit: leftPanel.fromVisit, toVisit: leftPanel.toVisit })}
        onOpenChange={(o) => { if (!o) closeLeftPanel(); }}
      />
    );
  } else if (leftPanel?.type === 'create') {
    leftPanelEl = (
      <EventEditDialog
        open variant="panel" kind={leftPanel.kind} tripId={tripId}
        visit={leftPanel.visit} fromVisit={leftPanel.fromVisit} toVisit={leftPanel.toVisit}
        defaultCurrency={trip?.details?.main_currency || 'EUR'}
        onPreviewTransfer={setPreviewTransfer}
        onOpenChange={(o) => { if (!o) { setPreviewTransfer(null); closeLeftPanel(); qc.invalidateQueries({ queryKey: TRIP_CONTENT_KEY(tripId) }); } }}
      />
    );
  } else if (leftPanel?.type === 'city') {
    const node = ordered.find((n) => n.id === leftPanel.id);
    if (!node) { leftPanelEl = null; }
    else {
      const idx = ordered.indexOf(node);
      const prev = ordered.slice(0, idx).reverse().find((n) => !isAnchor(n) || n.kind === 'start');
      const next = ordered.slice(idx + 1).find((n) => !isAnchor(n) || n.kind === 'end');
      leftPanelEl = (
        <CityPanel
          node={node} meta={metaOf(node)}
          hotels={hotelsFor(node.id)} acts={actsFor(node.id)}
          arrival={arrivalFor(node.id)} departure={departureFor(node.id)}
          arrivalWarn={transferMismatch(arrivalFor(node.id))} departureWarn={transferMismatch(departureFor(node.id))}
          prevCity={prev?.city_name} nextCity={next?.city_name}
          isHotelWarn={(h) => hotelWarnId(h?.id)} isActWarn={(a) => actWarnId(a.id)}
          onBack={closeLeftPanel}
          onRemove={() => { closeLeftPanel(); removeCity(node.id); }}
          onNightsMinus={() => nudgeNights(node.id, -1)} onNightsPlus={() => nudgeNights(node.id, 1)}
          onOpenHotel={(id) => openEvent('hotel', id)} onAddHotel={() => createBooking('hotel', node)}
          onOpenActivity={(id) => openEvent('activity', id)} onAddActivity={() => createBooking('activity', node)}
          onOpenTransfer={(tr) => openEvent('transfer', tr.id)}
          onAddArrival={() => { if (!prev) return; if (isTmpId(prev.id) || isTmpId(node.id)) { toast({ description: t('tse.save_new_city_first') }); return; } setLeftPanel({ type: 'pick', kind: 'transfer', fromVisit: prev, toVisit: node }); }}
          onAddDeparture={() => { if (!next) return; if (isTmpId(node.id) || isTmpId(next.id)) { toast({ description: t('tse.save_new_city_first') }); return; } setLeftPanel({ type: 'pick', kind: 'transfer', fromVisit: node, toVisit: next }); }}
        />
      );
    }
  }

  // Map camera focus following the open panel: city/hotel/activity → that city;
  // transfer → both cities. Falsy → whole-route auto-fit stays in charge.
  const coordOf = (n) => (n && n.latitude != null && n.longitude != null ? [n.longitude, n.latitude] : null);
  const byId = (id) => draft.nodes.find((n) => n.id === id);
  let mapFocus = null;
  if (leftPanel?.type === 'city') {
    const p = coordOf(byId(leftPanel.id)); if (p) mapFocus = [p];
  } else if (leftPanel?.type === 'event') {
    if (leftPanel.kind === 'transfer') {
      const tr = liveTransfers.find((x) => x.id === leftPanel.id);
      if (tr) mapFocus = [coordOf(byId(tr.from_city_visit_id)), coordOf(byId(tr.to_city_visit_id))].filter(Boolean);
    } else {
      const e = (leftPanel.kind === 'hotel' ? liveHotels : liveActivities).find((x) => x.id === leftPanel.id);
      const p = e && coordOf(byId(e.city_visit_id)); if (p) mapFocus = [p];
    }
  } else if (leftPanel?.type === 'create' || leftPanel?.type === 'pick') {
    if (leftPanel.kind === 'transfer') mapFocus = [coordOf(leftPanel.fromVisit), coordOf(leftPanel.toVisit)].filter(Boolean);
    else { const p = coordOf(leftPanel.visit); if (p) mapFocus = [p]; }
  }
  if (mapFocus && mapFocus.length === 0) mapFocus = null;
  // Key the left pane on its identity so React remounts it on panel change →
  // the .te-panefade entry animation replays.
  const panelKey = leftPanel ? `${leftPanel.type}:${leftPanel.id || leftPanel.kind || ''}` : 'list';

  return (
    <div className="ts-screen" style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--surface)' }}>
    {headerEl}
    <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
      <div style={{ flex: '0 0 56px', minWidth: 0, position: 'relative', minHeight: 0 }}>
        <TripSidebar
          tripId={tripId} trip={trip} isEditScreen collapsed
          onNavigate={(id) => guardedLeave(`/trip/${tripId}?lens=${id}`)}
          isPro={tripIsPro} proResolved={tripProResolved} isOwner={isOwner} myRole={myRole}
          onUpgrade={() => nav(`/pro?tripId=${tripId}`)}
          onProInfo={() => nav(`/pro?tripId=${tripId}`)}
          onShare={() => window.__openModal?.(<ShareDialog trip={trip} />)}
        />
      </div>
      <div className="ts-grid" style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'grid', gridTemplateColumns: showMap ? 'minmax(0, 60fr) minmax(0, 40fr)' : '1fr', gap: 0, overflow: 'hidden' }}>
        {/* LEFT - page title + cities (scrolling list) */}
        <div className="ts-col-left" style={{ minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0, borderRight: '1px solid var(--line)', background: 'var(--surface)' }}>
          <div key={panelKey} ref={leftPaneRef} tabIndex={-1} onKeyDown={leftPanel ? (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeLeftPanel(); } } : undefined} className="te-panefade" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', outline: 'none' }}>
          {leftPanelEl || (<>
          {/* page title */}
          <div style={{ flexShrink: 0, padding: '16px 20px 14px', borderBottom: '1px solid var(--line-2)' }}>
            <div className="eyebrow" style={{ color: 'var(--brand)', marginBottom: 5 }}>{t('tse.section_eyebrow')}</div>
            <h1 style={{ fontSize: 'var(--fs-title)', lineHeight: 1.2, marginBottom: 6, letterSpacing: '-0.02em' }}>{trip?.title || '…'}</h1>
            <div className="muted num" style={{ fontSize: 'var(--fs-meta)' }}>{fmtD(startDate, lang)} - {fmtD(endDate, lang)}{totalNights != null ? ` · ${totalNights} ${dayWord(totalNights, t)}` : ''} · {cities.length} {cities.length === 1 ? t('trip.cities_count_one') : t('trip.cities_count_many')}{membersCount > 0 ? ` · ${t('tse.members_short', { n: membersCount })}` : ''}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <span className="eyebrow" style={{ fontSize: 'var(--fs-micro)' }}>{t('planner.trip_start')}</span>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 9, padding: 2 }}>
                <button className="ts-step" onClick={() => shiftStart(-1)} title={t('tse.start_earlier')}><Icon name="back" size={13} /></button>
                <span className="num" style={{ padding: '0 8px', fontSize: 'var(--fs-meta)', fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtDW(startDate)}</span>
                <button className="ts-step" onClick={() => shiftStart(1)} title={t('tse.start_later')}><Icon name="chev" size={13} /></button>
              </div>
              <span className="muted" style={{ fontSize: 'var(--fs-micro)' }}>{t('tse.moves_whole_trip')}</span>
            </div>
          </div>

          <div className="scrollbar-thin ts-leftscroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 12px 18px', background: 'var(--wash)' }}>
          <div className="te-thead" style={{ padding: '0 4px 6px' }}>
            <span className="te-th" style={{ gridColumn: 3 }}>{t('tse.col_destination')}</span>
            <span className="te-th te-th--c" style={{ gridColumn: 4 }}>{t('tse.col_nights')}</span>
            <span className="te-th te-th--c" style={{ gridColumn: 5 }}>{t('tse.col_stay')}</span>
            <span className="te-th te-th--c" style={{ gridColumn: 6 }}>{t('budget.source_activity')}</span>
          </div>
          <div className={'te-table' + (dragIdx !== null ? ' is-dragging' : '')}>
            {displayNodes.map((n) => {
              const dIdx = ordered.indexOf(n);     // stable index in the real order
              const next = displayNodes[displayNodes.indexOf(n) + 1];
              const tr = next ? transferFor(n.id, next.id) : null;
              const dragging = dragIdx === dIdx;
              const dragProps = {
                dragging,
                onArm: (e) => armDrag(e, dIdx, n.id),
                onMove: (dir) => moveNodeById(n.id, dir),
              };
              let body;
              if (isAnchor(n)) {
                body = <GridEndpoint node={n} onRemove={() => removeEndpoint(n.id)} />;
              } else if (n.kind === 'waypoint') {
                const aa = actsFor(n.id);
                body = <GridNode seg={n} cityConf={cityConflicts(n.id)} acts={aa} actWarn={aa.some((a) => actWarnId(a.id))}
                  onOpenCity={() => openCity(n.id)}
                  onNightsMinus={() => nudgeNights(n.id, -1)} onNightsPlus={() => nudgeNights(n.id, 1)}
                  drag={dragProps} />;
              } else {
                const h = hotelFor(n.id); const aa = actsFor(n.id);
                body = <GridNode seg={n} stayNum={stayNumById[n.id]} cityConf={cityConflicts(n.id)}
                  hotel={h} hotelWarn={hotelWarnId(h?.id)} acts={aa} actWarn={aa.some((a) => actWarnId(a.id))}
                  onOpenCity={() => openCity(n.id)}
                  onHotel={() => (h ? openEvent('hotel', h.id) : createBooking('hotel', n))}
                  onAct={() => (aa.length ? openCity(n.id) : createBooking('activity', n))}
                  onNightsMinus={() => nudgeNights(n.id, -1)} onNightsPlus={() => nudgeNights(n.id, 1)}
                  drag={dragProps} />;
              }
              return (
                <div className="te-seamwrap" key={n.id} ref={setRowRef(n.id)}>
                  {body}
                  {/* Transfer chip straddles the seam to the next city. Stays
                      mounted during drag but melts away via CSS (.is-dragging),
                      then eases back on drop — adjacency is in flux mid-drag. */}
                  {next && (
                    <SeamTransfer a={n} b={next} t={tr} mismatch={transferMismatch(tr)} onOpen={() => openTransferRow(n, next, tr)} />
                  )}
                </div>
              );
            })}
          </div>

          {dragIdx !== null && ordered[ordered.length - 1]?.kind !== 'end' && (
            <div style={{ marginTop: 8, height: 36, display: 'grid', placeItems: 'center', borderRadius: 8, border: '1.5px dashed ' + (overGap === ordered.length ? 'var(--brand)' : 'var(--line-2)'), color: overGap === ordered.length ? 'var(--brand)' : 'var(--muted)', fontSize: 'var(--fs-meta)', fontWeight: 600, transition: 'color .15s var(--ease-out), border-color .15s var(--ease-out)' }}>
              {t('tse.move_to_end')}
            </div>
          )}
          <AddPointButton onOpen={() => setLeftPanel({ type: 'cityadd' })} />
          {outOfPlanTransfers.length > 0 && (
            <div style={{ marginTop: 14, padding: '11px 13px', borderRadius: 12, background: 'var(--wash)', border: '1px solid var(--line-2)' }}>
              <div className="eyebrow" style={{ marginBottom: 8, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Icon name="warning" size={12} style={{ color: 'var(--warning)' }} /> {t('tse.transfers_out_of_plan')}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {outOfPlanTransfers.map((tr) => (
                  <button key={tr.id} onClick={() => openEvent('transfer', tr.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 999, background: 'var(--surface)', border: '1px solid var(--line)', cursor: 'pointer', fontSize: 'var(--fs-meta)', fontWeight: 600, color: 'var(--ink)' }}>
                    <Icon name="warning" size={12} style={{ color: 'var(--warning)' }} /> {nodeName(tr.from_city_visit_id)} → {nodeName(tr.to_city_visit_id)}
                  </button>
                ))}
              </div>
            </div>
          )}
          <RemovedTray removed={draft.removed} onRestore={restoreCity} />
          </div>{/* /ts-leftscroll */}
          </>)}
          </div>{/* /te-panefade */}
        </div>

        {/* RIGHT - full-height map (hideable); warnings live in a collapsible overlay widget */}
        {showMap && (
        <div className="ts-col-right" style={{ position: 'relative', minWidth: 0, minHeight: 0, background: 'var(--surface)' }}>
          <div className="ts-map" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
            <MapView visits={draft.nodes} transfers={mapTransfers} visitsById={Object.fromEntries(draft.nodes.map((v) => [v.id, v]))} showStartEnd mapControls
              focus={mapFocus}
              onCityClick={(pts) => { const v = (pts || []).find((x) => !isAnchor(x)) || (pts || [])[0]; if (v) openCity(v.id); }}
              colorScheme={typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'DARK' : 'LIGHT'} />
          </div>
          {/* Warnings: a round FAB (chat-dock sized) with a count badge; click → list. */}
          <div style={{ position: 'absolute', right: 16, bottom: 16, zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10, maxWidth: 'calc(100% - 32px)' }}>
            {showWarn && issues.length > 0 && (
              <div className="scrollbar-thin" style={{ width: 'min(360px, calc(100vw - 32px))', maxHeight: '52vh', overflow: 'auto', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, boxShadow: 'var(--shadow-pop)', padding: 8 }}>
                <ConflictsPanel issues={issues} ctx={{ hotels: liveHotels, activities: liveActivities, transfers: liveTransfers, visits: draft.nodes }} onOpen={openConflict} defaultExpanded />
              </div>
            )}
            <button
              className="ts-fab"
              onClick={() => { if (issues.length) setShowWarn((v) => !v); }}
              aria-label={issues.length ? t('tse.warns_short', { n: warns }) : t('validation.panel_all_clear')}
              title={issues.length ? t('tse.warns_short', { n: warns }) : t('validation.panel_all_clear')}
              style={{ position: 'relative', width: 56, height: 56, borderRadius: '50%', border: 'none', flexShrink: 0,
                cursor: issues.length ? 'pointer' : 'default', display: 'grid', placeItems: 'center', boxShadow: 'var(--shadow-pop)',
                background: issues.length ? 'var(--warning)' : 'var(--success)', color: '#fff' }}
            >
              <Icon name={issues.length ? 'warning' : 'check'} size={23} />
              {issues.length > 0 && (
                <span style={{ position: 'absolute', top: -3, right: -3, minWidth: 20, height: 20, padding: '0 5px', borderRadius: 999, background: 'var(--surface)', color: 'var(--warning)', border: '2px solid var(--warning)', fontSize: 'var(--fs-micro)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
                  {issues.length > 99 ? '99+' : issues.length}
                </span>
              )}
            </button>
          </div>
        </div>
        )}
      </div>
    </div>

      {/* Delete-city confirm — AlertDialog (focus-trapped, Esc-closable). */}
      <AlertDialog open={!!confirmDel} onOpenChange={(o) => { if (!o) setConfirmDel(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('tse.delete_city_q', { city: confirmDel?.city_name })}</AlertDialogTitle>
            <AlertDialogDescription>{t('tse.delete_city_desc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <Btn variant="danger-solid" icon="trash" onClick={() => confirmDel && doRemoveCity(confirmDel.id)}>{t('tse.delete_city')}</Btn>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <style>{`
        .ts-step { border: none; background: transparent; border-radius: 8px; color: var(--ink-2); cursor: pointer; display: grid; place-items: center; width: 26px; height: 26px; transition: background .12s var(--ease-out), transform .1s var(--ease-out); }
        .ts-step:hover { background: var(--wash); }
        .ts-step:active:not(:disabled) { transform: scale(0.9); }
        .ts-step:disabled { opacity: .3; cursor: default; }
        .ts-in { width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 9px; background: var(--surface); color: var(--ink); font-size: 13px; }
        .te-panefade { animation: tePaneIn .2s var(--ease-out) both; }
        @keyframes tePaneIn { from { opacity: 0; transform: translateX(10px); } to { opacity: 1; transform: none; } }
        /* Warnings FAB: lift on hover, press on click. */
        .ts-fab { transition: transform .16s var(--ease-out), box-shadow .16s var(--ease-out); }
        .ts-fab:hover { transform: scale(1.06); }
        .ts-fab:active { transform: scale(0.96); }
        /* Delete-confirm: backdrop fades, card scales up from near-full (never from nothing), centered. */
        .ts-confirm-backdrop { animation: tsBackdropIn .16s var(--ease-out) both; }
        .ts-confirm-card { transform-origin: center; animation: tsCardIn .2s var(--ease-out) both; }
        @keyframes tsBackdropIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes tsCardIn { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
        @media (prefers-reduced-motion: reduce) {
          .te-panefade, .ts-confirm-backdrop, .ts-confirm-card { animation: none; }
          .ts-fab:hover, .ts-fab:active, .ts-step:active { transform: none; }
        }
        @media (max-width: 1080px) {
          .ts-screen { height: auto !important; min-height: 100vh; overflow: visible !important; }
          .ts-grid { grid-template-columns: 1fr !important; overflow: visible !important; }
          .ts-leftscroll { overflow: visible !important; }
          .ts-map { flex: 0 0 340px !important; }
          .ts-warn { flex: 0 0 auto !important; min-height: 300px; }
        }
      `}</style>
      {/* Unsaved-changes guard when leaving the editor (menu / logo / back). */}
      <AlertDialog open={!!pendingLeave} onOpenChange={(o) => { if (!o) setPendingLeave(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('tse.unsaved_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('tse.unsaved_desc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('tse.unsaved_stay')}</AlertDialogCancel>
            <Btn variant="ghost" onClick={() => { const to = pendingLeave; setPendingLeave(null); leaveNow(to); }}>{t('tse.unsaved_leave')}</Btn>
            <AlertDialogAction onClick={() => onSave(pendingLeave)}>{t('common.save')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}


function Conf({ n }) {
  const t = useT();
  if (!n) return null;
  return <span className="te-warnbadge" title={t('tse.conflicts_n', { n })}><Icon name="warning" size={10} /> {n}</span>;
}

// inline hotel / activity cells (design mockup HotelCell / ActCell)
function HotelCell({ hotel, warn, onClick }) {
  const t = useT();
  if (!hotel) return (
    <button className="te-cellbtn te-cellbtn--ghost" onClick={onClick} title={t('hotel.add')}>
      <Icon name="bed" size={14} /> <Icon name="plus" size={12} />
    </button>
  );
  return (
    <button className={'te-hotelicon' + (warn ? ' is-warn' : '')} onClick={onClick} title={hotel.name}
      style={warn ? { width: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0 8px' } : undefined}>
      <Icon name="bed" size={15} style={{ color: warn ? 'var(--warning)' : 'var(--ev-hotel)' }} />
      {warn && <Icon name="warning" size={11} style={{ color: 'var(--warning)' }} />}
    </button>
  );
}
function ActCell({ count, warn, onClick }) {
  const t = useT();
  if (!count) return (
    <button className="te-cellbtn te-cellbtn--ghost" onClick={onClick} title={t('budget.source_activity')}>
      <Icon name="spark" size={14} /> <Icon name="plus" size={12} />
    </button>
  );
  return (
    <button className={'te-actchip' + (warn ? ' is-warn' : '')} onClick={onClick} title={count + ''}>
      <Icon name="spark" size={13} style={{ color: warn ? 'var(--warning)' : 'var(--ev-activity)' }} />
      <span className="num" style={{ fontWeight: 700, fontSize: 'var(--fs-meta)' }}>{count}</span>
      {warn && <Icon name="warning" size={11} style={{ color: 'var(--warning)' }} />}
    </button>
  );
}

function GridNode({ seg, stayNum, cityConf, hotel, hotelWarn, acts = [], actWarn, onOpenCity, onHotel, onAct, onNightsMinus, onNightsPlus, drag }) {
  const t = useT();
  const { lang } = useI18n();
  const m = metaOf(seg);
  const stop = (e) => e.stopPropagation();
  // Drag handle: pointer-drag (lifts the row) + keyboard reorder (a11y). Click is
  // stopped so grabbing the grip never opens the city panel.
  const gripEl = (
    <span className="te-grip" role="button" tabIndex={0} aria-label={t('tse.move_up')}
      onClick={stop}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp') { e.preventDefault(); drag.onMove(-1); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); drag.onMove(1); }
      }}>
      <Icon name="drag" size={14} />
    </span>
  );
  if (seg.kind === 'waypoint') {
    return (
      <div className={'te-row' + (drag.dragging ? ' is-dragging' : '')} onPointerDown={drag.onArm} onClick={onOpenCity}>
        {gripEl}
        <span className="te-row__node" style={{ background: 'transparent', color: 'var(--ev-transfer)', border: '1.5px dashed var(--ev-transfer)' }}><Icon name="arrowSwap" size={11} /></span>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span className="te-cityname" style={{ fontSize: 'var(--fs-base)', fontWeight: 600 }}>{seg.city_name}</span>
            <span className="te-wptag">{t('tse.layover')}</span>
            <Conf n={cityConf} />
          </div>
          <div className="num muted" style={{ fontSize: 'var(--fs-micro)', marginTop: 2 }}>{t('tse.transit_word')} · {fmtD(seg.start_date, lang)}</div>
        </div>
        <span className="te-stepper" onClick={stop} title={t('tse.col_nights')}>
          <button className="te-step" onClick={onNightsMinus} disabled aria-label={t('tse.nights_remove')}><Icon name="close" size={10} style={{ transform: 'rotate(45deg)' }} /></button>
          <span className="num te-nights">0<span className="muted" style={{ fontWeight: 500 }}>{t('planner.night_short')}</span></span>
          <button className="te-step" onClick={onNightsPlus} title={t('planner.more_nights')} aria-label={t('tse.nights_add')}><Icon name="plus" size={10} /></button>
        </span>
        <div className="te-cell te-cell--hotel" />
        <div className="te-cell te-cell--act" onClick={stop}><ActCell count={acts.length} warn={actWarn} onClick={onAct} /></div>
      </div>
    );
  }
  return (
    <div className={'te-row' + (drag.dragging ? ' is-dragging' : '')} onPointerDown={drag.onArm} onClick={onOpenCity}>
      {gripEl}
      <span className={'te-row__num' + (cityConf ? ' is-warn' : '')}>{stayNum}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span className="te-cityname">{seg.city_name}</span>
          {m.country && <span className="muted" style={{ fontSize: 'var(--fs-micro)', whiteSpace: 'nowrap' }}>{m.country}</span>}
          <Conf n={cityConf} />
        </div>
        <div className="num muted" style={{ fontSize: 'var(--fs-micro)', marginTop: 2 }}>{fmtD(seg.start_date, lang)} – {fmtD(seg.end_date, lang)}</div>
      </div>
      <span className="te-stepper" onClick={stop} title={t('tse.col_nights')}>
        <button className="te-step" onClick={onNightsMinus} disabled={(seg.nights || 0) <= 0} aria-label={t('tse.nights_remove')}><Icon name="close" size={10} style={{ transform: 'rotate(45deg)' }} /></button>
        <span className="num te-nights">{seg.nights}<span className="muted" style={{ fontWeight: 500 }}>{t('planner.night_short')}</span></span>
        <button className="te-step" onClick={onNightsPlus} aria-label={t('tse.nights_add')}><Icon name="plus" size={10} /></button>
      </span>
      <div className="te-cell te-cell--hotel" onClick={stop}><HotelCell hotel={hotel} warn={hotelWarn} onClick={onHotel} /></div>
      <div className="te-cell te-cell--act" onClick={stop}><ActCell count={acts.length} warn={actWarn} onClick={onAct} /></div>
    </div>
  );
}

// Transfer chip that STRADDLES the seam between two city rows (sits on the
// separator line, its surface bg covering it — it doesn't split the rows). A pill
// when the transfer exists, a dashed "+ переезд" when not. Click → transport panel
// (existing) or the "Развилка" pick panel (new). Same-city legs show nothing.
function SeamTransfer({ a, b, t, mismatch, onOpen }) {
  const tx = useT();
  const { lang } = useI18n();
  const sameCity = (a.external_city_id && b.external_city_id && a.external_city_id === b.external_city_id) || (a.city_name && a.city_name === b.city_name);
  if (sameCity && !t) return null;
  if (!t) {
    return (
      <div className="te-seam">
        <button className="te-seam__pill te-seam__pill--add" onClick={onOpen} title={`${a.city_name} → ${b.city_name}`}>
          <Icon name="plus" size={11} /> {tx('tse.add_transfer')}
        </button>
      </div>
    );
  }
  const meta = TKIND[t.transport_type] || TKIND.train;
  return (
    <div className="te-seam">
      <button className={'te-seam__pill' + (mismatch ? ' is-warn' : '')} onClick={onOpen} title={`${a.city_name} → ${b.city_name}`}>
        <Icon name={mismatch ? 'warning' : meta.icon} size={12} style={{ color: mismatch ? 'var(--warning)' : 'var(--ev-transfer)' }} />
        <span style={{ fontWeight: 600, fontSize: 'var(--fs-micro)', color: mismatch ? 'var(--warning)' : 'var(--ink-2)' }}>{tx(meta.labelKey)}{mismatch ? tx('tse.mismatch_suffix') : ''}</span>
        {t.day_change && <Icon name="moon" size={11} style={{ color: 'var(--brand)' }} title={tx('tse.overnight_title')} />}
        <span className="num muted" style={{ fontSize: 'var(--fs-micro)' }}>· {fmtD(t.start_datetime, lang)}</span>
      </button>
    </div>
  );
}

// Start / Finish anchor row — flag (start) / check (finish) node, label + city,
// departure/arrival date below. Flat flex row in the itinerary table.
function GridEndpoint({ node, onRemove }) {
  const t = useT();
  const { lang } = useI18n();
  const isStart = node.kind === 'start';
  const accent = isStart ? 'var(--brand)' : 'var(--ink-2)';
  const soft = isStart ? 'var(--brand-soft)' : 'var(--wash)';
  const m = metaOf(node);
  return (
    <div className="te-end">
      <span className="te-row__node" style={{ background: soft, color: accent, border: '1px solid ' + (isStart ? 'var(--brand-soft-12, var(--line))' : 'var(--line)') }}><Icon name={isStart ? 'flag' : 'check'} size={12} /></span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="te-endlabel" style={{ color: accent }}>{isStart ? t('ai_plan.start') : t('ai_plan.end')}</span>
          <span style={{ fontSize: 'var(--fs-strong)', fontWeight: 700, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>{m.flag} {node.city_name}</span>
        </div>
        <div className="num muted" style={{ fontSize: 'var(--fs-micro)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {isStart ? t('tse.departure_word') : t('tse.arrival_word')} · {fmtD(node.start_date || node.end_date, lang)}
        </div>
      </div>
      <button className="ts-step" style={{ width: 24, height: 24, color: 'var(--muted)', flexShrink: 0 }} onClick={onRemove} title={t('tse.remove')}><Icon name="close" size={13} /></button>
    </div>
  );
}

function AddPointButton({ onOpen }) {
  const t = useT();
  return <button onClick={onOpen} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', marginTop: 12, padding: '12px', borderRadius: 12, cursor: 'pointer', background: 'var(--brand-soft)', border: '1px solid var(--brand-soft-12, var(--line))', color: 'var(--brand)', fontSize: 'var(--fs-base)', fontWeight: 600 }}>
    <Icon name="plus" size={15} /> {t('tse.add_point_btn')}
  </button>;
}

const POINT_TYPES = [
  { id: 'transit', labelKey: 'event.city', icon: 'bed', subKey: 'tse.pt_transit_sub' },
  { id: 'waypoint', labelKey: 'tse.pt_waypoint', icon: 'arrowSwap', subKey: 'tse.pt_waypoint_sub' },
  { id: 'start', labelKey: 'ai_plan.start', icon: 'flag', subKey: 'tse.pt_start_sub' },
  { id: 'end', labelKey: 'ai_plan.end', icon: 'flag', subKey: 'tse.pt_end_sub' },
];
// In-place "add a point" panel (replaces the old modal). Lives in the editor's
// left column; picks a point type then searches a city.
function CityAddPanel({ onPick, onBack, hasStart, hasEnd }) {
  const t = useT();
  const [type, setType] = useState('transit');
  const disabledFor = (id) => (id === 'start' && hasStart) || (id === 'end' && hasEnd);
  const meta = POINT_TYPES.find((p) => p.id === type);
  return (
    <div className="te-panel">
      <div className="te-panel__top">
        <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: 'var(--brand)' }} />
        <button className="te-back" onClick={onBack} title={t('common.back')}><Icon name="back" size={16} /></button>
        <span className="te-panel__icon" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}><Icon name="pin" size={16} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="te-panel__title">{t('tse.add_point')}</div>
          <div className="te-panel__sub">{t('tse.add_point_hint')}</div>
        </div>
      </div>
      <div className="te-panel__body scrollbar-thin">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 7, marginBottom: 10 }}>
          {POINT_TYPES.map((pt) => {
            const dis = disabledFor(pt.id), active = type === pt.id;
            return <button key={pt.id} disabled={dis} onClick={() => setType(pt.id)} title={dis ? t('tse.already_set') : t(pt.subKey)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, padding: '11px 6px', borderRadius: 11, cursor: dis ? 'not-allowed' : 'pointer', background: active ? 'var(--brand-soft)' : 'var(--surface)', border: '1px solid ' + (active ? 'var(--brand)' : 'var(--line)'), color: dis ? 'var(--muted-2)' : active ? 'var(--brand)' : 'var(--ink-2)', opacity: dis ? 0.5 : 1 }}>
              <Icon name={pt.icon} size={17} /><span style={{ fontSize: 'var(--fs-micro)', fontWeight: 600 }}>{t(pt.labelKey)}</span>
            </button>;
          })}
        </div>
        <div className="muted" style={{ fontSize: 'var(--fs-micro)', marginBottom: 10 }}>{meta ? t(meta.subKey) : ''}</div>
        <CitySearch onSelect={(c) => onPick(c, type)} />
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
      {removed.map((n) => <button key={n.id} onClick={() => onRestore(n.id)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 999, background: 'var(--surface)', border: '1px solid var(--line)', cursor: 'pointer', fontSize: 'var(--fs-meta)', fontWeight: 600, color: 'var(--ink)' }}>
        <Icon name="plus" size={12} style={{ color: 'var(--brand)' }} /> {flagEmoji(n.country_code)} {n.city_name}
      </button>)}
    </div>
  </div>;
}


// (Conflicts and transfer rows now open in-place LEFT panels: EventSourcePanel
//  for view/edit/delete, EventEditDialog variant="panel" for transfer create.
//  The old view/add modals were removed in the panel redesign Ф3.)
