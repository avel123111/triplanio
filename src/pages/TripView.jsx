import React, { useMemo, useState, useEffect } from 'react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Share2, MoreVertical, Loader2, Copy, Trash2, Crown, Link2, Check, FileDown, Settings as SettingsIcon } from 'lucide-react';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import TripSummary from '@/components/trips/TripSummary';
import TripMembersCard from '@/components/trips/TripMembersCard';
import TripBudgetCard from '@/components/trips/TripBudgetCard';
import TripServicesCard from '@/components/trips/TripServicesCard';
import ReadOnlyTimelineView from '@/components/views/ReadOnlyTimelineView';
import CalendarView from '@/components/views/CalendarView';
import MapView from '@/components/views/MapView';
import HotelViewDialog from '@/components/hotels/HotelViewDialog';
import TransferViewDialog from '@/components/transfers/TransferViewDialog';
import ActivityViewDialog from '@/components/activities/ActivityViewDialog';
import CarRentalViewDialog from '@/components/services/CarRentalViewDialog';
import HotelDialog from '@/components/hotels/HotelDialog';
import TransferDialog from '@/components/transfers/TransferDialog';
import ActivityDialog from '@/components/activities/ActivityDialog';
import CarRentalDialog from '@/components/services/CarRentalDialog';
import CityVisitDialog from '@/components/visits/CityVisitDialog';
import TripDocumentsTab from '@/components/documents/TripDocumentsTab';
import TripChatTab from '@/components/chat/TripChatTab';
import { useUnreadChatCount } from '@/lib/chat';
import TripAccessDenied from '@/components/TripAccessDenied';
import CollapsibleSection from '@/components/common/CollapsibleSection';
import MapSettingsBar from '@/components/views/MapSettingsBar';
import MapCityPanel from '@/components/views/MapCityPanel';
import BookingChoiceDialog from '@/components/bookings/BookingChoiceDialog';
import { hotelPlatforms } from '@/components/bookings/buildBookingPlatforms';
import { Users, Wallet, Sparkles, MapPin } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useTheme } from '@/lib/ThemeContext';
import { computeTripRange, latestEventDate, isTripInPast } from '@/lib/trip-dates';
import { uniqueCityCount } from '@/lib/trip-cities';
import TripLimitDialog from '@/components/subscriptions/TripLimitDialog';
import UpgradePlanDialog from '@/components/subscriptions/UpgradePlanDialog';
import TripViewSkeleton, { TimelineSkeleton } from '@/components/trips/TripViewSkeleton';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import PullToRefresh from '@/components/common/PullToRefresh';
import { TRIP_SHELL_KEY, TRIP_CONTENT_KEY } from '@/lib/trip-data';
import { sortVisits } from '@/lib/validation';
import { ADDON_KEYS, isAddonEnabled } from '@/lib/tripAddons';
import { DateTime } from 'luxon';
import { naiveDayKey } from '@/lib/naive-time';
import TripShell from '@/components/trips/TripShell';
import ShareTripDialog from '@/components/trips/ShareTripDialog';

// Builds the "Apr 5 – Apr 12 • 8 days • 3 cities" subtitle.
// Uses Luxon for locale-aware month names and our pluralizer for "days/cities".
function buildTripSubtitle(range, visits, locale, plural) {
  if (!range?.start || !range?.end) return null;
  const startDt = DateTime.fromJSDate(new Date(range.start)).setLocale(locale);
  const endDt = DateTime.fromJSDate(new Date(range.end)).setLocale(locale);
  const start = startDt.toFormat('LLL d');
  const end = endDt.toFormat('LLL d');
  const msPerDay = 1000 * 60 * 60 * 24;
  const days = Math.max(1, Math.round((new Date(range.end) - new Date(range.start)) / msPerDay) + 1);
  const cityCount = uniqueCityCount(visits);
  const cityStr = cityCount > 0 ? ` • ${cityCount} ${plural(cityCount, 'trip.cities_count')}` : '';
  return `${start} – ${end} • ${days} ${plural(days, 'trip.days')}${cityStr}`;
}

