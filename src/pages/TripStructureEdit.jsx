import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { TRIP_SHELL_KEY, TRIP_CONTENT_KEY, invalidateTripData } from '@/lib/trip-data';
import { invokeGetTripDetails } from '@/lib/invokeTripFn';
import { useQueryGate } from '@/lib/useQueryGate';
import TripLoadError from '@/components/trips/TripLoadError';
import PageNotFound from '@/lib/PageNotFound';
import { rpcSetCityNights, rpcSetTripStartDate, rpcAddCity, rpcRemoveCity, rpcReorderCities, refetchTrip } from '@/lib/tripEdit';
import { layoutDates } from '@/lib/tripDates';
import { collectDocPaths, removeTripFiles } from '@/lib/storageCleanup';
import { useRouteDnD } from '@/lib/useRouteDnD';
import CityRow from '@/components/trip/CityRow';
import NightsStepper from '@/components/trip/NightsStepper';
import { sortVisits, validateTrip, primaryIssues } from '@/lib/validation';
import { uniqueCityCount, localizeVisits } from '@/lib/trip-cities';
import { resolveMyRole, roleCanEdit } from '@/lib/members';
import { formatTripRange } from '@/lib/trip-dates';
import { Icon } from '../design/icons';
import { Btn, Skeleton, useToast } from '../design/index';
import CitySearch from '@/components/cities/CitySearch';
import { tzFromCoords } from '@/lib/timezone';
import { Drawer } from 'vaul';
import MapView from '@/components/views/MapView';
import EventSourcePanel from '@/components/common/EventSourcePanel';
import CityPanel from '@/components/common/CityPanel';
import ForkPartnerModal from '@/components/bookings/ForkPartnerModal';
import EventEditDialog from '@/components/common/EventEditDialog';
import AddBookingPanel from '@/components/bookings/AddBookingPanel';
import { ConflictsPanel } from '@/components/common/ValidationUI';
import AppHeader from '@/components/AppHeader';
import { useAuth } from '@/lib/AuthContext';
import { useTheme } from '@/lib/ThemeContext';
import { isProActive, useTripProStatus } from '@/lib/subscription';
import { useT, useI18n, useI18nFormat } from '@/lib/i18n/I18nContext';
import { useStay22Bundle } from '@/lib/stay22';
import TripSidebar from '@/components/trips/TripSidebar';
import TripAccessError from '@/components/trips/TripAccessError';
import ShareDialog from '@/components/trips/ShareDialog';
import { useProUpsell } from '@/components/common/ProUpsellProvider';
import { useConfirm } from '@/components/common/ConfirmProvider';
import TripStartControl from '@/components/trip/TripStartControl';

// =====================================================================
// TRIP STRUCTURE EDITOR - "Сетка" (grid) design from the trip-structure-*
// prototype, wired to the real id-based model (city_visits + position),
// validateTrip conflicts (unified engine), live id-based RPC writes
// (add_city / remove_city / reorder_cities / set_city_nights). Live Google map.
// =====================================================================
const TKIND = { plane: { icon: 'plane', labelKey: 'tse.tk_plane' }, train: { icon: 'train', labelKey: 'transfer.train' }, bus: { icon: 'bus', labelKey: 'transfer.bus' }, car: { icon: 'car', labelKey: 'event.tk_car' }, ferry: { icon: 'ferry', labelKey: 'transfer.ferry' } };
const toDT = (iso) => (iso ? DateTime.fromISO(iso, { zone: 'utc' }) : null);
const fmtD = (iso, loc = 'ru') => { const d = toDT(iso); return d ? d.setLocale(loc).toFormat('d MMM') : '-'; };
const nightsBetween = (a, b) => { const x = toDT(a), y = toDT(b); return x && y ? Math.max(0, Math.round(y.diff(x, 'days').days)) : null; };
// Calendar-day helpers. nights/gap are counted by DATE (not by the raw timestamp),
// so a checkout stored at 23:59 isn't rounded up to an extra night. This is what
// makes recompute idempotent on load: re-deriving dates from (nights, gap)
// reproduces exactly what's stored, so editor = timeline = DB.
const dayOf = (iso) => { const d = toDT(iso); return d ? d.startOf('day') : null; };
const dayWord = (n, t) => (n === 1 ? t('tse.day_one') : n >= 2 && n <= 4 ? t('tse.day_few') : t('tse.day_many'));
const isAnchor = (n) => n.kind === 'start' || n.kind === 'end';
// A city added in the editor but not yet persisted carries a 'tmp-…' id (no real uuid
// until add_city inserts it). A LIVE transfer write to such a city fails the
// uuid type, so transfer creation is gated until the new city is persisted.
const isTmpId = (id) => String(id || '').startsWith('tmp-');

// Canonical date-chain layout (start = prevEnd + gap; end = start + nights) now
// lives in lib/tripDates.layoutDates, shared with ManualPlanner and mirroring the
// server recompute_trip. Used here only as optimistic reorder layout.
const recompute = layoutDates;

// Adjacency-driven gap, mirroring server recompute_trip [R1]: a city's gap is 1
// ONLY when the transfer between it and the PREVIOUS node has day_change — not any
// transfer that merely points at this city. A baked gap goes stale after a reorder
// (the overnight transfer is no longer adjacent) and would drift +1 vs the server,
// so it must be re-derived on every (re)layout. ManualPlanner passes no transfers
// → all gap 0. The first non-anchor's gap now applies too (0043): an overnight
// start->first leg counts, anchored at the start-leg departure day.
function applyAdjacencyGaps(nodes, transfers = []) {
  let prevId = null;
  return nodes.map((n) => {
    // The finish anchor needs its incoming-leg gap so layoutDates can push the finish
    // +1 on an overnight last->finish leg (mirror server recompute_trip end branch).
    // The start anchor is the base — no incoming gap applies to it.
    if (isAnchor(n)) {
      const tr = (n.kind === 'end' && prevId) ? (transfers || []).find((t) => t.from_city_visit_id === prevId && t.to_city_visit_id === n.id) : null;
      const next = n.kind === 'end' ? { ...n, gap: tr?.day_change ? 1 : 0 } : n;
      prevId = n.id;
      return next;
    }
    const tr = prevId ? (transfers || []).find((t) => t.from_city_visit_id === prevId && t.to_city_visit_id === n.id) : null;
    const next = { ...n, gap: tr?.day_change ? 1 : 0 };
    prevId = n.id;
    return next;
  });
}

function buildDraft(shell, transfers = [], lang) {
  const visits = localizeVisits(sortVisits(shell?.cityVisits || []), lang);
  // nights = stored date span. gap (days between the previous checkout and this
  // check-in) now comes from the INCOMING transfer's day_change flag: an overnight
  // / day-change transfer means this city starts +1 day after the previous one.
  // No incoming transfer or day_change=false → gap 0 (flush). Source of truth =
  // transfers.day_change; the stored city dates are just the baked-in result.
  // gap is adjacency-driven (mirror server recompute_trip [R1]): a city's gap is 1
  // only if the transfer between it and the PREVIOUS node has day_change, NOT any
  // transfer that merely points at this city (which would survive a reorder and
  // drift +1 vs the server). The first non-anchor's gap applies too (mirror 0043):
  // an overnight start->first leg is the adjacency from the `start` anchor.
  const trBetween = (a, b) => (transfers || []).find((t) => t.from_city_visit_id === a && t.to_city_visit_id === b);
  let prevId = null;
  const nodes = visits.map((v, i) => {
    const base = { ...v, position: Number.isFinite(v.position) ? v.position : i };
    if (isAnchor(v)) { prevId = v.id; return { ...base, nights: null, gap: null }; }
    const sd = dayOf(v.start_date), ed = dayOf(v.end_date);
    const isWp = v.kind === 'waypoint';
    const nights = isWp ? null : Math.max(0, (sd && ed ? Math.round(ed.diff(sd, 'days').days) : 1));
    const tr = prevId ? trBetween(prevId, v.id) : null;
    const gap = tr?.day_change ? 1 : 0;
    prevId = v.id;
    return { ...base, nights, gap };
  });
  // Draft holds ONLY structure (nodes + removed cities + a FIXED trip start date).
  // Bookings are read LIVE from `content` (edits/adds via real dialogs → DB → refetch).
  // Trip base = the START anchor's own start_date — the single source of truth the
  // server writes via recompute_trip / set_trip_start_date. Mirrors the server's
  // _trip_anchor_date (which now prioritizes the same value). We must NOT derive it
  // from the start→first-leg transfer's departure datetime: recompute never updates
  // that datetime, so after a start-date shift it stays stale and the selector +
  // start-row would snap back to the old day while the cities show the new one
  // (TRIP-209). Fallback: first city's start.
  const firstTransit = nodes.find((n) => !isAnchor(n));
  const startAnchor = visits.find((v) => v.kind === 'start');
  const startDate = startAnchor?.start_date || firstTransit?.start_date || null;
  return { nodes, startDate };
}

