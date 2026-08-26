/* =========================================================================
   Demo trip — static data (TRIP-462, Ф6.3).

   A fictional, fully-curated trip that showcases the product. No `getPublicTrip`,
   no DB — the data lives here in the repo (decision Pavel). The page footer states
   plainly that the itinerary, people, prices and documents are invented
   (`landing.demo.footer.disclaimer`).

   The ROUTE MAP is driven from structured data fed to the canonical <MapView>
   (same primitive as PublicTrip). The dense showcase sections (timeline, budget,
   calendar, team, chat, Telegram) are data-driven too — each repetitive block is
   an array rendered with .map(), producing the prototype's markup verbatim
   without hand-copying dozens of near-identical nodes. Every human-visible string
   is a t() KEY in the `landing` namespace (demo is a marketing page of the same
   site); numbers, colours, times and icon ids are literals here because they are
   visual data, not translatable copy. Proper nouns (people, hotels, addresses)
   are fixed across locales by design.

   Coordinates + leg types are the prototype's own (`src-demo` runtime STOPS/LEGS).
   Berlin is the home anchor: start AND finish, drawn once (kind:'start', no return
   leg), exactly as the prototype notes.
   ========================================================================= */

// ── Route map (fed to <MapView>) ──────────────────────────────────────────
// Shape = the subset <MapView> reads: id, kind, latitude, longitude — plus
// city_name / country_code for the LIGHT city badge, and start/end dates so
// sortVisits keeps the order deterministic. `position` is the explicit tie-break.
export const DEMO_VISITS = [
  { id: 'd-berlin',    kind: 'start',   position: 0, city_name: 'Берлин',    country_code: 'DE', latitude: 52.5200, longitude: 13.4050, start_date: '2026-09-12', end_date: '2026-09-12' },
  { id: 'd-rome',      kind: 'transit', position: 1, city_name: 'Рим',       country_code: 'IT', latitude: 41.9028, longitude: 12.4964, start_date: '2026-09-12', end_date: '2026-09-15' },
  { id: 'd-milan',     kind: 'transit', position: 2, city_name: 'Милан',     country_code: 'IT', latitude: 45.4642, longitude:  9.1900, start_date: '2026-09-15', end_date: '2026-09-17' },
  { id: 'd-barcelona', kind: 'transit', position: 3, city_name: 'Барселона', country_code: 'ES', latitude: 41.3851, longitude:  2.1734, start_date: '2026-09-17', end_date: '2026-09-20' },
  { id: 'd-valencia',  kind: 'transit', position: 4, city_name: 'Валенсия',  country_code: 'ES', latitude: 39.4699, longitude: -0.3763, start_date: '2026-09-20', end_date: '2026-09-22' },
  { id: 'd-madrid',    kind: 'transit', position: 5, city_name: 'Мадрид',    country_code: 'ES', latitude: 40.4168, longitude: -3.7038, start_date: '2026-09-22', end_date: '2026-09-25' },
  { id: 'd-porto',     kind: 'transit', position: 6, city_name: 'Порту',     country_code: 'PT', latitude: 41.1579, longitude: -8.6291, start_date: '2026-09-25', end_date: '2026-09-27' },
  { id: 'd-lisbon',    kind: 'transit', position: 7, city_name: 'Лиссабон',  country_code: 'PT', latitude: 38.7223, longitude: -9.1393, start_date: '2026-09-27', end_date: '2026-09-30' },
];

// Legs between consecutive cities. The Valencia → Madrid leg is DELIBERATELY
// absent — the prototype's "переезда пока нет" gap, which <MapView> renders as
// the dashed line (no transfer record ⇒ dashed segment). The return Lisbon →
// Berlin leg is intentionally not modelled (going home isn't part of the route).
export const DEMO_TRANSFERS = [
  { id: 'd-t1', from_city_visit_id: 'd-berlin',    to_city_visit_id: 'd-rome',      transport_type: 'plane' },
  { id: 'd-t2', from_city_visit_id: 'd-rome',      to_city_visit_id: 'd-milan',     transport_type: 'train' },
  { id: 'd-t3', from_city_visit_id: 'd-milan',     to_city_visit_id: 'd-barcelona', transport_type: 'plane' },
  { id: 'd-t4', from_city_visit_id: 'd-barcelona', to_city_visit_id: 'd-valencia',  transport_type: 'train' },
  // gap: d-valencia → d-madrid (no transfer) — dashed on the map
  { id: 'd-t5', from_city_visit_id: 'd-madrid',    to_city_visit_id: 'd-porto',     transport_type: 'plane' },
  { id: 'd-t6', from_city_visit_id: 'd-porto',     to_city_visit_id: 'd-lisbon',    transport_type: 'train' },
];

