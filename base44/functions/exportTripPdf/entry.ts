import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { jsPDF } from 'npm:jspdf@2.5.2';
import { DateTime } from 'npm:luxon@3.4.4';

// NotoSans Regular — Unicode TTF font with Cyrillic + Latin coverage.
// Fetched once per cold start and cached in module scope.
const FONT_URL = 'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans@5.0.10/files/noto-sans-cyrillic-400-normal.woff';
// jsPDF needs TTF, not WOFF. Use Google Fonts raw TTF mirror via jsdelivr.
const FONT_TTF_URL = 'https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf';
const FONT_TTF_BOLD_URL = 'https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Bold.ttf';

let cachedFontBase64 = null;
let cachedFontBoldBase64 = null;

async function fetchFontBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch font: ${url} (${res.status})`);
  const buf = new Uint8Array(await res.arrayBuffer());
  // base64 encode in chunks (avoid call-stack overflow on big buffers)
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < buf.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, buf.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// Lightweight i18n inside the function — only labels we need on the PDF.
const STRINGS = {
  ru: {
    days_one: 'день', days_few: 'дня', days_many: 'дней',
    cities_one: 'город', cities_few: 'города', cities_many: 'городов',
    nights_one: 'ночь', nights_few: 'ночи', nights_many: 'ночей',
    checkin: 'Заезд', checkout: 'Выезд',
    start_kind: 'Старт', end_kind: 'Финиш',
    until: 'до {t}',
    pdf_title: 'Маршрут поездки',
    no_events: 'Нет событий в этот день',
  },
  en: {
    days_one: 'day', days_few: 'days', days_many: 'days',
    cities_one: 'city', cities_few: 'cities', cities_many: 'cities',
    nights_one: 'night', nights_few: 'nights', nights_many: 'nights',
    checkin: 'Check-in', checkout: 'Check-out',
    start_kind: 'Start', end_kind: 'End',
    until: 'until {t}',
    pdf_title: 'Trip itinerary',
    no_events: 'No events on this day',
  },
  es: {
    days_one: 'día', days_few: 'días', days_many: 'días',
    cities_one: 'ciudad', cities_few: 'ciudades', cities_many: 'ciudades',
    nights_one: 'noche', nights_few: 'noches', nights_many: 'noches',
    checkin: 'Entrada', checkout: 'Salida',
    start_kind: 'Inicio', end_kind: 'Fin',
    until: 'hasta {t}',
    pdf_title: 'Itinerario del viaje',
    no_events: 'Sin eventos este día',
  },
};

function localeTag(lang) {
  return { ru: 'ru', en: 'en', es: 'es' }[lang] || 'ru';
}

function plural(lang, n, prefix) {
  const s = STRINGS[lang] || STRINGS.ru;
  if (lang === 'ru') {
    const mod10 = n % 10, mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return s[`${prefix}_one`];
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return s[`${prefix}_few`];
    return s[`${prefix}_many`];
  }
  return n === 1 ? s[`${prefix}_one`] : s[`${prefix}_many`];
}

function inTz(iso, tz, fmt, locale) {
  if (!iso) return '';
  return DateTime.fromISO(iso, { zone: 'utc' }).setZone(tz || 'utc').setLocale(locale).toFormat(fmt);
}

function uniqueCityCount(visits) {
  const keys = new Set();
  for (const v of visits) {
    if (v.kind === 'start' || v.kind === 'end') continue;
    const k = v.external_city_id || `${(v.city_name || '').toLowerCase()}|${v.country_code || ''}`;
    keys.add(k);
  }
  return keys.size;
}

function tripRange(visits) {
  let start = null, end = null;
  for (const v of visits) {
    if (v.start_datetime) {
      const d = new Date(v.start_datetime);
      if (!start || d < start) start = d;
    }
    if (v.end_datetime) {
      const d = new Date(v.end_datetime);
      if (!end || d > end) end = d;
    }
  }
  return { start, end };
}

// Sort visits the same way the timeline does: by start_datetime, with start/end anchors.
function sortVisits(visits) {
  const list = [...visits];
  const startAnchor = list.find(v => v.kind === 'start');
  const endAnchor = list.find(v => v.kind === 'end');
  const middle = list.filter(v => v.kind !== 'start' && v.kind !== 'end')
    .sort((a, b) => new Date(a.start_datetime || 0) - new Date(b.start_datetime || 0));
  const out = [];
  if (startAnchor) out.push(startAnchor);
  out.push(...middle);
  if (endAnchor) out.push(endAnchor);
  return out;
}

// ---- PDF rendering ----

const PAGE_W = 595.28;  // A4 width in pt
const PAGE_H = 841.89;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;

function newDoc(fontBase64, fontBoldBase64) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  doc.addFileToVFS('NotoSans-Regular.ttf', fontBase64);
  doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal');
  doc.addFileToVFS('NotoSans-Bold.ttf', fontBoldBase64);
  doc.addFont('NotoSans-Bold.ttf', 'NotoSans', 'bold');
  doc.setFont('NotoSans', 'normal');
  return doc;
}

class PdfWriter {
  constructor(doc) {
    this.doc = doc;
    this.y = MARGIN;
  }
  ensureSpace(needed) {
    if (this.y + needed > PAGE_H - MARGIN) {
      this.doc.addPage();
      this.y = MARGIN;
    }
  }
  text(str, opts = {}) {
    const {
      size = 10, bold = false, color = [30, 30, 30],
      indent = 0, leadingMul = 1.35, maxWidth = CONTENT_W,
    } = opts;
    this.doc.setFont('NotoSans', bold ? 'bold' : 'normal');
    this.doc.setFontSize(size);
    this.doc.setTextColor(color[0], color[1], color[2]);
    const wrapW = maxWidth - indent;
    const lines = this.doc.splitTextToSize(String(str ?? ''), wrapW);
    const lineH = size * leadingMul;
    this.ensureSpace(lines.length * lineH);
    for (const line of lines) {
      this.doc.text(line, MARGIN + indent, this.y + size * 0.85);
      this.y += lineH;
    }
  }
  hr() {
    this.ensureSpace(8);
    this.doc.setDrawColor(220, 220, 220);
    this.doc.setLineWidth(0.5);
    this.doc.line(MARGIN, this.y, MARGIN + CONTENT_W, this.y);
    this.y += 8;
  }
  spacer(h = 6) { this.y += h; }
}

function transportLabel(type, lang) {
  const labels = {
    plane:    { ru: 'Самолёт',  en: 'Flight',     es: 'Vuelo' },
    train:    { ru: 'Поезд',    en: 'Train',      es: 'Tren' },
    bus:      { ru: 'Автобус',  en: 'Bus',        es: 'Autobús' },
    car:      { ru: 'Машина',   en: 'Car',        es: 'Coche' },
    taxi:     { ru: 'Такси',    en: 'Taxi',       es: 'Taxi' },
    ferry:    { ru: 'Паром',    en: 'Ferry',      es: 'Ferry' },
    walk:     { ru: 'Пешком',   en: 'Walk',       es: 'A pie' },
    own_transport: { ru: 'Свой транспорт', en: 'Own transport', es: 'Transporte propio' },
    other:    { ru: 'Другое',   en: 'Other',      es: 'Otro' },
  };
  return labels[type]?.[lang] || labels.other[lang] || type;
}

function buildDayEvents(visits, hotels, activities, transfers) {
  // Group everything by day-key (yyyy-LL-dd in event's local tz).
  // Each day stores: { key, dt, events: [{ time, kind, ... }] }
  const days = new Map();
  const push = (key, dt, ev) => {
    if (!days.has(key)) days.set(key, { key, dt: dt.startOf('day'), events: [] });
    days.get(key).events.push(ev);
  };
  const visitsById = Object.fromEntries(visits.map(v => [v.id, v]));

  for (const v of visits) {
    if (!v.start_datetime || v.kind === 'start' || v.kind === 'end') continue;
    const tz = v.timezone || 'utc';
    const dt = DateTime.fromISO(v.start_datetime, { zone: 'utc' }).setZone(tz);
    push(dt.toFormat('yyyy-LL-dd'), dt, {
      time: dt, kind: 'city-arrival', visit: v, sort: 0,
    });
  }
  for (const h of hotels) {
    const v = visitsById[h.city_visit_id];
    const tz = v?.timezone || 'utc';
    if (h.check_in_datetime) {
      const dt = DateTime.fromISO(h.check_in_datetime, { zone: 'utc' }).setZone(tz);
      push(dt.toFormat('yyyy-LL-dd'), dt, { time: dt, kind: 'hotel-in', hotel: h, sort: 1 });
    }
    if (h.check_out_datetime) {
      const dt = DateTime.fromISO(h.check_out_datetime, { zone: 'utc' }).setZone(tz);
      push(dt.toFormat('yyyy-LL-dd'), dt, { time: dt, kind: 'hotel-out', hotel: h, sort: 1 });
    }
  }
  for (const a of activities) {
    if (!a.start_datetime) continue;
    const v = visitsById[a.city_visit_id];
    const tz = v?.timezone || 'utc';
    const dt = DateTime.fromISO(a.start_datetime, { zone: 'utc' }).setZone(tz);
    push(dt.toFormat('yyyy-LL-dd'), dt, { time: dt, kind: 'activity', activity: a, tz, sort: 2 });
  }
  for (const t of transfers) {
    if (!t.start_datetime) continue;
    const fromV = visitsById[t.from_city_visit_id];
    const tz = fromV?.timezone || 'utc';
    const dt = DateTime.fromISO(t.start_datetime, { zone: 'utc' }).setZone(tz);
    push(dt.toFormat('yyyy-LL-dd'), dt, { time: dt, kind: 'transfer', transfer: t, sort: 3 });
  }

  return Array.from(days.values())
    .sort((a, b) => a.dt.toMillis() - b.dt.toMillis())
    .map(d => ({
      ...d,
      events: d.events.sort((x, y) => x.time.toMillis() - y.time.toMillis() || x.sort - y.sort),
    }));
}

function renderPdf(data, lang, fontBase64, fontBoldBase64) {
  const { trip, cityVisits = [], hotels = [], activities = [], transfers = [] } = data;
  const visits = sortVisits(cityVisits);
  const visitsById = Object.fromEntries(visits.map(v => [v.id, v]));
  const locale = localeTag(lang);
  const S = STRINGS[lang] || STRINGS.ru;

  const doc = newDoc(fontBase64, fontBoldBase64);
  const w = new PdfWriter(doc);

  // ===== HEADER =====
  w.text(trip.title || S.pdf_title, { size: 22, bold: true });
  w.spacer(4);

  const range = tripRange(visits);
  const subtitleParts = [];
  if (range.start && range.end) {
    const startD = DateTime.fromJSDate(range.start).setLocale(locale).toFormat('d LLL');
    const endD = DateTime.fromJSDate(range.end).setLocale(locale).toFormat('d LLL');
    const days = Math.max(1, Math.round((range.end - range.start) / 86400000) + 1);
    const cityCount = uniqueCityCount(visits);
    subtitleParts.push(`${startD} – ${endD}`);
    subtitleParts.push(`${days} ${plural(lang, days, 'days')}`);
    if (cityCount > 0) subtitleParts.push(`${cityCount} ${plural(lang, cityCount, 'cities')}`);
  }
  if (subtitleParts.length) {
    w.text(subtitleParts.join(' · '), { size: 11, color: [110, 110, 110] });
  }
  if (trip.description) {
    w.spacer(4);
    w.text(trip.description, { size: 10, color: [80, 80, 80] });
  }
  w.spacer(10);
  w.hr();
  w.spacer(6);

  // ===== TIMELINE =====
  const dayBuckets = buildDayEvents(visits, hotels, activities, transfers);

  // Also render start/end anchors as their own "blocks" without a day grouping
  const startAnchor = visits.find(v => v.kind === 'start');
  const endAnchor = visits.find(v => v.kind === 'end');

  if (startAnchor) {
    w.text(`▸ ${S.start_kind}: ${startAnchor.city_name}${startAnchor.country ? ', ' + startAnchor.country : ''}`,
      { size: 12, bold: true, color: [16, 122, 87] });
    w.spacer(8);
  }

  for (const day of dayBuckets) {
    const weekday = day.dt.setLocale(locale).toFormat('cccc');
    const dateLbl = day.dt.setLocale(locale).toFormat('d LLLL yyyy');
    const dayHeader = `${weekday.charAt(0).toLocaleUpperCase(locale)}${weekday.slice(1)}, ${dateLbl}`;
    w.ensureSpace(40);
    w.text(dayHeader, { size: 13, bold: true, color: [0, 106, 105] });
    w.spacer(2);

    for (const ev of day.events) {
      const time = ev.time.toFormat('HH:mm');

      if (ev.kind === 'city-arrival') {
        const v = ev.visit;
        const tz = v.timezone || 'utc';
        const endDt = v.end_datetime ? DateTime.fromISO(v.end_datetime, { zone: 'utc' }).setZone(tz).setLocale(locale) : null;
        const startDt = DateTime.fromISO(v.start_datetime, { zone: 'utc' }).setZone(tz).setLocale(locale);
        const nights = endDt ? Math.max(0, Math.round(endDt.diff(startDt, 'days').days)) : 0;
        const head = `📍 ${v.city_name}${v.country ? ', ' + v.country : ''}`;
        w.text(head, { size: 11, bold: true, indent: 14 });
        if (endDt) {
          const range = `${startDt.toFormat('d LLL')} → ${endDt.toFormat('d LLL')}${nights > 0 ? ` · ${nights} ${plural(lang, nights, 'nights')}` : ''}`;
          w.text(range, { size: 9, color: [120, 120, 120], indent: 28 });
        }
        if (v.notes) {
          w.text(v.notes, { size: 9, color: [90, 90, 90], indent: 28 });
        }
        w.spacer(2);
        continue;
      }

      if (ev.kind === 'hotel-in' || ev.kind === 'hotel-out') {
        const h = ev.hotel;
        const label = ev.kind === 'hotel-in' ? S.checkin : S.checkout;
        w.text(`${time}  🏨  ${label}: ${h.name}`, { size: 10, bold: true, indent: 14 });
        const sub = [h.address, h.booking_reference ? `№ ${h.booking_reference}` : null].filter(Boolean).join(' · ');
        if (sub) w.text(sub, { size: 9, color: [120, 120, 120], indent: 28 });
        w.spacer(2);
        continue;
      }

      if (ev.kind === 'activity') {
        const a = ev.activity;
        const endTime = a.end_datetime ? inTz(a.end_datetime, ev.tz, 'HH:mm', locale) : null;
        w.text(`${time}  📷  ${a.title}`, { size: 10, bold: true, indent: 14 });
        const parts = [];
        if (endTime) parts.push(S.until.replace('{t}', endTime));
        if (a.location_name) parts.push(a.location_name);
        if (a.location_address) parts.push(a.location_address);
        if (parts.length) w.text(parts.join(' · '), { size: 9, color: [120, 120, 120], indent: 28 });
        w.spacer(2);
        continue;
      }

      if (ev.kind === 'transfer') {
        const tr = ev.transfer;
        const fromV = visitsById[tr.from_city_visit_id];
        const toV = visitsById[tr.to_city_visit_id];
        const transport = transportLabel(tr.transport_type, lang);
        const head = `${time}  ✈  ${fromV?.city_name || '—'} → ${toV?.city_name || '—'}  (${transport})`;
        w.text(head, { size: 10, bold: true, indent: 14, color: [0, 106, 105] });
        const startTz = fromV?.timezone || 'utc';
        const endTz = toV?.timezone || 'utc';
        const sub = [
          tr.carrier,
          tr.start_datetime ? inTz(tr.start_datetime, startTz, 'd LLL HH:mm', locale) : null,
          tr.end_datetime ? `→ ${inTz(tr.end_datetime, endTz, 'd LLL HH:mm', locale)}` : null,
          tr.booking_reference ? `№ ${tr.booking_reference}` : null,
        ].filter(Boolean).join(' · ');
        if (sub) w.text(sub, { size: 9, color: [120, 120, 120], indent: 28 });
        w.spacer(2);
        continue;
      }
    }
    w.spacer(6);
  }

  if (endAnchor) {
    w.spacer(4);
    w.text(`▸ ${S.end_kind}: ${endAnchor.city_name}${endAnchor.country ? ', ' + endAnchor.country : ''}`,
      { size: 12, bold: true, color: [180, 60, 60] });
  }

  // Footer page numbers
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFont('NotoSans', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(150, 150, 150);
    doc.text(`${i} / ${total}`, PAGE_W - MARGIN, PAGE_H - 24, { align: 'right' });
  }

  return doc.output('arraybuffer');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { tripId, lang = 'ru' } = await req.json();
    if (!tripId) {
      return Response.json({ error: 'tripId is required' }, { status: 400 });
    }

    // Access check: owner OR active member.
    const trip = await base44.asServiceRole.entities.Trip.get(tripId);
    if (!trip) {
      return Response.json({ error: 'Trip not found' }, { status: 404 });
    }
    const isCreator = trip.created_by === user.email;
    let isMember = false;
    if (!isCreator) {
      const rows = await base44.asServiceRole.entities.TripMember.filter({
        trip_id: tripId, user_email: user.email, status: 'active',
      });
      isMember = rows.length > 0;
    }
    if (!isCreator && !isMember) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const sr = base44.asServiceRole.entities;
    const [cityVisits, hotels, activities, transfers] = await Promise.all([
      sr.CityVisit.filter({ trip_id: tripId }),
      sr.HotelStay.filter({ trip_id: tripId }),
      sr.Activity.filter({ trip_id: tripId }),
      sr.Transfer.filter({ trip_id: tripId }),
    ]);

    // Cache fonts across cold starts.
    if (!cachedFontBase64) {
      cachedFontBase64 = await fetchFontBase64(FONT_TTF_URL);
    }
    if (!cachedFontBoldBase64) {
      cachedFontBoldBase64 = await fetchFontBase64(FONT_TTF_BOLD_URL);
    }

    const buf = renderPdf(
      { trip, cityVisits, hotels, activities, transfers },
      lang,
      cachedFontBase64,
      cachedFontBoldBase64,
    );

    // Sanitize filename to ASCII to satisfy Content-Disposition header.
    const safeTitle = (trip.title || 'trip').replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'trip';

    return new Response(buf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeTitle}.pdf"`,
      },
    });
  } catch (err) {
    console.error('exportTripPdf error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
});