// Compact month-grid date picker for the trip-start control. Tokens/icons from
// the design system; no new shared component. Picks an absolute start date which
// the caller turns into a delta shift (shiftStart) of the whole itinerary.
export default function TripStructureEdit() {
  const { tripId } = useParams();
  const t = useT();
  const { lang } = useI18n();
  const { fmtMoney } = useI18nFormat();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const { isDark, toggle: toggleTheme } = useTheme();
  const accountPro = isProActive(user);
  const [draft, setDraft] = useState(null);
  // Left-column panel FSM (replaces the old view/add modals). null = the city
  // list; otherwise the left pane swaps in-place to a panel:
  //   { type:'event', kind, id, warning }    - view/edit/delete a booking (EventSourcePanel)
  //   { type:'createTransfer', fromVisit, toVisit } - create a transfer (EventEditDialog panel variant)
  const [leftPanel, setLeftPanel] = useState(null);
  const closeLeftPanel = () => setLeftPanel(null);
  // ≤640px: the editor panel opens as a bottom sheet (same Radix sheet + swipe
  // mechanism as the modals), matching the .lp-sheet CSS breakpoint.
  const [isSheet, setIsSheet] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const onChange = () => setIsSheet(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  // TRIP-161: the two-column desktop layout (>1080px, mirrors the .ts-grid CSS
  // breakpoint). Only there do side panels open as a full-height drawer over the
  // left column; below it we keep the in-flow swap, ≤640 the bottom sheet.
  const [isWide, setIsWide] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1081px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1081px)');
    const onChange = () => setIsWide(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  // A11y: when an in-place left panel opens, move focus into it (its back button
  // if present) so keyboard/SR users land in the new context; Esc closes it.
  const leftPaneRef = useRef(null);
  useEffect(() => {
    if (!leftPanel || !leftPaneRef.current) return;
    const el = leftPaneRef.current.querySelector('.lp-back, button, [tabindex]') || leftPaneRef.current;
    requestAnimationFrame(() => el?.focus?.({ preventScroll: true }));
  }, [leftPanel]);
  const [showWarn, setShowWarn] = useState(false); // collapsible warnings overlay on the map
  const confirm = useConfirm(); // city delete → shared confirm (sheet on mobile)
  const [previewTransfer, setPreviewTransfer] = useState(null); // synthetic leg drawn on the map while creating a transfer
  const [sideOpen, setSideOpen] = useState(false); // mobile menu drawer
  const [shareOpen, setShareOpen] = useState(false);
  // Pro "enabled by owner" info modal for non-owners (TRIP-63 №1) — mirrors
  // TripView. A non-owner tapping the Pro lock must get the explanation, not a
  // navigation to /pro (which would show them an upgrade they can't apply).
  const { openProUpsell } = useProUpsell();
  const openProInfo = () => openProUpsell({ mode: 'info', ownerName: (content?.members || []).find(m => m.user_id === trip?.created_by)?.user_full_name || '' });
  const [hoveredNodeId, setHoveredNodeId] = useState(null); // itinerary row hovered → highlight its map marker
  // Drag / FLIP / keyboard reorder live in the shared useRouteDnD hook (also used by
  // the trip-creation flow). It's instantiated below — once `ordered`, `isAnchor`
  // and the commit callback are in scope — and its returns are destructured there.
  // Live model: every change is persisted immediately (no draft/lock/save), so
  // leaving is a plain navigation — nothing to save, no lock to release, no prompt.
  const leaveNow = (to) => nav(typeof to === 'string' ? to : `/trip/${tripId}`);
  // Optimistic local patch only; the server owns the authoritative state (refetched
  // after each action via runAction/closePanelAndSync). No undo/dirty/reset.
  const editDraft = (updater) => setDraft((d) => (d ? updater(d) : d));
  // Live edit: the optimistic local patch already ran. Persist via RPC, then reconcile
  // with the authoritative server state — but ONLY if this is still the latest action.
  // A monotonic seq drops stale reconciles so rapid edits don't snap the UI back to an
  // intermediate server state (no jitter). Per-action RPCs are also coalesced/debounced
  // by their callers (e.g. the nights stepper) so the server receives only the final value.
  const seqRef = useRef(0);
  // onResult(result) runs ONLY on RPC success, under the seq-guard, BEFORE the refetch —
  // e.g. addCity reconciles the real city_visit uuid returned by add_city into the draft
  // immediately (shrinks the tmp- window to the RPC latency instead of the full refetch).
  const runAction = async (rpcFn, onResult, refetchOpts) => {
    const mySeq = ++seqRef.current;
    let result;
    try { result = await rpcFn(); }
    catch (e) {
      toast({ description: t('tse.err_save') + (e?.message || e), variant: 'destructive' });
      // RPC failed → drop the optimistic patch RIGHT AWAY by rebuilding from the last
      // good server state (cache-backed buildDraft). Don't gate the rollback on a
      // refetch that would also fail offline. If a newer action superseded us it owns
      // the state, so leave it alone.
      if (mySeq === seqRef.current) setDraft(null);
      return;
    }
    if (mySeq !== seqRef.current) return;           // superseded by a newer action → keep optimistic state
    if (onResult) { try { onResult(result); } catch { /* ignore */ } }
    // refetchOpts lets date-only actions (nights/start/reorder) skip the CONTENT half
    // (hotels/activities/transfers unchanged) → less work, less flicker. Default: both.
    try { await refetchTrip(qc, tripId, refetchOpts); } catch { /* ignore */ }
    if (mySeq !== seqRef.current) return;           // a newer action started during the refetch
    setDraft(null); // rebuild from fresh server state on next render (buildDraft)
  };
  // Any panel that may have WRITTEN transfers/bookings (create/event) closes through
  // here: pull fresh server state and rebuild the draft from it. The server already
  // recomputed the date chain (incl. overnight day_change, Ф2 trigger) and added any
  // layover cities to the shell, so the rebuild reflects them with no client-side
  // gap mirror or manual shell merge. seq-guard so a concurrent runAction wins.
  const closePanelAndSync = async () => {
    closeLeftPanel();
    const mySeq = ++seqRef.current;
    try { await refetchTrip(qc, tripId); } catch { /* ignore */ }
    if (mySeq !== seqRef.current) return;
    setDraft(null);
  };
  // Coalesced/debounced server commit for the nights stepper (one RPC after the burst).
  const nightsCommit = useRef(new Map());   // cityId -> timeout handle
  const nightsTarget = useRef(new Map());   // cityId -> latest target nights (sync source of truth)
  const startCommit = useRef(null);         // debounce handle for trip start shift
  const startTarget = useRef(null);         // latest target trip start ISO (sync source of truth)

  // isPending + fetchStatus feed useQueryGate: OFFLINE pauses these queries
  // (fetchStatus 'paused') rather than throwing, so the gate reads that state
  // directly instead of mistaking "paused, no data" for "no access" (TRIP-56).
  const { data: shell, isLoading: loadingShell, error: shellError, isPending: shellPending, fetchStatus: shellFetchStatus } = useQuery({
    queryKey: TRIP_SHELL_KEY(tripId),
    // invokeGetTripDetails self-heals a stale-token 401 (refresh + retry once);
    // retry:false so React Query doesn't stack its own retry on top (TRIP-56).
    queryFn: () => invokeGetTripDetails({ tripId, include: ['shell'] }),
    enabled: !!tripId,
    retry: false,
    staleTime: 30000, // reuse TripView's cached shell on entry → no reload flicker
  });
  const { data: content, error: contentError, isPending: contentPending, fetchStatus: contentFetchStatus } = useQuery({
    queryKey: TRIP_CONTENT_KEY(tripId),
    queryFn: () => invokeGetTripDetails({ tripId, include: ['content'] }),
    enabled: !!tripId && !loadingShell,
    retry: false,
  });

  // Build the draft SYNCHRONOUSLY during render (not in an effect) the moment
  // shell+content are available — they're cached from TripView, so the editor
  // paints on the very first render with no skeleton frame (no entry flicker).
  if (draft === null && shell && content) {
    setDraft(buildDraft(shell, content.transfers, lang));
  }

  const trip = shell?.trip;
  // Trip-level Pro for the shared sidebar's "upgrade" card — owner-aware, via the
  // same CACHED hook as TripView so the card doesn't re-flash on the edit boundary.
  const { isPro: tripIsPro, resolved: tripProResolved } = useTripProStatus(tripId, trip?.is_pro_trip);
  // Bookings are read LIVE from content. A removed city + its bookings are deleted
  // server-side immediately (remove_city cascade) and gone on the next refetch.
  const liveHotels = useMemo(() => (content?.hotels || []), [content]);
  const liveActivities = useMemo(() => (content?.activities || []), [content]);
  const liveTransfers = useMemo(() => (content?.transfers || []), [content]);
  // While creating a transfer, draw a synthetic leg on the map (shaped by the
  // picked transport type) so the route appears instantly, before saving.
  const mapTransfers = useMemo(() => {
    if (!previewTransfer) return liveTransfers;
    const others = liveTransfers.filter((t) => !(t.from_city_visit_id === previewTransfer.from_city_visit_id && t.to_city_visit_id === previewTransfer.to_city_visit_id));
    return [...others, previewTransfer];
  }, [liveTransfers, previewTransfer]);
  useEffect(() => { if (!(leftPanel?.type === 'create' && leftPanel.kind === 'transfer')) setPreviewTransfer(null); }, [leftPanel]);

  // ── Hotel-pick map badges (TRIP-140) ───────────────────────────────────────
  // While the hotel "fork" panel is open the map swaps the trip route for live
  // Stay22 badges. The SINGLE query + paging + committed filters + hovered/selected
  // live HERE (the common ancestor of MapView and the panel) so one pool feeds both
  // the list (now presentational) and the map badges. Desktop-only by design — the
  // editor map is hidden on phones via CSS.
  const hotelPickVisit = leftPanel?.type === 'pick' && leftPanel.kind === 'hotel' ? leftPanel.visit : null;
  const isHotelPick = !!hotelPickVisit;
  const stayCurrency = trip?.details?.main_currency || 'EUR';
  // TRIP-141/195: whole-city hotel pool + list state, packaged as the stay22
  // bundle by the shared useStay22Bundle hook (same hook the timeline's add-
  // booking drawer uses). Feeds the list (client pagination) here AND the map
  // pins below (editor only — timeline has no map).
  const { bundle: stay22Bundle, query: stayQuery, selectedId: staySelectedId, hoveredId: stayHoveredId, setSelectedId: setStaySelectedId, setHoveredId: setStayHoveredId, openHotelLink } = useStay22Bundle({
    visit: hotelPickVisit, currency: stayCurrency, lang, enabled: isHotelPick, tripId,
  });
  // Map pins: only stays that carry coordinates, with a compact price label (the
  // badge is tiny — long amounts like 252 400 ₽ are shortened to "252K"). While the
  // pool shows a PREVIOUS city (isPlaceholderData, keepPreviousData), emit no pins
  // so the camera doesn't fit to the old city while the new one loads.
  const hotelPins = useMemo(() => {
    if (!isHotelPick || stayQuery.isPlaceholderData) return isHotelPick ? [] : null;
    const list = stayQuery.data?.hotels || [];
    const cur = stayQuery.data?.meta?.currency || stayCurrency;
    return list
      .filter((h) => h.lat != null && h.lng != null)
      .map((h) => ({
        id: h.id, name: h.name, lat: h.lat, lng: h.lng,
        supplierLogo: h.supplierLogo,
        priceLabel: h.price != null ? fmtMoney(h.price, h.currency || cur, { compact: true }) : null,
      }));
  }, [isHotelPick, stayQuery.data, stayQuery.isPlaceholderData, stayCurrency, fmtMoney]);
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

  // ---- structural edits ----
  // Trip start (d.startDate) is FIXED until shiftStart changes it. recompute chains
  // nodes from that date preserving each node's nights+gap, so editing one node only
  // moves the nodes after it; the start and earlier nodes never move. The reorder
  // commit (commitOrder, below) applies this same recompute before persisting.
  // Live-persist a new chain order (drag/keyboard reorder). tmp cities aren't in the
  // DB yet so skip until they're real (their add already refetches). One
  // reorder_cities → server recompute → refetch.
  const persistOrder = (ids) => { if (ids.some(isTmpId)) return; runAction(() => rpcReorderCities(tripId, ids), undefined, { content: false }); };
  // Shared drag/FLIP/keyboard reorder engine. `commitOrder` reproduces the prior
  // inline behavior EXACTLY: optimistic client recompute (adjacency gaps + date
  // chain from the fixed trip start) then live-persist the new chain order. Anchors
  // (start/end) stay pinned via the module-level `isAnchor`.
  const dndOrdered = draft ? sortVisits(draft.nodes) : [];
  const commitOrder = (ids) => {
    editDraft((d) => {
      if (!d) return d;
      const byId = new Map(d.nodes.map((n) => [n.id, n]));
      const nextNodes = ids.map((id) => byId.get(id)).filter(Boolean);
      return { ...d, nodes: recompute(applyAdjacencyGaps(nextNodes, liveTransfers), d.startDate) };
    });
    persistOrder(ids);
  };
  const { draggingId, overGap, pressingId, displayNodes, setRowRef, armDrag, moveNodeById, justDraggedRef } =
    useRouteDnD({ ordered: dndOrdered, isAnchor, onCommitOrder: commitOrder });
  // Nights 0..60. Hitting 0 turns a city into a waypoint (a 0-night transit
  // stop); raising a waypoint above 0 turns it back into a transit city.
  const nudgeNights = (id, delta) => {
    const node = draft.nodes.find((n) => n.id === id);
    if (!node || isAnchor(node)) return;
    // synchronous target survives rapid clicks before re-render; clamp 0..60
    const base = nightsTarget.current.has(id)
      ? nightsTarget.current.get(id)
      : (node.kind === 'waypoint' ? 0 : (node.nights || 0));
    const next = Math.max(0, Math.min(60, base + delta));
    if (next === base) return;
    nightsTarget.current.set(id, next);
    // partial optimism: instantly reflect ONLY the touched city (its nights + its own
    // end_date). Downstream dates are NOT recomputed on the client — they come from the
    // server (recompute_trip) on refetch. No second date engine in the editor.
    editDraft((d) => ({ ...d, nodes: d.nodes.map((n) => {
      if (n.id !== id) return n;
      const end = next > 0 && n.start_date ? toDT(n.start_date).plus({ days: next }).toISODate() : n.start_date;
      return next === 0
        ? { ...n, kind: 'waypoint', nights: 0, end_date: n.start_date }
        : { ...n, kind: 'transit', nights: next, end_date: end };
    }) }));
    if (String(id).startsWith('tmp-')) return;
    // debounce: send ONE set_city_nights with the FINAL value ~350ms after the last click
    const timers = nightsCommit.current;
    if (timers.has(id)) clearTimeout(timers.get(id));
    timers.set(id, setTimeout(() => {
      timers.delete(id);
      const finalN = nightsTarget.current.get(id);
      nightsTarget.current.delete(id);
      runAction(() => rpcSetCityNights(id, finalN), undefined, { content: false });
    }, 350));
  };
  const shiftStart = (delta) => {
    const cur = startTarget.current ?? draft?.startDate;
    const base = cur ? toDT(cur).plus({ days: delta }).toISO() : null;
    if (!base) return;
    startTarget.current = base;
    // partial optimism: shift ALL dates by the same delta (exact, no recompute engine)
    editDraft((d) => ({ ...d, startDate: base, nodes: d.nodes.map((n) => ({
      ...n,
      start_date: n.start_date ? toDT(n.start_date).plus({ days: delta }).toISODate() : n.start_date,
      end_date: n.end_date ? toDT(n.end_date).plus({ days: delta }).toISODate() : n.end_date,
    })) }));
    // debounce: send ONE set_trip_start_date with the FINAL value ~350ms after last click
    if (startCommit.current) clearTimeout(startCommit.current);
    startCommit.current = setTimeout(() => {
      startCommit.current = null;
      const finalBase = startTarget.current;
      startTarget.current = null;
      runAction(() => rpcSetTripStartDate(tripId, toDT(finalBase).toISODate()), undefined, { content: false });
    }, 350);
  };
  // Remove a city → confirm first. On confirm the city AND its attached bookings
  // leave the grid immediately (live remove_city cascade-deletes the city + children).
  // Bookings are stashed on the node so Restore brings them back.
  const removeCity = async (id) => {
    const n = draft.nodes.find((x) => x.id === id);
    if (!n) return;
    const ok = await confirm({
      title: t('tse.delete_city_q', { city: n.city_name }),
      description: t('tse.delete_city_desc'),
      confirmLabel: t('tse.delete_city'),
      variant: 'destructive',
    });
    if (ok) doRemoveCity(id);
  };
  // partial optimism: drop the node from the list now; downstream dates are NOT
  // recomputed on the client — the server (remove_city → recompute_trip) reflows
  // the chain and runAction refetches it. (removed-tray push stays until the
  // draft/tray teardown slice.)
  const doRemoveCity = (id) => {
    editDraft((d) => {
      const node = d.nodes.find((n) => n.id === id); if (!node) return d;
      return { ...d, nodes: d.nodes.filter((n) => n.id !== id) };
    });
    if (String(id).startsWith('tmp-')) return; // never persisted → no server rows / files
    // remove_city cascade-deletes this city's hotels/activities/transfers server-side, but
    // SQL can't reach Storage. Collect the SAME set's document paths and sweep them via the
    // single shared file primitive (removeTripFiles) — only AFTER the RPC succeeds (onResult),
    // else those bookings' files orphan until the whole trip is deleted (TRIP-137). Mirrors
    // remove_city's cascade set: transfers touching the city on either end.
    const orphanPaths = [
      ...liveHotels.filter((h) => h.city_visit_id === id),
      ...liveActivities.filter((a) => a.city_visit_id === id),
      ...liveTransfers.filter((tr) => tr.from_city_visit_id === id || tr.to_city_visit_id === id),
    ].flatMap((e) => collectDocPaths(e.documents));
    runAction(() => rpcRemoveCity(id), () => removeTripFiles(orphanPaths));
  };
  const addCity = (city, kind = 'transit') => {
    if ((kind === 'start' && draft.nodes.some((n) => n.kind === 'start')) || (kind === 'end' && draft.nodes.some((n) => n.kind === 'end'))) {
      toast({ description: kind === 'start' ? t('tse.start_already_set') : t('tse.end_already_set'), variant: 'warning' });
      return;
    }
    // Optimistic placement: a new transit city must render at the END of the
    // route immediately. sortVisits orders by start_date, so a null-date node
    // would sort to the FRONT and then snap to the end once add_city →
    // recompute_trip returns real dates (the "jumps to the end" glitch). Seed it
    // with the trip's last known date (+ its nights) and a trailing position so it
    // lands in its final slot right away; it stays muted (tmp- id) until the
    // refetch swaps in real dates. 'start'/'end' are anchors ordered by rank, so
    // their dates don't affect placement.
    const provNights = kind === 'transit' ? 2 : null;
    const lastDate = draft.nodes.reduce((m, n) => { const e = n.end_date || n.start_date; return e && (!m || e > m) ? e : m; }, null);
    const maxPos = draft.nodes.reduce((m, n) => (Number.isFinite(n.position) && n.position > m ? n.position : m), -1);
    const provStart = kind === 'start' ? null : lastDate;
    const provEnd = provStart && kind === 'transit' ? toDT(provStart).plus({ days: provNights }).toISODate() : provStart;
    const node = {
      id: 'tmp-' + Math.random().toString(36).slice(2), kind,
      city_name: city.city_name, country_code: city.country_code || null,
      geonameid: city.geonameid ?? null, name_i18n: city.name_i18n || null,
      latitude: city.latitude ?? null, longitude: city.longitude ?? null,
      timezone: city.timezone || 'UTC', external_city_id: city.external_city_id || null,
      nights: provNights, gap: 0, start_date: provStart, end_date: provEnd,
      position: kind === 'start' ? -1 : maxPos + 1,
    };
    let insertIdx = null;
    // partial optimism: splice the tmp node into place; its dates stay null until
    // the server (add_city → recompute_trip) lays them and runAction refetches.
    // No client recompute — existing cities keep their dates.
    editDraft((d) => {
      const arr = d.nodes.slice();
      if (kind === 'start') { arr.unshift(node); insertIdx = 0; }
      else if (kind === 'end') { arr.push(node); insertIdx = null; }
      else { const endIdx = arr.findIndex((n) => n.kind === 'end'); insertIdx = endIdx === -1 ? null : endIdx; arr.splice(endIdx === -1 ? arr.length : endIdx, 0, node); }
      return { ...d, nodes: arr };
    });
    const tmpId = node.id; // swap this tmp- id for the real uuid the moment add_city returns
    runAction(() => rpcAddCity(tripId, {
      kind,
      geonameid: city.geonameid ?? null, name_i18n: city.name_i18n || null,
      city_name_en: city.city_name_en || null,
      country_code: city.country_code || null,
      latitude: city.latitude ?? null, longitude: city.longitude ?? null,
      timezone: city.timezone || null, external_city_id: city.external_city_id || null,
    }, insertIdx), (realId) => {
      if (realId) editDraft((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === tmpId ? { ...n, id: realId } : n)) }));
    });
  };
  const onPickCity = async (c, kind) => {
    closeLeftPanel();
    const tz = tzFromCoords(c.latitude, c.longitude);
    addCity({ ...c, timezone: tz }, kind);
  };

  // ---- conflict / transfer dialogs (REAL app dialogs → write to DB → refetch) ----
  const openConflict = (c) => {
    if (c.hotelId) setLeftPanel({ type: 'event', kind: 'hotel', id: c.hotelId, warning: c.message });
    else if (c.activityId) setLeftPanel({ type: 'event', kind: 'activity', id: c.activityId, warning: c.message });
    else if (c.transferId) setLeftPanel({ type: 'event', kind: 'transfer', id: c.transferId, warning: c.message });
    else toast({ description: `${c.message} ${t('tse.fix_hint_suffix')}`, variant: 'warning' });
  };
  const openTransferRow = (a, b, tr) => {
    if (tr) {
      // Hierarchy guarantees ≤1 issue per transfer → show that real message.
      const issue = issues.find((i) => i.transferId === tr.id);
      setLeftPanel({ type: 'event', kind: 'transfer', id: tr.id, warning: issue?.message || null });
      return;
    }
    if (isTmpId(a?.id) || isTmpId(b?.id)) return; // pending city → seam is muted; silent safety net
    setLeftPanel({ type: 'pick', kind: 'transfer', fromVisit: a, toVisit: b });
  };

  // Persistent app-header - rendered in EVERY branch (loading / blocked / error /
  // ready) so it never blanks out while the lock RPC + queries resolve. The page
  // title (name · dates · nights) lives in the LEFT column, not here; the header
  // is the global app bar + the editor action buttons.
  //   Undo     = revert the last single action (step back).
  //   Отменить = discard ALL edits, release the lock, return to the timeline.
  //   Сброс    = discard all edits but STAY in the editor.
  const headerEl = (
    <AppHeader
      isTrip
      user={user}
      isPro={accountPro}
      isDark={isDark}
      onToggleTheme={toggleTheme}
      onBack={() => leaveNow(`/trip/${tripId}`)}
      backTitle={t('tse.exit_editor')}
      onBrand={() => leaveNow('/trips')}
    />
  );

  // The map is always shown beside the itinerary now (the old "hide map" toggle
  // was removed); on phones it's hidden via CSS (.ts-col-right), so no toggle.

  // TRIP-56: distinguish the trip-load state instead of one catch-all "no
  // access", and read isPending + fetchStatus (not just error) so OFFLINE —
  // where React Query PAUSES the query and never throws — resolves to the retry
  // screen rather than a false "no access" (or, for content, an endless skeleton
  // since the draft can't build without it). 'auth' = session gone → /login;
  // 'temporary' = 500/network/offline → retry; 'access' (403/404) → no-access.
  // Mirrors TripView's gate (shared useQueryGate hook: classification + auto
  // /login on a dead session). Render stays per-screen.
  // emptyIsOk:false on both — single-resource fetches: an empty shell means "no
  // access" (belt over the thrown-403/404 path), and empty content can't build a
  // draft, so it must gate to retry rather than render an empty editor (TRIP-220).
  const shellGate = useQueryGate({ isPending: shellPending, fetchStatus: shellFetchStatus, error: shellError }, !!shell?.trip, false);
  const contentGate = useQueryGate({ isPending: contentPending, fetchStatus: contentFetchStatus, error: contentError }, !!content, false);
  if (shellGate === 'auth' || contentGate === 'auth') return <>{headerEl}</>;
  if (shellGate === 'temporary') return <TripLoadError onRetry={() => invalidateTripData(qc, tripId)} onBack={() => nav('/trips')} />;
  // not_found = no such trip / broken id (404) → neutral "doesn't exist", not
  // "no access". Split from 'access' in TRIP-208 (mirrors TripView).
  if (shellGate === 'not_found') return <PageNotFound />;
  if (shellGate === 'access') return <TripAccessError onBack={() => nav('/trips')} />;
  // Shell is fine but content can't be loaded (offline with nothing cached) →
  // the draft would never build → show the retry screen, not a forever-skeleton.
  // (content has no perms of its own, so any non-loadable state → retry.)
  if (contentGate === 'temporary' || contentGate === 'access' || contentGate === 'not_found') return <TripLoadError onRetry={() => invalidateTripData(qc, tripId)} onBack={() => nav('/trips')} />;
  // shell/content are cached (shared with TripView) so the editor paints instantly.
  if (shellGate === 'loading' || contentGate === 'loading' || !draft) {
    return <>{headerEl}<div style={{ maxWidth: 1380, margin: '0 auto', padding: 16 }}><Skeleton w="40%" h={28} style={{ marginBottom: 18 }} /><Skeleton w="100%" h={120} style={{ marginBottom: 10 }} /><Skeleton w="100%" h={120} /></div></>;
  }

  const ordered = sortVisits(draft.nodes);
  const seq = ordered.filter((n) => !isAnchor(n));          // cities + waypoints, in order
  // Header count = unique transit cities (a city visited twice counts once),
  // matching the trip header / overview / trips card everywhere.
  const cityCount = uniqueCityCount(draft.nodes);
  // Header date range — SAME formatter and SAME input (all draft nodes) as the
  // trip header in TripView, so the editor header reads identically (incl. the
  // year): "10 сент. – 4 окт. 2026".
  const dateRange = formatTripRange(draft.nodes, '-');
  const startDate = seq[0]?.start_date;
  const endDate = seq[seq.length - 1]?.end_date;
  const totalNights = nightsBetween(startDate, endDate);
  // Shared role rule: created_by wins over any trip_members row, so the creator
  // is never blocked from their own editor with "no access" (TRIP-143).
  const myRole = resolveMyRole(content?.members, trip, user);
  const isOwner = myRole === 'owner';
  // The /edit route is reachable by direct URL — a viewer has no edit rights, so
  // guard it here with the SAME shared "no access" stub used for shellError above
  // (role is resolved only after content loads, so this can't flash). Server-side
  // RLS hardening for direct REST writes is tracked as a separate task.
  if (!roleCanEdit(myRole)) return <TripAccessError onBack={() => nav(`/trip/${tripId}`)} />;
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
  // Anchor dates: start = trip start (first city's start); finish = last city's
  // end, +1 day when the final leg into the finish is an overnight transfer
  // (day_change) — mirrors server recompute_trip's gap rule.
  const endNode = ordered.find((n) => n.kind === 'end') || null;
  const finishTransfer = endNode ? arrivalFor(endNode.id) : null;
  const finishDate = endDate && finishTransfer?.day_change
    ? (toDT(endDate)?.plus({ days: 1 })?.toISODate() || endDate)
    : endDate;
  // panel navigation
  const openCity = (id) => { if (justDraggedRef.current) { justDraggedRef.current = false; return; } setLeftPanel({ type: 'city', id }); };
  const openEvent = (kind, id) => setLeftPanel({ type: 'event', kind, id, warning: (issues.find((i) => i[`${kind}Id`] === id)?.message) || null });
  // hotel/transfer/activity have partner offers → show the PickPanel ("Развилка")
  // first; others go straight to the form.
  // A hotel/activity can only attach to a city with a real uuid — block while the
  // city is still pending (tmp- id, add_city in flight) so the write can't hit an FK.
  const createBooking = (kind, node) => { if (isTmpId(node?.id)) return; setLeftPanel(kind === 'hotel' || kind === 'activity' ? { type: 'pick', kind, visit: node } : { type: 'create', kind, visit: node }); };
  // Stay numbering (only nights-cities are numbered).
  const stayNumById = {};
  { let sc = 0; ordered.forEach((n) => { if (n.kind === 'transit') stayNumById[n.id] = ++sc; }); }
  // Live preview order, FLIP reorder, keyboard move, pointer-drag arm/move/end and
  // justDraggedRef are all provided by the shared useRouteDnD hook instantiated
  // above (destructured: displayNodes, draggingId, overGap, setRowRef, armDrag,
  // moveNodeById, justDraggedRef). The hook's commit path is `commitOrder`.
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
        autoEdit={leftPanel.autoEdit} canEdit onClose={closePanelAndSync}
      />
    );
  } else if (leftPanel?.type === 'pick' || leftPanel?.type === 'create') {
    // TRIP-176: hotel / activity / transfer open the unified AddBookingPanel
    // (fork + manual form merged behind a tab). Services (esim/car/insurance)
    // keep the standalone fork → manual navigation.
    const isMergedKind = leftPanel.kind === 'hotel' || leftPanel.kind === 'activity' || leftPanel.kind === 'transfer';
    if (isMergedKind) {
      leftPanelEl = (
        <AddBookingPanel
          kind={leftPanel.kind} tripId={tripId} trip={trip}
          visit={leftPanel.visit} fromVisit={leftPanel.fromVisit} toVisit={leftPanel.toVisit}
          stay22={stay22Bundle}
          defaultCurrency={trip?.details?.main_currency || 'EUR'}
          initialTab={leftPanel.type === 'create' ? 'manual' : 'find'}
          onPreviewTransfer={setPreviewTransfer}
          onClose={() => { setPreviewTransfer(null); closePanelAndSync(); }}
        />
      );
    } else if (leftPanel.type === 'pick') {
      leftPanelEl = (
        <ForkPartnerModal
          open variant="panel" type={leftPanel.kind} tripId={tripId} trip={trip}
          visit={leftPanel.visit} fromVisit={leftPanel.fromVisit} toVisit={leftPanel.toVisit}
          stay22={stay22Bundle}
          onManual={() => setLeftPanel({ type: 'create', kind: leftPanel.kind, visit: leftPanel.visit, fromVisit: leftPanel.fromVisit, toVisit: leftPanel.toVisit })}
          onOpenChange={(o) => { if (!o) closeLeftPanel(); }}
        />
      );
    } else {
      leftPanelEl = (
        <EventEditDialog
          open variant="panel" kind={leftPanel.kind} tripId={tripId}
          visit={leftPanel.visit} fromVisit={leftPanel.fromVisit} toVisit={leftPanel.toVisit}
          defaultCurrency={trip?.details?.main_currency || 'EUR'}
          onPreviewTransfer={setPreviewTransfer}
          onOpenChange={(o) => { if (!o) { setPreviewTransfer(null); closePanelAndSync(); } }}
        />
      );
    }
  } else if (leftPanel?.type === 'city') {
    const node = ordered.find((n) => n.id === leftPanel.id);
    if (!node) { leftPanelEl = null; }
    else {
      const idx = ordered.indexOf(node);
      const prev = ordered.slice(0, idx).reverse().find((n) => !isAnchor(n) || n.kind === 'start');
      const next = ordered.slice(idx + 1).find((n) => !isAnchor(n) || n.kind === 'end');
      leftPanelEl = (
        <CityPanel
          node={node} cityNo={stayNumById[node.id]}
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
          onAddArrival={() => { if (!prev) return; if (isTmpId(prev.id) || isTmpId(node.id)) return; setLeftPanel({ type: 'pick', kind: 'transfer', fromVisit: prev, toVisit: node }); }}
          onAddDeparture={() => { if (!next) return; if (isTmpId(node.id) || isTmpId(next.id)) return; setLeftPanel({ type: 'pick', kind: 'transfer', fromVisit: node, toVisit: next }); }}
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
  // Which city node the open panel belongs to → its map marker shows the selected
  // state (single-city panels only; a transfer panel highlights no single city).
  let selectedNodeId = null;
  if (leftPanel?.type === 'city') {
    selectedNodeId = leftPanel.id;
  } else if (leftPanel?.type === 'event' && leftPanel.kind !== 'transfer') {
    const e = (leftPanel.kind === 'hotel' ? liveHotels : liveActivities).find((x) => x.id === leftPanel.id);
    selectedNodeId = e?.city_visit_id ?? null;
  } else if ((leftPanel?.type === 'create' || leftPanel?.type === 'pick') && leftPanel.kind !== 'transfer') {
    selectedNodeId = leftPanel.visit?.id ?? null;
  }
  // When a transfer panel is open, that leg shows the "selected route" state on
  // the map. We pass only the leg's id pair; MapView resolves geometry + kind
  // from the live transfers (which include the in-progress previewTransfer), so
  // the highlight is a single arc that updates as transport is added/changed.
  let selectedLegKey = null;
  if (leftPanel?.type === 'event' && leftPanel.kind === 'transfer') {
    const tr = liveTransfers.find((x) => x.id === leftPanel.id);
    if (tr) selectedLegKey = `${tr.from_city_visit_id}__${tr.to_city_visit_id}`;
  } else if ((leftPanel?.type === 'create' || leftPanel?.type === 'pick') && leftPanel.kind === 'transfer') {
    if (leftPanel.fromVisit?.id && leftPanel.toVisit?.id) {
      selectedLegKey = `${leftPanel.fromVisit.id}__${leftPanel.toVisit.id}`;
    }
  }
  // Key the left pane on its identity so React remounts it on panel change →
  // the .te-panefade entry animation replays.
  const panelKey = leftPanel ? `${leftPanel.type}:${leftPanel.id || leftPanel.kind || ''}` : 'list';
  // TRIP-161: on the desktop two-column layout every side panel EXCEPT "add
  // city" opens as a full-height drawer over the left column (route rail stays
  // mounted underneath; the map keeps interactive — no scrim). Add-city and the
  // ≤1080 / ≤640 fallbacks keep swapping the rail in place.
  const isDrawerPanel = !!leftPanel && leftPanel.type !== 'cityadd';
  const useDrawer = isWide && isDrawerPanel && !!leftPanelEl;
  const onPanelEsc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeLeftPanel(); } };

  // Trip-start control — lives in the "Маршрут" panel header. The stepper shifts
  // the whole itinerary by ±1 day; tapping the date opens a calendar to jump to
  // any start (translated into a single delta shift, reusing shiftStart).
  const pickStart = (iso) => {
    if (!iso || !draft?.startDate) return;
    const delta = Math.round(toDT(iso).startOf('day').diff(toDT(draft.startDate).startOf('day'), 'days').days);
    if (delta !== 0) shiftStart(delta);
  };
  // Shared trip-start control (one element with the planner). The editor steps
  // by ±1 day via shiftStart and jumps via pickStart (delta → shiftStart).
  const startDateControl = draft ? (
    <TripStartControl date={draft.startDate} onStep={(d) => shiftStart(d)} onPickDate={pickStart} label={t('ai_plan.start')} popoverAlign="end" />
  ) : null;

  // Trip actions (Share / Settings / Members) all live in the left trip menu
  // (TripSidebar drawer); Copy trip moved into the Settings lens. The editor
  // header carries no duplicate buttons.

  return (
    <div className="ts-screen" style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--surface)' }}>
    <AppHeader
      isTrip
      user={user}
      isPro={accountPro}
      isDark={isDark}
      onToggleTheme={toggleTheme}
      onBack={() => leaveNow(`/trip/${tripId}`)}
      backTitle={t('tse.exit_editor')}
      onBrand={() => leaveNow('/trips')}
      onMenu={() => setSideOpen(true)}
      title={trip?.title}
      meta={
        <>
          {dateRange && dateRange !== '-' && <span>{dateRange}</span>}
          {totalNights != null && <><span>·</span><span>{totalNights} {dayWord(totalNights, t)}</span></>}
          {cityCount > 0 && <><span>·</span><span>{cityCount} {cityCount === 1 ? t('trip.cities_count_one') : t('trip.cities_count_many')}</span></>}
        </>
      }
    />
    {/* Mobile menu drawer — burger opens the full sidebar (the static icon-rail
        is hidden on mobile). */}
    <div className={'ts-drawer' + (sideOpen ? ' is-open' : '')}>
      <div className="ts-drawer__scrim" onClick={() => setSideOpen(false)} />
      <TripSidebar
        tripId={tripId} trip={trip} isEditScreen
        onNavigate={(id) => { setSideOpen(false); leaveNow(`/trip/${tripId}?lens=${id}`); }}
        isPro={tripIsPro} proResolved={tripProResolved} isOwner={isOwner} myRole={myRole}
        onUpgrade={() => nav(`/pro?tripId=${tripId}`)}
        onProInfo={() => { setSideOpen(false); openProInfo(); }}
        onShare={() => setShareOpen(true)}
      />
    </div>
    <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
      <div className="ts-sidecol">
        <TripSidebar
          tripId={tripId} trip={trip} isEditScreen
          onNavigate={(id) => leaveNow(`/trip/${tripId}?lens=${id}`)}
          isPro={tripIsPro} proResolved={tripProResolved} isOwner={isOwner} myRole={myRole}
          onUpgrade={() => nav(`/pro?tripId=${tripId}`)}
          onProInfo={openProInfo}
          onShare={() => setShareOpen(true)}
        />
      </div>
      {/* content column — screen-title bar sits BESIDE the sidebar (like every
          other screen) so the menu doesn't shift when navigating into the editor */}
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Two columns: itinerary (left, with the "Маршрут" panel header) + the
          always-on map (right). The per-screen title bar was removed; the map
          starts at the same top edge as the route header. On phones the map is
          hidden via CSS (.ts-col-right) and the itinerary spans full width. */}
      <div className="ts-grid" style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 0, overflow: 'hidden' }}>
        {/* LEFT - bordered container (same 14px inset / radius as the map box on
            the right). The "Маршрут" header is the container's header; an open
            side panel fills the same box. */}
        <div className="ts-col-left" style={{ position: 'relative', minWidth: 0, display: 'flex', minHeight: 0, background: 'var(--bg)' }}>
          <div className="ts-leftbox">
          <div key={useDrawer ? 'list' : panelKey} ref={useDrawer ? null : leftPaneRef} tabIndex={-1} onKeyDown={(leftPanel && !useDrawer) ? onPanelEsc : undefined} className="te-panefade" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', outline: 'none' }}>
          {/* Desktop (>1080): "add city" replaces the column; other panels open as
              a drawer overlay (below) and the rail stays here. ≤1080: the panel
              replaces the column. ≤640: the column keeps the cities list and the
              panel opens as a Radix bottom-sheet (rendered below). */}
          {(!isSheet && !useDrawer && leftPanelEl) || (<>
          <div className="scrollbar-thin ts-leftscroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '12px 12px 18px', background: 'transparent' }}>
          {/* "Маршрут" container header — scrolls WITH the list (not sticky), the
              same as on mobile. A left panel replaces this whole column. */}
          <div className="ts-routehead">
            <span className="ts-routehead__tt">
              <span className="ts-routehead__title t-mono tp-caption">{t('planner.step_cities')}</span>
              {/* TRIP-186: сводка маршрута под заголовком — реюз уже посчитанных
                  totalNights / cityCount / dateRange (никакой новой логики). */}
              {(totalNights != null || cityCount > 0 || (dateRange && dateRange !== '-')) && (
                <span className="ts-routehead__sub t-meta">
                  {[
                    totalNights != null ? `${totalNights} ${dayWord(totalNights, t)}` : null,
                    cityCount > 0 ? `${cityCount} ${cityCount === 1 ? t('trip.cities_count_one') : t('trip.cities_count_many')}` : null,
                    dateRange && dateRange !== '-' ? dateRange : null,
                  ].filter(Boolean).join(' · ')}
                </span>
              )}
            </span>
            <span className="ts-routehead__sp" />
            {startDateControl}
          </div>
          <div className="te-thead" style={{ padding: '0 4px 6px' }}>
            <span className="te-th" style={{ gridColumn: 3 }}>{t('tse.col_destination')}</span>
            <span className="te-th te-th--c" style={{ gridColumn: 4 }}>{t('tse.col_nights')}</span>
            <span className="te-th te-th--c" style={{ gridColumn: 5 }}>{t('tse.col_stay')}</span>
            <span className="te-th te-th--c" style={{ gridColumn: 6 }}>{t('budget.source_activity')}</span>
          </div>
          <div className={'te-table' + (draggingId != null ? ' is-dragging' : '')}>
            {displayNodes.map((n) => {
              const next = displayNodes[displayNodes.indexOf(n) + 1];
              const tr = next ? transferFor(n.id, next.id) : null;
              const pending = isTmpId(n.id);       // city awaiting its real uuid (add_city in flight) → muted, non-editable
              const dragging = draggingId === n.id;
              const dragProps = {
                dragging,
                pressing: pressingId === n.id,
                onArm: (e) => armDrag(e, n.id),
                onMove: (dir) => moveNodeById(n.id, dir),
              };
              let body;
              if (isAnchor(n)) {
                body = <GridEndpoint node={n} date={n.kind === 'start' ? draft.startDate : finishDate} onRemove={() => removeCity(n.id)} />;
              } else if (n.kind === 'waypoint') {
                const aa = actsFor(n.id);
                body = <GridNode seg={n} cityConf={cityConflicts(n.id)} acts={aa} actWarn={aa.some((a) => actWarnId(a.id))}
                  onOpenCity={() => openCity(n.id)}
                  onAct={() => (aa.length ? openCity(n.id) : createBooking('activity', n))}
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
                <div className={'te-seamwrap' + (pending ? ' is-pending' : '')} key={n.id} ref={setRowRef(n.id)}
                  onMouseEnter={() => setHoveredNodeId(n.id)}
                  onMouseLeave={() => setHoveredNodeId((p) => (p === n.id ? null : p))}>
                  {body}
                  {/* Transfer chip straddles the seam to the next city. Stays
                      mounted during drag but melts away via CSS (.is-dragging),
                      then eases back on drop — adjacency is in flux mid-drag.
                      A seam touching a pending (tmp) city on either side is muted
                      (the incoming seam lives in the PREVIOUS row, so pass it
                      explicitly — CSS from this wrap can't reach it). */}
                  {next && (
                    <SeamTransfer a={n} b={next} t={tr} mismatch={transferMismatch(tr)} disabled={pending || isTmpId(next.id)} onOpen={() => openTransferRow(n, next, tr)} />
                  )}
                </div>
              );
            })}
          </div>

          {draggingId != null && ordered[ordered.length - 1]?.kind !== 'end' && (
            <div className="t-meta" style={{ marginTop: 8, height: 36, display: 'grid', placeItems: 'center', borderRadius: 8, border: '1.5px dashed ' + (overGap === ordered.length ? 'var(--brand)' : 'var(--line-2)'), color: overGap === ordered.length ? 'var(--brand)' : 'var(--muted)', transition: 'color .15s var(--ease-out), border-color .15s var(--ease-out)' }}>
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
                  <button key={tr.id} onClick={() => openEvent('transfer', tr.id)} className="t-meta" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 999, background: 'var(--surface)', border: '1px solid var(--line)', cursor: 'pointer', color: 'var(--ink)' }}>
                    <Icon name="warning" size={12} style={{ color: 'var(--warning)' }} /> {nodeName(tr.from_city_visit_id)} → {nodeName(tr.to_city_visit_id)}
                  </button>
                ))}
              </div>
            </div>
          )}
          </div>{/* /ts-leftscroll */}
          </>)}
          </div>{/* /te-panefade */}

          {/* Mobile: the editor panel opens as a bottom sheet — the SAME vaul
              Drawer engine as modals (native swipe + keyboard-safe reposition).
              Backdrop tap / swipe-down / the panel's own Back all close it. */}
          {isSheet && leftPanelEl && (
            <Drawer.Root open onOpenChange={(o) => { if (!o) closeLeftPanel(); }}>
              <Drawer.Portal>
                <Drawer.Overlay className="sheet-backdrop" />
                <Drawer.Content
                  className="lp-sheet"
                  aria-describedby={undefined}
                >
                  <Drawer.Title className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{t('trip.edit_structure')}</Drawer.Title>
                  {leftPanelEl}
                </Drawer.Content>
              </Drawer.Portal>
            </Drawer.Root>
          )}
          </div>{/* /ts-leftbox */}

          {/* TRIP-161: side-panel DRAWER (city / fork / event view+edit) on the
              desktop two-column layout. Overlays the left column edge-to-edge, up
              to the map — no scrim, so the map (and its hotel pins) stays
              interactive. The route rail stays mounted underneath. */}
          {useDrawer && (
            <div key={panelKey} ref={leftPaneRef} tabIndex={-1} onKeyDown={onPanelEsc} className="ts-pdrawer">
              {leftPanelEl}
            </div>
          )}
        </div>

        {/* RIGHT - full-height map (always on; hidden on phones via CSS);
            warnings live in a collapsible overlay widget */}
        <div className="ts-col-right" style={{ position: 'relative', minWidth: 0, minHeight: 0, background: 'var(--bg)' }}>
          <div className="ts-map" style={{ position: 'absolute', inset: 14, left: 7, overflow: 'hidden', borderRadius: 16, border: '1px solid var(--line)' }}>
            <MapView visits={draft.nodes} transfers={mapTransfers} visitsById={Object.fromEntries(draft.nodes.map((v) => [v.id, v]))} showStartEnd mapControls
              focus={mapFocus}
              onCityClick={(pts) => { const v = (pts || []).find((x) => !isAnchor(x)) || (pts || [])[0]; if (v) openCity(v.id); }}
              selectedVisitId={selectedNodeId}
              hoveredVisitId={hoveredNodeId}
              selectedLegKey={selectedLegKey}
              hideRoute={isHotelPick}
              hotelPins={hotelPins}
              selectedHotelId={staySelectedId}
              hoveredHotelId={stayHoveredId}
              onHotelClick={(id) => { if (staySelectedId != null && String(staySelectedId) === String(id)) openHotelLink(id); else setStaySelectedId(id); }}
              onHotelHover={setStayHoveredId}
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
                <span className="t-micro" style={{ position: 'absolute', top: -3, right: -3, minWidth: 20, height: 20, padding: '0 5px', borderRadius: 999, background: 'var(--surface)', color: 'var(--warning)', border: '2px solid var(--warning)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  {issues.length > 99 ? '99+' : issues.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>{/* /ts-grid */}
      </div>{/* /editor content column */}
    </div>


      <style>{`
        .ts-step { border: none; background: transparent; border-radius: 8px; color: var(--ink-2); cursor: pointer; display: grid; place-items: center; width: 26px; height: 26px; transition: background .12s var(--ease-out), transform .1s var(--ease-out); }
        .ts-step:hover { background: var(--wash); }
        .ts-step:active:not(:disabled) { transform: scale(0.9); }
        .ts-step:disabled { opacity: .3; cursor: default; }
        .ts-in { width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 9px; background: var(--surface); color: var(--ink); }
        /* TRIP-186: левая колонка «оголена» — контейнерная рамка/радиус/фон и
           маржины убраны, рейл и заголовок «Маршрут» лежат прямо на канвасе, а
           список растягивается. Карта справа рамку сохраняет. */
        .ts-leftbox { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; margin: 0; overflow: hidden; background: transparent; }
        /* Открытая боковая панель теперь сама себе рамка (карточка на канвасе),
           с тем же инсетом, что и карта. */
        .ts-leftbox .lp { margin: 14px 7px 14px 14px; }
        /* Заголовок «Маршрут» скроллится со списком, выровнен с колонками. */
        .ts-leftscroll > .ts-routehead { margin: 0 0 8px; }
        /* "Маршрут" panel header (left column) + trip-start control. */
        .ts-routehead { display: flex; align-items: center; gap: 10px; flex: none; padding: 12px 4px; }
        .ts-routehead__tt { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        /* TRIP-188: «Маршрут» = класс "t-mono tp-caption" (моно + caption-модификатор
           капс/трекинг/синий, app.css). Своего правила на .ts-routehead__title тут нет —
           иначе scoped-специфичность styled-jsx перебила бы .tp-caption. */
        .ts-routehead__sub { color: var(--muted); }
        .ts-routehead__sp { flex: 1; }
        .ts-startctl { display: inline-flex; align-items: center; gap: 2px; background: var(--surface); border: 1px solid var(--line); border-radius: 9px; padding: 2px; }
        .ts-startctl__lbl { color: var(--muted); padding: 0 4px 0 6px; }
        .ts-startctl__date { border: none; background: transparent; cursor: pointer; padding: 3px 8px; border-radius: 7px; color: var(--ink); white-space: nowrap; }
        .ts-startctl__date:hover { background: var(--wash); }
        /* Trip-start calendar popover content. */
        .ts-cal { width: 248px; }
        .ts-cal__head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
        .ts-cal__title { color: var(--ink); text-transform: capitalize; }
        .ts-cal__grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
        .ts-cal__wd { margin-bottom: 4px; }
        .ts-cal__wdc { text-align: center; color: var(--muted); text-transform: capitalize; padding: 2px 0; }
        .ts-cal__day { aspect-ratio: 1 / 1; border: none; background: transparent; border-radius: 8px; cursor: pointer; color: var(--ink); display: grid; place-items: center; }
        .ts-cal__day:hover { background: var(--wash); }
        .ts-cal__day.on { background: var(--brand); color: #fff; }
        /* In the mobile bottom-sheet the calendar spans the sheet width. */
        .sheet .ts-cal { width: 100%; max-width: 340px; margin: 0 auto; }
        @media (max-width: 520px) { .ts-startctl__lbl { display: none; } }
        .te-panefade { animation: tePaneIn .2s var(--ease-out) both; }
        @keyframes tePaneIn { from { opacity: 0; transform: translateX(10px); } to { opacity: 1; transform: none; } }
        /* TRIP-176: side-panel drawer. Absolute-fills the LEFT column only — below
           the app header and to the right of the icon rail — so it never covers the
           header or the left menu. Stops at the column seam, leaving the natural gap
           to the map. No scrim: the map (right half) stays interactive. Route rail
           mounted beneath. Desktop two-column only. */
        .ts-pdrawer { position: absolute; inset: 0; z-index: 20; display: flex; flex-direction: column; background: var(--surface); border-right: 1px solid var(--line); box-shadow: var(--sh-2); animation: tsDrawerIn .24s var(--ease-out) both; }
        .ts-pdrawer > .lp { flex: 1; min-height: 0; border: none; border-radius: 0; box-shadow: none; }
        @keyframes tsDrawerIn { from { opacity: 0; transform: translateX(-24px); } to { opacity: 1; transform: none; } }
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
          .te-panefade, .ts-confirm-backdrop, .ts-confirm-card, .ts-pdrawer { animation: none; }
          .ts-fab:hover, .ts-fab:active, .ts-step:active { transform: none; }
        }
        @media (max-width: 1080px) {
          .ts-screen { height: auto !important; min-height: 100vh; overflow: visible !important; }
          .ts-grid { grid-template-columns: 1fr !important; overflow: visible !important; }
          .ts-leftscroll { overflow: visible !important; }
          .ts-leftbox { margin: 0 !important; }
          .ts-map { flex: 0 0 340px !important; left: 14px !important; }
          .ts-warn { flex: 0 0 auto !important; min-height: 300px; }
        }
      `}</style>
      {/* Unsaved-changes guard when leaving the editor (menu / logo / back). */}
      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} trip={trip} visits={draft?.nodes || []} transfers={liveTransfers} />

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
      <Icon name="ticket" size={14} /> <Icon name="plus" size={12} />
    </button>
  );
  return (
    <button className={'te-actchip' + (warn ? ' is-warn' : '')} onClick={onClick} title={count + ''}>
      <Icon name="ticket" size={13} style={{ color: warn ? 'var(--warning)' : 'var(--ev-activity)' }} />
      <span className="num t-meta">{count}</span>
      {warn && <Icon name="warning" size={11} style={{ color: 'var(--warning)' }} />}
    </button>
  );
}