// City accent colours (prototype palette) — reused by the calendar bars/legend
// and the timeline day dots so the same city reads the same colour everywhere.
export const DEMO_CITY_COLORS = {
  rome: 'var(--dc-rome)', milan: 'var(--dc-milan)', barcelona: 'var(--dc-barcelona)',
  valencia: 'var(--dc-valencia)', madrid: 'var(--dc-madrid)', porto: 'var(--dc-porto)', lisbon: 'var(--dc-lisbon)',
};

// Traveller avatars (initials + fixed colour) — proper nouns, not localised.
export const DEMO_PEOPLE = [
  { ini: 'AL', name: 'Ava Lindqvist',   color: 'var(--dc-barcelona)' },
  { ini: 'MF', name: 'Marco Ferretti',  color: 'var(--dc-rome)' },
  { ini: 'PR', name: 'Priya Raman',     color: 'var(--dc-valencia)' },
  { ini: 'NA', name: 'Noah Adeyemi',    color: 'var(--dc-madrid)' },
];

// ── Summary stat strip (fed to <SiteSummary>) ─────────────────────────────
// The prototype's five hard numbers. `k` is a t() key; the value/unit are data.
export const DEMO_STATS = [
  { icon: 'i-globe2', n: '3',     k: 'landing.demo.sum.countries' },
  { icon: 'i-pin2',   n: '7',     k: 'landing.demo.sum.cities' },
  { icon: 'i-swap',   n: '7',     k: 'landing.demo.sum.transfers' },
  { icon: 'i-cal2',   n: '19',    k: 'landing.demo.sum.days' },
  { icon: 'i-route',  n: '5 997', unit: 'landing.demo.sum.km_unit', k: 'landing.demo.sum.km' },
];