export default function TripView() {
  const { tripId } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { t, plural, locale, lang } = useI18nFormat();
  const isSystemAdmin = user?.role === 'admin';

  // Stripe return handling is centralised in <Layout> — it shows the
  // "Welcome to Pro" dialog and strips the query params. Here we only need
  // to invalidate trip-scoped caches so the page reflects the new Pro status.
  useEffect(() => {
    if (searchParams.get('stripe_status') === 'success') {
      qc.invalidateQueries({ queryKey: ['trip', tripId] });
      qc.invalidateQueries({ queryKey: ['trip-pro', tripId] });
    }
  }, [searchParams, tripId, qc]);

  // The active "lens" (timeline / map / calendar / documents / chat) is
  // controlled by the ?lens= query param so URLs are shareable/bookmarkable.
  // Default = "timeline".
  const tab = searchParams.get('lens') || 'timeline';
  const setTab = (next) => {
    const sp = new URLSearchParams(searchParams);
    if (next === 'timeline') sp.delete('lens');
    else sp.set('lens', next);
    setSearchParams(sp, { replace: false });
  };
  // Ensure the viewport always starts at the top of the page when opening a
  // trip — prevents the browser from restoring a mid-page scroll position
  // after the skeleton is swapped for real content.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tripId]);
  const [selectedDayKey, setSelectedDayKey] = useState(null);
  const [eventDaysByKey, setEventDaysByKey] = useState({});
  const [hotelView, setHotelView] = useState({ open: false, hotel: null });
  const [transferView, setTransferView] = useState({ open: false, transfer: null });
  const [activityView, setActivityView] = useState({ open: false, activity: null });
  const [carRentalView, setCarRentalView] = useState({ open: false, service: null });
  const [hotelEdit, setHotelEdit] = useState({ open: false, visit: null, hotel: null });
  const [transferEdit, setTransferEdit] = useState({ open: false, fromVisit: null, toVisit: null, transfer: null });
  const [activityEdit, setActivityEdit] = useState({ open: false, visit: null, activity: null });
  const [carRentalEdit, setCarRentalEdit] = useState({ open: false, service: null });
  const [visitEdit, setVisitEdit] = useState({ open: false, visit: null });
  const [newCityOpen, setNewCityOpen] = useState(false);
  const [newCityDefaultDay, setNewCityDefaultDay] = useState(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [confirmDelTrip, setConfirmDelTrip] = useState(false);
  const [confirmDelProTrip, setConfirmDelProTrip] = useState(false);
  const [confirmCopyTrip, setConfirmCopyTrip] = useState(false);
  // Shown when user taps "See details" on the budget card but the Budget
  // addon is disabled — offers to open trip settings to enable it.
  const [budgetAddonPromptOpen, setBudgetAddonPromptOpen] = useState(false);
  const [alertDialog, setAlertDialog] = useState({ open: false, title: '', description: '' });
  const showAlert = (title, description) => setAlertDialog({ open: true, title, description });

  // Map-tab UI state
  const [showStartEnd, setShowStartEnd] = useState(() => {
    try {
      const raw = localStorage.getItem('map:showStartEnd');
      return raw === null ? true : raw === '1';
    } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem('map:showStartEnd', showStartEnd ? '1' : '0'); } catch { /* ignore */ }
  }, [showStartEnd]);
  // Map theme: 'auto' (follow app theme) | 'light' | 'dark'. Persisted.
  const [mapTheme, setMapTheme] = useState(() => {
    try { return localStorage.getItem('map:theme') || 'auto'; } catch { return 'auto'; }
  });
  useEffect(() => {
    try { localStorage.setItem('map:theme', mapTheme); } catch { /* ignore */ }
  }, [mapTheme]);
  const { theme: appTheme } = useTheme();
  const isAppDark = appTheme === 'dark'
    || (appTheme === 'system' && typeof window !== 'undefined'
        && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const mapColorScheme = mapTheme === 'dark' || (mapTheme === 'auto' && isAppDark) ? 'DARK' : 'LIGHT';
  // List of visit IDs for the currently-selected map marker
  // (one marker can group multiple visits to the same city).
  const [selectedCityVisitIds, setSelectedCityVisitIds] = useState([]);
  // BookingChoice dialog state when "+ Добавить" hotel is pressed on the map panel
  const [hotelChoice, setHotelChoice] = useState({ open: false, visit: null });

  const handleExportPdf = async () => {
    try {
      setPdfLoading(true);
      const res = await base44.functions.invoke('exportTripPdf', { tripId, lang });
      // base44.functions.invoke returns an axios-like response. For binary
      // bodies we need to coerce response.data into a Blob for download.
      const blob = res?.data instanceof Blob
        ? res.data
        : new Blob([res?.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(trip?.title || 'trip').replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'trip'}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error(err);
      showAlert(t('trip.export_pdf_error'), err?.message || '');
    } finally {
      setPdfLoading(false);
    }
  };

  // Pull-to-refresh: refetch the trip shell + content. Awaits both queries
  // so the spinner stays visible until fresh data lands.
  const handleRefresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: TRIP_SHELL_KEY(tripId) }),
      qc.invalidateQueries({ queryKey: TRIP_CONTENT_KEY(tripId) }),
    ]);
  };

  const handleCopyShareLink = async () => {
    try {
      setShareLoading(true);
      const res = await base44.functions.invoke('ensureShareToken', { tripId });
      const token = res?.data?.token;
      if (!token) throw new Error('No token returned');
      const url = `${window.location.origin}/public/trip/${tripId}?t=${token}`;
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch (err) {
      console.error(err);
      showAlert(t('trip.link_error'), err.message);
    } finally {
      setShareLoading(false);
    }
  };

  // My own personal Pro subscription status (independent of this trip).
  // Used to decide whether to show "Upgrade to Pro" button to the owner.
  const { data: myProStatus } = useQuery({
    queryKey: ['my-pro-status'],
    queryFn: async () => {
      const res = await base44.functions.invoke('checkSubscriptionStatus', {});
      return !!res?.data?.isPro;
    },
  });

  // Trip-level Pro status (is_pro_trip OR owner's active subscription).
  // Used to allow editing past trips when the trip has Pro.
  const { data: tripPro } = useQuery({
    queryKey: ['trip-pro', tripId],
    queryFn: async () => {
      const res = await base44.functions.invoke('checkSubscriptionStatus', { tripId });
      return !!res?.data?.isPro;
    },
    enabled: !!tripId,
  });

  // Progressive loading: split the trip payload into two parallel requests so
  // the page chrome (header, title, tabs, sidebar shell) can render as soon as
  // the lightweight `shell` (trip + cityVisits) arrives — without waiting for
  // the heavier `content` (hotels/activities/transfers/services/members).
  // Both queries enforce access control on the backend (getTripDetails returns
  // 403 if the user is neither owner nor active member).
  const {
    data: shell,
    isLoading: shellLoading,
    error: shellError,
  } = useQuery({
    queryKey: TRIP_SHELL_KEY(tripId),
    queryFn: async () => {
      const res = await base44.functions.invoke('getTripDetails', {
        tripId,
        include: ['shell'],
      });
      return res.data;
    },
    retry: false,
  });
  const {
    data: content,
    isLoading: contentLoadingRaw,
    error: contentError,
  } = useQuery({
    queryKey: TRIP_CONTENT_KEY(tripId),
    queryFn: async () => {
      const res = await base44.functions.invoke('getTripDetails', {
        tripId,
        include: ['content'],
      });
      return res.data;
    },
    retry: false,
  });
  const trip = shell?.trip || null;
  const visits = shell?.cityVisits || [];
  // Valid lens keys depending on the trip's addon configuration.
  const validLenses = useMemo(() => {
    const calendarVisible = trip && isAddonEnabled(trip, ADDON_KEYS.CALENDAR_VIEW);
    const chatVisible = trip && isAddonEnabled(trip, ADDON_KEYS.CHAT);
    return [
      'timeline',
      ...(calendarVisible ? ['calendar'] : []),
      'map',
      'documents',
      ...(chatVisible ? ['chat'] : []),
    ];
  }, [trip]);
  // If the active lens gets gated away (e.g. addon disabled), fall back to timeline.
  useEffect(() => {
    if (!validLenses.includes(tab)) setTab('timeline');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validLenses, tab]);
  const hotels = content?.hotels || [];
  const activities = content?.activities || [];
  const transfers = content?.transfers || [];
  const services = content?.services || [];
  const members = content?.members || [];
  const isLoading = shellLoading;
  // True while the heavier content payload hasn't arrived yet — used to show
  // inline skeletons inside the already-rendered page chrome.
  const contentLoading = contentLoadingRaw;
  // 403 from either request → user does not have access.
  const accessDenied =
    shellError?.response?.status === 403 ||
    contentError?.response?.status === 403;
  const carRentals = useMemo(() => services.filter(s => s.kind === 'car_rental'), [services]);

  const visitsById = useMemo(() => Object.fromEntries(visits.map(v => [v.id, v])), [visits]);
  const range = useMemo(() => computeTripRange(visits), [visits]);
  const initialMonth = useMemo(() => latestEventDate(visits), [visits]);
  const ordered = useMemo(() => sortVisits(visits), [visits]);
  const subtitle = useMemo(
    () => buildTripSubtitle(range, visits, locale, plural),
    [range, visits, locale, plural]
  );
  const isPastTrip = useMemo(() => isTripInPast(visits), [visits]);
  // Past trips are editable only if the trip itself has Pro features unlocked
  // (one-time purchase OR owner has Pro subscription).
  const pastLocked = isPastTrip && !tripPro;

  // Derive access from members payload (already fetched as service role).
  // Avoids a second RLS-gated query that fails for invited viewers.
  // For non-owners we need the `content` payload (which contains members) to
  // be loaded before we can decide — so we keep `loading: true` until then.
  const access = useMemo(() => {
    if (!trip || !user) return { loading: true, allowed: false, role: null, canEdit: false };
    if (trip.created_by === user.email) return { loading: false, allowed: true, role: 'owner', canEdit: true };
    if (contentLoading) return { loading: true, allowed: false, role: null, canEdit: false };
    const me = members.find(m => m.user_email === user.email && m.status === 'active');
    const role = me?.role || null;
    return { loading: false, allowed: !!me, role, canEdit: role === 'admin' };
  }, [trip, user, members, contentLoading]);

  const [showLimitDialog, setShowLimitDialog] = useState(false);
  
  const copyMut = useMutation({
    mutationFn: async () => {
      const res = await base44.functions.invoke('copyTrip', { trip_id: tripId });
      return res.data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['trips'] });
      if (data?.trip?.id) nav(`/trip/${data.trip.id}`);
    },
    onError: (error) => {
      if (error?.response?.data?.code === 'TRIP_LIMIT_REACHED') {
        setShowLimitDialog(true);
      } else {
        showAlert(t('trip.copy_error'), error.message);
      }
    },
  });

  const deleteMut = useMutation({
    mutationFn: () => base44.entities.Trip.delete(tripId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trips'] });
      nav('/');
    },
  });

  if (accessDenied) {
    return <TripAccessDenied />;
  }
  // Render the full-page skeleton ONLY while the lightweight shell hasn't
  // arrived. As soon as we have `trip` + `cityVisits` the real page chrome
  // (header, title, tabs, sidebar) is rendered; inner sections show their own
  // inline skeletons while `content` is still streaming in.
  if (isLoading || !trip) {
    return <TripViewSkeleton tripId={tripId} />;
  }
  // Don't show "access denied" until we actually know — wait for content
  // (which carries the members list used by useAccess) for non-owners.
  if (access.loading) {
    return <TripViewSkeleton tripId={tripId} />;
  }
  if (!access.allowed) {
    return <TripAccessDenied />;
  }

  return (
    <TripShell trip={trip} tripId={tripId} access={access} isFreeTrip={access.role === 'owner' && !myProStatus && !trip.is_pro_trip} onUpgrade={() => setUpgradeOpen(true)}>
    <PullToRefresh onRefresh={handleRefresh}>
    <div>
      {/* Title + actions row (same line) */}
      <div className="mb-4 flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="font-display font-bold text-3xl sm:text-4xl tracking-tight flex items-center gap-2 flex-wrap">
            <span>{trip.title}</span>
            {trip.is_pro_trip && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-orange-100 text-orange-600 dark:bg-orange-950/50 dark:text-orange-300 align-middle">
                <Crown className="w-3 h-3" />{t('trip.pro_badge')}
              </span>
            )}
          </h1>
          {trip.description && (
            <p className="mt-1.5 text-sm text-foreground/80 leading-snug">{trip.description}</p>
          )}
          {subtitle && (
            <div className="mt-1.5 text-sm text-muted-foreground">{subtitle}</div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end shrink-0">
              {access.canEdit && !pastLocked && tab === 'timeline' && (
                isEditMode ? (
                  <Button variant="default" className="h-11 gap-1.5" onClick={() => setIsEditMode(false)}>
                    <Check className="w-4 h-4" />
                    <span>{t('view.edit_mode_done')}</span>
                  </Button>
                ) : (
                  <Button variant="outline" className="h-11" onClick={() => setIsEditMode(true)}>
                    <Pencil className="w-4 h-4 sm:mr-1.5" />
                    <span className="hidden sm:inline">{t('trip.edit_trip')}</span>
                  </Button>
                )
              )}
              {(access.role === 'owner' || access.role === 'admin') && (
                <>
                  <Button variant="outline" size="icon" className="shrink-0 border-foreground/20" aria-label={t('trip.share')} onClick={() => setShareOpen(true)}>
                    <Share2 className="w-4 h-4" />
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="icon" className="shrink-0 border-foreground/20" aria-label={t('trip.export_pdf')}>
                        <FileDown className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={handleExportPdf} disabled={pdfLoading} onSelect={(e) => e.preventDefault()}>
                        {pdfLoading ? (
                          <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                        ) : (
                          <FileDown className="w-3.5 h-3.5 mr-2" />
                        )}
                        {t('trip.export_pdf')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="shrink-0 border-foreground/20" aria-label={t('common.more')}>
                    {copyMut.isPending || deleteMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <MoreVertical className="w-4 h-4" />}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {(access.role === 'owner' || access.role === 'admin') && (
                    <DropdownMenuItem asChild>
                      <Link to={`/trip/${tripId}/settings`}><SettingsIcon className="w-3.5 h-3.5 mr-2" />{t('trip.settings')}</Link>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => setConfirmCopyTrip(true)} disabled={copyMut.isPending}>
                    <Copy className="w-3.5 h-3.5 mr-2" />{t('trip.copy')}
                  </DropdownMenuItem>
                  {access.role === 'owner' && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => setConfirmDelTrip(true)}
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-2" />{t('trip.delete')}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
        </div>
      </div>

      {/* "Trip in past — upgrade to unlock" hint */}
      {access.role === 'owner' && !trip.is_pro_trip && !myProStatus && pastLocked && (
        <div className="-mt-2 mb-3 text-xs text-muted-foreground">
          {t('trip.upgrade_past_hint')}
        </div>
      )}

      {/* Two-column layout: content (left) + sidebar (right).
          Sidebar only on the "overview" (timeline) tab — other tabs use full width. */}
      <div className={`grid grid-cols-1 gap-6 items-start ${tab === 'timeline' ? 'lg:grid-cols-[minmax(0,1fr)_320px]' : ''}`}>
        {/* LEFT — content */}
        <main className="min-w-0">
          {tab === 'timeline' && (
            contentLoading ? (
              // Shell is rendered (header/title/tabs/sidebar already visible);
              // show an inline skeleton in the timeline slot while the heavier
              // `content` payload (hotels/activities/transfers) streams in.
              <TimelineSkeleton />
            ) : (
              <ReadOnlyTimelineView
                trip={trip}
                visits={visits}
                hotels={hotels}
                activities={activities}
                transfers={transfers}
                carRentals={carRentals}
                selectedDayKey={selectedDayKey}
                onDaysChange={setEventDaysByKey}
                onClickHotel={(h) => setHotelView({ open: true, hotel: h })}
                onClickTransfer={(t) => setTransferView({ open: true, transfer: t })}
                onClickActivity={(a) => setActivityView({ open: true, activity: a })}
                onClickCarRental={(s) => setCarRentalView({ open: true, service: s })}
                canEdit={access.canEdit}
                onAddHotel={(v) => setHotelEdit({ open: true, visit: v, hotel: null })}
                onAddTransfer={(fromV, toV) => setTransferEdit({ open: true, fromVisit: fromV, toVisit: toV, transfer: null })}
                onEditVisitNotes={(v) => setVisitEdit({ open: true, visit: v })}
                isEditMode={isEditMode}
                onAddCityForDay={(_dayKey) => {
                  setNewCityDefaultDay(_dayKey || null);
                  setNewCityOpen(true);
                }}
                onAddActivityForDay={(_dayKey) => {
                  // Find the visit that covers this day to pre-fill the dialog
                  const dayVisit = visits.find(v =>
                    v.kind === 'transit' && v.start_datetime && v.end_datetime &&
                    naiveDayKey(v.start_datetime) <= _dayKey && _dayKey <= naiveDayKey(v.end_datetime)
                  ) || visits.find(v => v.kind === 'transit' && v.start_datetime);
                  if (dayVisit) {
                    const tz = dayVisit.timezone || 'UTC';
                    const defaultStart = _dayKey
                      ? DateTime.fromISO(`${_dayKey}T10:00`, { zone: tz }).toUTC().toISO()
                      : null;
                    setActivityEdit({ open: true, visit: dayVisit, activity: null, defaultStart });
                  }
                }}
              />
            )
          )}

          {tab === 'calendar' && (
            contentLoading ? <TimelineSkeleton /> :
            <CalendarView
              trip={trip}
              tripRange={range}
              visits={visits}
              hotels={hotels}
              activities={activities}
              transfers={transfers}
              carRentals={carRentals}
              visitsById={visitsById}
              initialMonth={initialMonth}
              canEdit={access.canEdit && !pastLocked}
              onClickHotel={(h) => setHotelView({ open: true, hotel: h })}
              onClickTransfer={(t) => setTransferView({ open: true, transfer: t })}
              onClickActivity={(a) => setActivityView({ open: true, activity: a })}
              onClickCarRental={(s) => setCarRentalView({ open: true, service: s })}
            />
          )}
          {tab === 'map' && contentLoading && <TimelineSkeleton />}
          {tab === 'map' && !contentLoading && (
            <>
              <MapSettingsBar
                showStartEnd={showStartEnd}
                onToggleShowStartEnd={setShowStartEnd}
                mapTheme={mapTheme}
                onMapThemeChange={setMapTheme}
              />
              <MapView
                visits={visits}
                transfers={transfers}
                visitsById={visitsById}
                showStartEnd={showStartEnd}
                colorScheme={mapColorScheme}
                onCityClick={(visitsAtPoint) => setSelectedCityVisitIds(visitsAtPoint.map(v => v.id))}
              >
                {selectedCityVisitIds.length > 0 && (
                  <MapCityPanel
                    visits={selectedCityVisitIds.map(id => visitsById[id]).filter(Boolean)}
                    hotelsByVisitId={Object.fromEntries(
                      selectedCityVisitIds.map(id => [id, hotels.filter(h => h.city_visit_id === id)])
                    )}
                    activitiesByVisitId={Object.fromEntries(
                      selectedCityVisitIds.map(id => [id, activities.filter(a => a.city_visit_id === id)])
                    )}
                    canEdit={access.canEdit && !pastLocked}
                    onClose={() => setSelectedCityVisitIds([])}
                    onViewHotel={(h) => setHotelView({ open: true, hotel: h })}
                    onAddHotel={(v) => setHotelChoice({ open: true, visit: v })}
                    onViewActivity={(a) => setActivityView({ open: true, activity: a })}
                    onAddActivity={(v) => setActivityEdit({ open: true, visit: v, activity: null })}
                  />
                )}
              </MapView>
            </>
          )}
          {tab === 'documents' && (
            <TripDocumentsTab tripId={tripId} canEdit={access.canEdit} />
          )}
          {tab === 'chat' && (
            <TripChatTab tripId={tripId} trip={trip} />
          )}
        </main>

        {/* RIGHT — sidebar shown only on the "overview" tab. No own scroll — scrolls with the page. */}
        {tab === 'timeline' && (
        <aside className="space-y-4 self-start">
          <CollapsibleSection
            id="members"
            header={
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-muted-foreground" />
                <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
                  {t('trip.sidebar_members')}
                </span>
              </div>
            }
          >
            <TripMembersCard trip={trip} readOnly={!access.canEdit} noFrame hideHeader />
          </CollapsibleSection>

          <CollapsibleSection
            id="budget"
            header={
              <div className="flex items-center gap-2">
                <Wallet className="w-4 h-4 text-muted-foreground" />
                <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
                  {t('trip.sidebar_budget')}
                </span>
              </div>
            }
          >
            <TripBudgetCard
              trip={trip}
              noFrame
              hideHeader
              onSeeDetails={
                isAddonEnabled(trip, ADDON_KEYS.BUDGET)
                  ? undefined
                  : () => setBudgetAddonPromptOpen(true)
              }
            />
          </CollapsibleSection>

          <CollapsibleSection
            id="services"
            header={
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-muted-foreground" />
                <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
                  {t('trip.sidebar_services')}
                </span>
              </div>
            }
          >
            <TripServicesCard tripId={trip.id} trip={trip} readOnly={!access.canEdit} noFrame hideHeader />
          </CollapsibleSection>


        </aside>
        )}
      </div>

      {/* View dialogs */}
      <HotelViewDialog
        open={hotelView.open}
        onOpenChange={(o) => setHotelView(s => ({ ...s, open: o }))}
        hotel={hotelView.hotel}
        visit={hotelView.hotel ? visitsById[hotelView.hotel.city_visit_id] : null}
        readOnly={!access.canEdit}
        onEdit={() => {
          const h = hotelView.hotel;
          const v = h ? visitsById[h.city_visit_id] : null;
          if (!h || !v) return;
          setHotelView({ open: false, hotel: null });
          setHotelEdit({ open: true, visit: v, hotel: h });
        }}
      />
      <TransferViewDialog
        open={transferView.open}
        onOpenChange={(o) => setTransferView(s => ({ ...s, open: o }))}
        transfer={transferView.transfer}
        fromVisit={transferView.transfer ? visitsById[transferView.transfer.from_city_visit_id] : null}
        toVisit={transferView.transfer ? visitsById[transferView.transfer.to_city_visit_id] : null}
        readOnly={!access.canEdit}
        onEdit={() => {
          const t = transferView.transfer;
          if (!t) return;
          const fromV = visitsById[t.from_city_visit_id];
          const toV = visitsById[t.to_city_visit_id];
          if (!fromV || !toV) return;
          setTransferView({ open: false, transfer: null });
          setTransferEdit({ open: true, fromVisit: fromV, toVisit: toV, transfer: t });
        }}
      />
      <ActivityViewDialog
        open={activityView.open}
        onOpenChange={(o) => setActivityView(s => ({ ...s, open: o }))}
        activity={activityView.activity}
        visit={activityView.activity ? visitsById[activityView.activity.city_visit_id] : null}
        readOnly={!access.canEdit}
        onEdit={() => {
          const a = activityView.activity;
          const v = a ? visitsById[a.city_visit_id] : null;
          if (!a || !v) return;
          setActivityView({ open: false, activity: null });
          setActivityEdit({ open: true, visit: v, activity: a });
        }}
      />
      <CarRentalViewDialog
        open={carRentalView.open}
        onOpenChange={(o) => setCarRentalView(s => ({ ...s, open: o }))}
        service={carRentalView.service}
        readOnly={!access.canEdit}
        onEdit={() => {
          const s = carRentalView.service;
          if (!s) return;
          setCarRentalView({ open: false, service: null });
          setCarRentalEdit({ open: true, service: s });
        }}
      />
      {hotelEdit.open && hotelEdit.visit && (
        <HotelDialog
          key={`edit-hotel-${hotelEdit.visit.id}-${hotelEdit.hotel?.id || 'new'}`}
          open={hotelEdit.open}
          onOpenChange={(o) => setHotelEdit(s => ({ ...s, open: o }))}
          visit={hotelEdit.visit}
          hotel={hotelEdit.hotel}
          otherHotels={hotels.filter(h => h.city_visit_id === hotelEdit.visit.id && h.id !== hotelEdit.hotel?.id)}
        />
      )}
      {transferEdit.open && transferEdit.fromVisit && transferEdit.toVisit && (
        <TransferDialog
          key={`edit-transfer-${transferEdit.fromVisit.id}-${transferEdit.toVisit.id}-${transferEdit.transfer?.id || 'new'}`}
          open={transferEdit.open}
          onOpenChange={(o) => setTransferEdit(s => ({ ...s, open: o }))}
          tripId={tripId}
          fromVisit={transferEdit.fromVisit}
          toVisit={transferEdit.toVisit}
          transfer={transferEdit.transfer}
        />
      )}
      {activityEdit.open && activityEdit.visit && (
        <ActivityDialog
          key={`edit-activity-${activityEdit.activity?.id || 'new'}-${activityEdit.visit.id}`}
          open={activityEdit.open}
          onOpenChange={(o) => setActivityEdit(s => ({ ...s, open: o }))}
          visit={activityEdit.visit}
          activity={activityEdit.activity}
          defaultStart={activityEdit.defaultStart || null}
        />
      )}

      {/* "Add hotel" choice dialog (manual vs booking platform) opened from the map panel */}
      <BookingChoiceDialog
        open={hotelChoice.open}
        onOpenChange={(o) => setHotelChoice(s => ({ ...s, open: o }))}
        title={t('hotel.choice_title')}
        description={t('hotel.choice_description')}
        manualLabel={t('hotel.choice_manual')}
        manualHint={t('hotel.choice_manual_hint')}
        onManual={() => {
          const v = hotelChoice.visit;
          setHotelChoice({ open: false, visit: null });
          if (v) setHotelEdit({ open: true, visit: v, hotel: null });
        }}
        platforms={hotelChoice.visit ? hotelPlatforms(hotelChoice.visit, t) : []}
      />
      {carRentalEdit.open && carRentalEdit.service && (
        <CarRentalDialog
          key={`edit-car-${carRentalEdit.service.id}`}
          open={carRentalEdit.open}
          onOpenChange={(o) => setCarRentalEdit(s => ({ ...s, open: o }))}
          tripId={tripId}
          service={carRentalEdit.service}
        />
      )}
      {visitEdit.open && visitEdit.visit && (
        <CityVisitDialog
          key={`edit-visit-${visitEdit.visit.id}`}
          open={visitEdit.open}
          onOpenChange={(o) => setVisitEdit(s => ({ ...s, open: o }))}
          tripId={tripId}
          visit={visitEdit.visit}
          trip={trip}
          allVisits={visits}
        />
      )}

      <CityVisitDialog
        key="new-city-from-edit"
        open={newCityOpen}
        onOpenChange={(o) => { setNewCityOpen(o); if (!o) setNewCityDefaultDay(null); }}
        tripId={tripId}
        visit={null}
        trip={newCityDefaultDay ? { ...trip, start_date: newCityDefaultDay } : trip}
        allVisits={visits}
      />
      
      <TripLimitDialog
        open={showLimitDialog}
        onOpenChange={setShowLimitDialog}
        onProceed={() => {
          setShowLimitDialog(false);
          // User needs to upgrade first
        }}
      />

      <UpgradePlanDialog
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        tripId={tripId}
        onUpgradeComplete={() => {
          qc.invalidateQueries({ queryKey: ['my-pro-status'] });
          qc.invalidateQueries({ queryKey: ['trip-pro', tripId] });
          qc.invalidateQueries({ queryKey: ['trip', tripId] });
          setUpgradeOpen(false);
        }}
      />

      <ConfirmDialog
        open={confirmCopyTrip}
        onOpenChange={setConfirmCopyTrip}
        title={t('trip.copy_confirm_title')}
        description={t('trip.copy_confirm_desc')}
        confirmLabel={t('trip.copy')}
        onConfirm={() => { copyMut.mutate(); setConfirmCopyTrip(false); }}
      />

      <ConfirmDialog
        open={confirmDelTrip}
        onOpenChange={setConfirmDelTrip}
        title={t('common.delete_confirm_title')}
        description={t('trip.delete_trip_confirm')}
        confirmLabel={t('trip.delete')}
        variant="destructive"
        onConfirm={() => {
          setConfirmDelTrip(false);
          // For Pro trips show a second confirmation step before actually deleting.
          if (trip?.is_pro_trip) {
            setConfirmDelProTrip(true);
          } else {
            deleteMut.mutate();
          }
        }}
      />

      <ConfirmDialog
        open={confirmDelProTrip}
        onOpenChange={setConfirmDelProTrip}
        title={t('trip.delete_pro_confirm_title')}
        description={t('trip.delete_pro_confirm_desc')}
        confirmLabel={t('trip.delete')}
        variant="destructive"
        onConfirm={() => { deleteMut.mutate(); setConfirmDelProTrip(false); }}
      />

      <ShareTripDialog open={shareOpen} onOpenChange={setShareOpen} tripId={tripId} />

      <ConfirmDialog
        open={alertDialog.open}
        onOpenChange={(o) => setAlertDialog((s) => ({ ...s, open: o }))}
        title={alertDialog.title}
        description={alertDialog.description}
        singleButton
      />

      <ConfirmDialog
        open={budgetAddonPromptOpen}
        onOpenChange={setBudgetAddonPromptOpen}
        title={t('budget.addon_off_title')}
        description={t('budget.addon_off_desc')}
        confirmLabel={t('budget.addon_off_go_settings')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => {
          setBudgetAddonPromptOpen(false);
          nav(`/trip/${tripId}/settings`);
        }}
      />
    </div>
    </PullToRefresh>
    </TripShell>
  );
}