function GridNode({ seg, stayNum, cityConf, hotel, hotelWarn, acts = [], actWarn, onOpenCity, onHotel, onAct, onNightsMinus, onNightsPlus, drag }) {
  const t = useT();
  const { lang } = useI18n();
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
      <CityRow variant="editor" dragging={drag.dragging} pressing={drag.pressing} onArm={drag.onArm} onClick={onOpenCity}
        grip={gripEl}
        lead={<span className="te-row__node" style={{ background: 'transparent', color: 'var(--ev-transfer)', border: '1.5px dashed var(--ev-transfer)' }}><Icon name="arrowSwap" size={11} /></span>}
        name={seg.city_name}
        conf={<Conf n={cityConf} />}
        dates={<><span className="te-wptag">{t('tse.layover')}</span>{fmtD(seg.start_date, lang)}</>}>
        <NightsStepper value={0} onMinus={onNightsMinus} onPlus={onNightsPlus} minusDisabled />
        <div className="te-cell te-cell--hotel" />
        <div className="te-cell te-cell--act" onClick={stop}><ActCell count={acts.length} warn={actWarn} onClick={onAct} /></div>
      </CityRow>
    );
  }
  return (
    <CityRow variant="editor" dragging={drag.dragging} pressing={drag.pressing} onArm={drag.onArm} onClick={onOpenCity}
      grip={gripEl}
      lead={<span className={'te-row__num' + (cityConf ? ' is-warn' : '')}>{stayNum}</span>}
      name={seg.city_name}
      conf={<Conf n={cityConf} />}
      dates={<>{fmtD(seg.start_date, lang)} – {fmtD(seg.end_date, lang)}</>}>
      <NightsStepper value={seg.nights} onMinus={onNightsMinus} onPlus={onNightsPlus} minusDisabled={(seg.nights || 0) <= 0} />
      <div className="te-cell te-cell--hotel" onClick={stop}><HotelCell hotel={hotel} warn={hotelWarn} onClick={onHotel} /></div>
      <div className="te-cell te-cell--act" onClick={stop}><ActCell count={acts.length} warn={actWarn} onClick={onAct} /></div>
    </CityRow>
  );
}