// ── Timeline (day-by-day) ─────────────────────────────────────────────────
// tint = {s: soft bg, k: ink} pairs from the prototype (category colours).
const TINT = {
  stay: { s: 'var(--dc-stay-s)', k: 'var(--dc-stay-k)' },
  act:  { s: 'var(--dc-act-s)', k: 'var(--dc-act-k)' },
  food: { s: 'var(--dc-food-s)', k: 'var(--dc-food-k)' },
  move: { s: 'var(--dc-move-s)', k: 'var(--dc-move-k)' },
  warn: { s: 'var(--dc-warn-s)', k: 'var(--dc-food-k)' },
};
export const DEMO_TIMELINE = [
  {
    dot: DEMO_CITY_COLORS.rome, dhKey: 'landing.demo.tl.d1.dh', cityKey: 'landing.demo.tl.d1.city',
    events: [
      { kind: 'ev', mod: 'hot', time: '09:00', icon: 'i-clock', tint: TINT.act, tKey: 'landing.demo.tl.d1.e1.t', sKey: 'landing.demo.tl.d1.e1.s', pill: { cls: 'todo', key: 'landing.demo.tl.d1.e1.pill' } },
      { kind: 'ev', time: '11:00', icon: 'i-ticket', tint: TINT.act, tKey: 'landing.demo.tl.d1.e2.t', sKey: 'landing.demo.tl.d1.e2.s', price: '€34' },
      { kind: 'ev', time: '19:30', icon: 'i-food', tint: TINT.food, tKey: 'landing.demo.tl.d1.e3.t', sKey: 'landing.demo.tl.d1.e3.s' },
    ],
  },
  {
    dot: DEMO_CITY_COLORS.milan, dhKey: 'landing.demo.tl.d2.dh', cityKey: 'landing.demo.tl.d2.city',
    events: [
      { kind: 'ev', time: '08:00', icon: 'i-bed', tint: TINT.stay, tKey: 'landing.demo.tl.d2.e1.t', sKey: 'landing.demo.tl.d2.e1.s' },
      { kind: 'trn', tint: TINT.move,
        from: { time: '09:20', icon: 'i-train', ptKey: 'landing.demo.tl.d2.trn.from', stationKey: 'landing.demo.tl.d2.trn.from_st', price: '€96' },
        mid: { icon: 'i-train', mKey: 'landing.demo.tl.d2.trn.mode', emKey: 'landing.demo.tl.d2.trn.meta' },
        to: { time: '12:25', icon: 'i-pin', ptKey: 'landing.demo.tl.d2.trn.to', stationKey: 'landing.demo.tl.d2.trn.to_st' } },
      { kind: 'ev', time: '14:00', icon: 'i-bed', tint: TINT.stay, tKey: 'landing.demo.tl.d2.e2.t', sKey: 'landing.demo.tl.d2.e2.s', price: '€310' },
    ],
  },
  {
    dot: DEMO_CITY_COLORS.barcelona, dhKey: 'landing.demo.tl.d3.dh', cityKey: 'landing.demo.tl.d3.city',
    events: [
      { kind: 'ev', time: '11:00', icon: 'i-ticket', tint: TINT.act, tKey: 'landing.demo.tl.d3.e1.t', sKey: 'landing.demo.tl.d3.e1.s', price: '€132' },
      { kind: 'ev', time: '18:30', icon: 'i-food', tint: TINT.food, tKey: 'landing.demo.tl.d3.e2.t', sKey: 'landing.demo.tl.d3.e2.s', price: '€58' },
    ],
  },
  {
    dot: DEMO_CITY_COLORS.madrid, dhKey: 'landing.demo.tl.d4.dh', cityKey: 'landing.demo.tl.d4.city',
    events: [
      { kind: 'ev', time: '11:00', icon: 'i-bed', tint: TINT.stay, tKey: 'landing.demo.tl.d4.e1.t', sKey: 'landing.demo.tl.d4.e1.s' },
      { kind: 'ev', mod: 'warn', time: '—', icon: 'i-warning', tint: TINT.warn, tKey: 'landing.demo.tl.d4.e2.t', sKey: 'landing.demo.tl.d4.e2.s', pill: { cls: 'todo', key: 'landing.demo.tl.gap' } },
      { kind: 'ev', mod: 'warn', time: '—', icon: 'i-bed', tint: TINT.warn, tKey: 'landing.demo.tl.d4.e3.t', sKey: 'landing.demo.tl.d4.e3.s', pill: { cls: 'todo', key: 'landing.demo.tl.gap' } },
    ],
  },
  {
    dot: DEMO_CITY_COLORS.porto, dhKey: 'landing.demo.tl.d5.dh', cityKey: 'landing.demo.tl.d5.city',
    events: [
      { kind: 'trn', tint: TINT.move,
        from: { time: '13:15', icon: 'i-plane', ptKey: 'landing.demo.tl.d5.trn.from', stationKey: 'landing.demo.tl.d5.trn.from_st', price: '€112' },
        mid: { icon: 'i-plane', mKey: 'landing.demo.tl.d5.trn.mode', emKey: 'landing.demo.tl.d5.trn.meta' },
        to: { time: '13:50', icon: 'i-pin', ptKey: 'landing.demo.tl.d5.trn.to', stationKey: 'landing.demo.tl.d5.trn.to_st' } },
      { kind: 'ev', time: '16:00', icon: 'i-bed', tint: TINT.stay, tKey: 'landing.demo.tl.d5.e1.t', sKey: 'landing.demo.tl.d5.e1.s', price: '€265' },
      { kind: 'ev', time: '17:00', icon: 'i-car', tint: TINT.move, tKey: 'landing.demo.tl.d5.e2.t', sKey: 'landing.demo.tl.d5.e2.s', price: '€96' },
    ],
  },
];