// Transfer chip that STRADDLES the seam between two city rows (sits on the
// separator line, its surface bg covering it — it doesn't split the rows). A pill
// when the transfer exists, a dashed "+ переезд" when not. Click → transport panel
// (existing) or the "Развилка" pick panel (new). Same-city legs show nothing.
function SeamTransfer({ a, b, t, mismatch, disabled, onOpen }) {
  const tx = useT();
  const { lang } = useI18n();
  const sameCity = (a.external_city_id && b.external_city_id && a.external_city_id === b.external_city_id) || (a.city_name && a.city_name === b.city_name);
  if (sameCity && !t) return null;
  const click = disabled ? undefined : onOpen; // a seam next to a pending city is inert
  if (!t) {
    return (
      <div className="te-seam">
        <button className={'te-seam__pill te-seam__pill--add' + (disabled ? ' is-disabled' : '')} disabled={disabled} onClick={click} title={`${a.city_name} → ${b.city_name}`}>
          <Icon name="plus" size={11} /> {tx('tse.add_transfer')}
        </button>
      </div>
    );
  }
  const meta = TKIND[t.transport_type] || TKIND.train;
  return (
    <div className="te-seam">
      <button className={'te-seam__pill' + (mismatch ? ' is-warn' : '') + (disabled ? ' is-disabled' : '')} disabled={disabled} onClick={click} title={`${a.city_name} → ${b.city_name}`}>
        <Icon name={mismatch ? 'warning' : meta.icon} size={12} style={{ color: mismatch ? 'var(--warning)' : 'var(--ev-transfer)' }} />
        <span className="t-meta" style={{ color: mismatch ? 'var(--warning)' : 'var(--ev-transfer-ink)' }}>{tx(meta.labelKey)}{mismatch ? tx('tse.mismatch_suffix') : ''}</span>
        {t.day_change && <Icon name="moon" size={11} style={{ color: 'var(--brand)' }} title={tx('tse.overnight_title')} />}
        <span className="num muted t-meta">· {fmtD(t.start_datetime, lang)}</span>
      </button>
    </div>
  );
}

// Start / Finish anchor row — flag (start) / check (finish) node, label + city,
// departure/arrival date below. Flat flex row in the itinerary table.
function GridEndpoint({ node, date, onRemove }) {
  const t = useT();
  const { lang } = useI18n();
  const isStart = node.kind === 'start';
  const accent = isStart ? 'var(--brand)' : 'var(--success-ink)';
  const soft = isStart ? 'var(--brand-soft)' : 'var(--success-soft)';
  return (
    <div className="te-end">
      <span className="te-row__node" style={{ background: soft, color: accent }}><Icon name={isStart ? 'flag' : 'check'} size={13} /></span>
      <div className="te-citycell" style={{ flex: 1 }}>
        <span className="te-endlabel" style={{ color: accent }}>{isStart ? t('ai_plan.start') : t('ai_plan.end')}</span>
        <div className="te-cityline">
          <span className="te-cityname">{node.city_name}</span>
        </div>
        <div className="te-dts">
          {isStart ? t('tse.departure_word') : t('tse.arrival_word')} · {fmtD(date || node.start_date || node.end_date, lang)}
        </div>
      </div>
      <button className="ts-step" style={{ width: 24, height: 24, color: 'var(--muted)', flexShrink: 0 }} onClick={onRemove} title={t('tse.remove')}><Icon name="close" size={13} /></button>
    </div>
  );
}