// ── Budget ────────────────────────────────────────────────────────────────
// Donut conic-gradient stops are the prototype's own (degrees). Category rows
// carry colour + width + pill; text is a key.
export const DEMO_BUDGET = {
  donutGradient: 'var(--dc-milan) 0 183.9deg,var(--dc-valencia) 183.9deg 258.3deg,var(--dc-rome) 258.3deg 320.2deg,var(--dc-madrid) 320.2deg 343.8deg,var(--dc-lisbon) 343.8deg 353.5deg,var(--dc-barcelona) 353.5deg 360deg',
  total: '€4 090',
  cats: [
    { c: 'var(--dc-milan)', tKey: 'landing.demo.bud.cat.stay',   pill: { cls: 'auto', key: 'landing.demo.bud.cat.stay_n' },   v: '€2 090', w: '100%' },
    { c: 'var(--dc-valencia)', tKey: 'landing.demo.bud.cat.trans',  pill: { cls: 'auto', key: 'landing.demo.bud.cat.trans_n' },  v: '€846',   w: '40%' },
    { c: 'var(--dc-rome)', tKey: 'landing.demo.bud.cat.act',    pill: { cls: 'auto', key: 'landing.demo.bud.cat.act_n' },    v: '€702',   w: '34%' },
    { c: 'var(--dc-madrid)', tKey: 'landing.demo.bud.cat.food',   pill: { cls: 'hand', key: 'landing.demo.bud.cat.food_n' },   v: '€268',   w: '13%' },
    { c: 'var(--dc-lisbon)', tKey: 'landing.demo.bud.cat.svc',    pill: { cls: 'auto', key: 'landing.demo.bud.cat.svc_n' },    v: '€110',   w: '5%' },
    { c: 'var(--dc-barcelona)', tKey: 'landing.demo.bud.cat.shop',   pill: { cls: 'hand', key: 'landing.demo.bud.cat.shop_n' },   v: '€74',    w: '4%' },
  ],
  perone: '€1 023',
  expenses: [
    { tint: { s: 'var(--dc-stay-s)', k: 'var(--dc-stay-k)' }, icon: 'i-bed',    tKey: 'landing.demo.bud.e1.t', sKey: 'landing.demo.bud.e1.s', pill: { cls: 'auto', key: 'landing.demo.bud.pill_auto' }, v: '€465' },
    { tint: { s: 'var(--dc-act-s)', k: 'var(--dc-act-k)' }, icon: 'i-ticket', tKey: 'landing.demo.bud.e2.t', sKey: 'landing.demo.bud.e2.s', pill: { cls: 'auto', key: 'landing.demo.bud.pill_auto' }, v: '€180' },
    { tint: { s: 'var(--dc-move-s)', k: 'var(--dc-move-k)' }, icon: 'i-plane',  tKey: 'landing.demo.bud.e3.t', sKey: 'landing.demo.bud.e3.s', pill: { cls: 'auto', key: 'landing.demo.bud.pill_auto' }, v: '€148' },
    { tint: { s: 'var(--dc-move-s)', k: 'var(--dc-move-k)' }, icon: 'i-car',    tKey: 'landing.demo.bud.e4.t', sKey: 'landing.demo.bud.e4.s', pill: { cls: 'auto', key: 'landing.demo.bud.pill_auto' }, v: '€96' },
    { tint: { s: 'var(--dc-food-s)', k: 'var(--dc-food-k)' }, icon: 'i-food',   tKey: 'landing.demo.bud.e5.t', sKey: 'landing.demo.bud.e5.s', pill: { cls: 'hand', key: 'landing.demo.bud.pill_hand' }, v: '€96' },
    { tint: { s: 'var(--dc-shop-s)', k: 'var(--dc-shop-k)' }, icon: 'i-wallet', tKey: 'landing.demo.bud.e6.t', sKey: 'landing.demo.bud.e6.s', pill: { cls: 'hand', key: 'landing.demo.bud.pill_hand' }, v: '€38' },
  ],
};

// ── Bento: calendar / docs / services / stats ─────────────────────────────
// Calendar: 34 cells (Aug 31 → Oct 4). Trip days carry a city colour, day-of-move
// days carry a two-colour bar, `dots` = event count that day. Leading/trailing
// blanks are `{}`. Verbatim from the prototype.
const C = DEMO_CITY_COLORS;
export const DEMO_CAL = [
  {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, // 31, 1..11 (before trip)
  { n: 12, c: C.rome, dots: 2 }, { n: 13, c: C.rome, dots: 1 }, { n: 14, c: C.rome, dots: 3 },
  { n: 15, c: C.rome, bar2: [C.rome, C.milan], dots: 3 }, { n: 16, c: C.milan, dots: 2 },
  { n: 17, c: C.milan, bar2: [C.milan, C.barcelona], dots: 2 }, { n: 18, c: C.barcelona, dots: 1 },
  { n: 19, c: C.barcelona, dots: 1 }, { n: 20, c: C.barcelona, bar2: [C.barcelona, C.valencia], dots: 2 },
  { n: 21, c: C.valencia, dots: 2 }, { n: 22, c: C.valencia, bar2: [C.valencia, C.madrid], dots: 2 },
  { n: 23, c: C.madrid, dots: 1 }, { n: 24, c: C.madrid, dots: 0 },
  { n: 25, c: C.madrid, bar2: [C.madrid, C.porto], dots: 3 }, { n: 26, c: C.porto, dots: 1 },
  { n: 27, c: C.porto, bar2: [C.porto, C.lisbon], dots: 3 }, { n: 28, c: C.lisbon, dots: 1 },
  { n: 29, c: C.lisbon, dots: 1 }, { n: 30, c: C.lisbon, dots: 1 },
  { n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, // after trip
];
export const DEMO_CAL_LEGEND = [
  { c: C.rome, key: 'landing.demo.city.rome' }, { c: C.milan, key: 'landing.demo.city.milan' },
  { c: C.barcelona, key: 'landing.demo.city.barcelona' }, { c: C.valencia, key: 'landing.demo.city.valencia' },
  { c: C.madrid, key: 'landing.demo.city.madrid' }, { c: C.porto, key: 'landing.demo.city.porto' },
  { c: C.lisbon, key: 'landing.demo.city.lisbon' },
];
export const DEMO_DOCS = [
  { c: 'var(--dc-valencia)', ft: 'PDF', tKey: 'landing.demo.doc.d1.t', sKey: 'landing.demo.doc.d1.s' },
  { c: 'var(--dc-milan)', ft: 'PDF', tKey: 'landing.demo.doc.d2.t', sKey: 'landing.demo.doc.d2.s' },
  { c: 'var(--dc-madrid)', ft: 'PDF', tKey: 'landing.demo.doc.d3.t', sKey: 'landing.demo.doc.d3.s' },
  { c: 'var(--dc-barcelona)', ft: 'LNK', tKey: 'landing.demo.doc.d4.t', sKey: 'landing.demo.doc.d4.s' },
  { c: 'var(--dc-doc-neutral)', ft: 'JPG', tKey: 'landing.demo.doc.d5.t', sKey: 'landing.demo.doc.d5.s' },
];
export const DEMO_SVC = [
  { icon: 'i-card-sim', tKey: 'landing.demo.svc.s1.t', sKey: 'landing.demo.svc.s1.s', done: true },
  { icon: 'i-car', mint: true, tKey: 'landing.demo.svc.s2.t', sKey: 'landing.demo.svc.s2.s', done: true },
  { icon: 'i-shield', add: true, tKey: 'landing.demo.svc.s3.t', sKey: 'landing.demo.svc.s3.s' },
];
export const DEMO_STAT_TILES = [
  { n: '4',  key: 'landing.demo.stat.flights' },
  { n: '3',  key: 'landing.demo.stat.trains' },
  { n: '18', key: 'landing.demo.stat.nights' },
  { n: '10', key: 'landing.demo.stat.acts' },
];
export const DEMO_STAT_LINES = [
  { icon: 'i-plane', tKey: 'landing.demo.stat.air',     em: '4 641 км', emNum: true },
  { icon: 'i-car', mint: true, tKey: 'landing.demo.stat.ground', em: '1 356 км', emNum: true },
  { icon: 'i-clock', vio: true, tKey: 'landing.demo.stat.longest', emKey: 'landing.demo.stat.longest_v' },
];

// ── Team: members + roles + group chat ────────────────────────────────────
export const DEMO_MEMBERS = [
  { ini: 'AL', color: 'var(--dc-barcelona)', name: 'Ava Lindqvist',  subKey: 'landing.demo.team.m1.sub', pill: { cls: 'auto', key: 'landing.demo.team.role_owner' } },
  { ini: 'MF', color: 'var(--dc-rome)', name: 'Marco Ferretti', subKey: 'landing.demo.team.m2.sub', pill: { cls: 'hand', key: 'landing.demo.team.role_admin' } },
  { ini: 'PR', color: 'var(--dc-valencia)', name: 'Priya Raman',    subKey: 'landing.demo.team.m3.sub', pill: { cls: 'hand', key: 'landing.demo.team.role_admin' } },
  { ini: 'NA', color: 'var(--dc-madrid)', name: 'Noah Adeyemi',   subKey: 'landing.demo.team.m4.sub', pill: { cls: 'hand', key: 'landing.demo.team.role_viewer' } },
  { pending: true, icon: 'i-mail', name: 'sofia.marin@mail.com', subKey: 'landing.demo.team.m5.sub', pill: { cls: 'todo', key: 'landing.demo.team.role_pending' } },
];
export const DEMO_ROLE_NOTES = ['landing.demo.team.note_owner', 'landing.demo.team.note_admin', 'landing.demo.team.note_viewer'];
export const DEMO_CHAT = [
  { who: 'Marco', color: 'var(--dc-rome)', ini: 'MF', time: '14:02', bKey: 'landing.demo.chat.m1' },
  { who: 'Priya', color: 'var(--dc-valencia)', ini: 'PR', time: '14:05', bKey: 'landing.demo.chat.m2' },
  { me: true, who: 'Ava', color: 'var(--dc-barcelona)', ini: 'AL', time: '14:07', bKey: 'landing.demo.chat.m3' },
  { who: 'Noah', color: 'var(--dc-madrid)', ini: 'NA', time: '14:11', mention: '@Triplanio', bKey: 'landing.demo.chat.m4' },
  { ai: true, who: 'Triplanio', ini: 'i-spark', time: '14:11', pill: 'landing.demo.chat.ai_pill', bKey: 'landing.demo.chat.m5' },
];

// ── Telegram assistant ────────────────────────────────────────────────────
export const DEMO_TG_MSGS = [
  { date: 'landing.demo.tg.date1' },
  { bot: true, bKey: 'landing.demo.tg.b1', time: '09:00' },
  { date: 'landing.demo.tg.date2' },
  { bot: true, bKey: 'landing.demo.tg.b2', time: '15:00' },
  { user: true, bKey: 'landing.demo.tg.u1', time: '15:04', ticks: true },
  { bot: true, bKey: 'landing.demo.tg.b3', time: '15:04', doc: { name: 'gotic1900-voucher.pdf', metaKey: 'landing.demo.tg.doc_meta' } },
];
export const DEMO_TG_POINTS = [
  { icon: 'i-bell', warm: true, tKey: 'landing.demo.tg.p1.t', pKey: 'landing.demo.tg.p1.p' },
  { icon: 'i-chat', tKey: 'landing.demo.tg.p2.t', pKey: 'landing.demo.tg.p2.p' },
  { icon: 'i-doc', mint: true, tKey: 'landing.demo.tg.p3.t', pKey: 'landing.demo.tg.p3.p' },
];
export const DEMO_TG_WHEN = [
  { icon: 'i-bed', tKey: 'landing.demo.tg.w1', emKey: 'landing.demo.tg.w1v' },
  { icon: 'i-bed', tKey: 'landing.demo.tg.w2', emKey: 'landing.demo.tg.w2v' },
  { icon: 'i-clock', tKey: 'landing.demo.tg.w3', emKey: 'landing.demo.tg.w3v' },
  { icon: 'i-swap', tKey: 'landing.demo.tg.w4', emKey: 'landing.demo.tg.w4v' },
  { icon: 'i-ticket', tKey: 'landing.demo.tg.w5', emKey: 'landing.demo.tg.w5v' },
  { icon: 'i-spark', tKey: 'landing.demo.tg.w6', emKey: 'landing.demo.tg.w6v' },
];

// Header section anchors (own state of the unified <SiteHeader>).
export const DEMO_NAV = [
  { tkey: 'landing.demo.nav.route', hash: '#route' },
  { tkey: 'landing.demo.nav.timeline', hash: '#timeline' },
  { tkey: 'landing.demo.nav.budget', hash: '#budget' },
  { tkey: 'landing.demo.nav.team', hash: '#team' },
  { tkey: 'landing.demo.nav.assistant', hash: '#assistant' },
];