function AddPointButton({ onOpen }) {
  const t = useT();
  return <button className="btn btn--soft btn--block" onClick={onOpen} style={{ marginTop: 12 }}>
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
    <div className="lp lp--wide" style={{ '--ev-soft': 'var(--brand-soft)', '--ev-ink': 'var(--brand)' }}>
      <div className="lp-h lp-h--ev">
        <button className="lp-back" onClick={onBack} title={t('common.back')}><Icon name="back" size={14} /></button>
        <span className="lp-ic" style={{ background: 'var(--brand)', color: '#fff' }}><Icon name="pin" size={17} /></span>
        <div className="lp-ti">
          <b>{t('tse.add_point')}</b>
          <span>{t('tse.add_point_hint')}</span>
        </div>
      </div>
      <div className="lp-b scrollbar-thin">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 7 }}>
          {POINT_TYPES.map((pt) => {
            const dis = disabledFor(pt.id), active = type === pt.id;
            return <button key={pt.id} disabled={dis} onClick={() => setType(pt.id)} title={dis ? t('tse.already_set') : t(pt.subKey)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, padding: '11px 6px', borderRadius: 11, cursor: dis ? 'not-allowed' : 'pointer', background: active ? 'var(--brand-soft)' : 'var(--surface)', border: '1px solid ' + (active ? 'var(--brand)' : 'var(--line)'), color: dis ? 'var(--muted-2)' : active ? 'var(--brand)' : 'var(--ink-2)', opacity: dis ? 0.5 : 1 }}>
              <Icon name={pt.icon} size={17} /><span className="t-meta">{t(pt.labelKey)}</span>
            </button>;
          })}
        </div>
        <div className="muted t-meta">{meta ? t(meta.subKey) : ''}</div>
        <CitySearch onSelect={(c) => onPick(c, type)} />
      </div>
      <div className="lp-f lp-f--single">
        <Btn variant="secondary" onClick={onBack}>{t('common.cancel')}</Btn>
      </div>
    </div>
  );
}

// (Conflicts and transfer rows now open in-place LEFT panels: EventSourcePanel
//  for view/edit/delete, EventEditDialog variant="panel" for transfer create.
//  The old view/add modals were removed in the panel redesign Ф3.)
