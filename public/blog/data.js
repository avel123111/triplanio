/* global window */
/* ============================================================
   Triplanio Blog — mock data (RU)
   ============================================================ */

/* Curated pool of warm travel photos (Unsplash). Each card/article
   carries a fallback gradient so a 404 still looks intentional. */
const PHOTO = {
  lisbon1: "https://images.unsplash.com/photo-1585208798174-6cedd86e019a?auto=format&fit=crop&w=1200&q=70",
  lisbon2: "https://images.unsplash.com/photo-1513735492246-483525079686?auto=format&fit=crop&w=1200&q=70",
  lisbon3: "https://images.unsplash.com/photo-1555881400-74d7acaacd8b?auto=format&fit=crop&w=1200&q=70",
  santorini: "https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=1200&q=70",
  beach: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=70",
  algarve: "https://images.unsplash.com/photo-1493558103817-58b2924bce98?auto=format&fit=crop&w=1200&q=70",
  road: "https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?auto=format&fit=crop&w=1200&q=70",
  mountains: "https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=1200&q=70",
  dolomites: "https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?auto=format&fit=crop&w=1200&q=70",
  forest: "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=1200&q=70",
  paris: "https://images.unsplash.com/photo-1499856871958-5b9627545d1a?auto=format&fit=crop&w=1200&q=70",
  venice: "https://images.unsplash.com/photo-1523906834658-6e24ef2386f9?auto=format&fit=crop&w=1200&q=70",
  tokyo: "https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?auto=format&fit=crop&w=1200&q=70",
  kyoto: "https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=1200&q=70",
  tbilisi: "https://images.unsplash.com/photo-1565008576549-57569a49371d?auto=format&fit=crop&w=1200&q=70",
  istanbul: "https://images.unsplash.com/photo-1541432901042-2d8bd64b4a9b?auto=format&fit=crop&w=1200&q=70",
  food: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=1200&q=70",
  barcelona: "https://images.unsplash.com/photo-1583422409516-2895a77efded?auto=format&fit=crop&w=1200&q=70",
  pastel: "https://images.unsplash.com/photo-1556767576-5ec41e3239ea?auto=format&fit=crop&w=1200&q=70",
  miradouro: "https://images.unsplash.com/photo-1588535684409-3387d0e1d4b1?auto=format&fit=crop&w=1200&q=70",
  tram28: "https://images.unsplash.com/photo-1571406384350-c1a8d2e6f6b6?auto=format&fit=crop&w=1200&q=70",
  belem: "https://images.unsplash.com/photo-1518533954129-7774297db60f?auto=format&fit=crop&w=1200&q=70",
  fado: "https://images.unsplash.com/photo-1551316679-9c6ae9dec224?auto=format&fit=crop&w=1200&q=70",
};

const GRAD = [
  "linear-gradient(135deg,#2167e2,#0b1f47)",
  "linear-gradient(135deg,#c9603a,#7a2e16)",
  "linear-gradient(135deg,#1f8a5b,#0c3a26)",
  "linear-gradient(135deg,#5b8fff,#173a8a)",
  "linear-gradient(135deg,#d4a02a,#6a4a0c)",
];

/* ── Taxonomy ── */
const CONTENT_TYPES = [
  { id: "guide",       label: "Гайд" },
  { id: "news",        label: "Новости" },
  { id: "inspiration", label: "Вдохновение" },
  { id: "tips",        label: "Практические советы" },
  { id: "listicle",    label: "Подборка" },
  { id: "comparison",  label: "Сравнение" },
  { id: "deal",        label: "Дил" },
];

const TOPICS = [
  { id: "nomad",   label: "Digital Nomad" },
  { id: "budget",  label: "Бюджет" },
  { id: "luxury",  label: "Люкс" },
  { id: "adventure", label: "Приключения" },
  { id: "food",    label: "Еда и рестораны" },
  { id: "culture", label: "Культура и история" },
  { id: "solo",    label: "Соло" },
  { id: "family",  label: "Семья с детьми" },
  { id: "honeymoon", label: "Медовый месяц" },
  { id: "eco",     label: "Устойчивый туризм" },
  { id: "visa",    label: "Визы и документы" },
];

/* Destination hierarchy: continent → country → city */
const DESTINATIONS = [
  { id: "europe", label: "Европа", countries: [
    { id: "portugal", label: "Португалия", cities: [
      { id: "lisbon", label: "Лиссабон" }, { id: "porto", label: "Порту" }, { id: "faro", label: "Фару" },
    ]},
    { id: "spain", label: "Испания", cities: [
      { id: "barcelona", label: "Барселона" }, { id: "madrid", label: "Мадрид" },
    ]},
    { id: "italy", label: "Италия", cities: [
      { id: "rome", label: "Рим" }, { id: "venice", label: "Венеция" }, { id: "dolomites", label: "Доломиты" },
    ]},
    { id: "greece", label: "Греция", cities: [
      { id: "santorini", label: "Санторини" }, { id: "athens", label: "Афины" },
    ]},
  ]},
  { id: "asia", label: "Азия", countries: [
    { id: "japan", label: "Япония", cities: [
      { id: "tokyo", label: "Токио" }, { id: "kyoto", label: "Киото" },
    ]},
    { id: "georgia", label: "Грузия", cities: [
      { id: "tbilisi", label: "Тбилиси" },
    ]},
    { id: "turkey", label: "Турция", cities: [
      { id: "istanbul", label: "Стамбул" },
    ]},
  ]},
  { id: "americas", label: "Америка", countries: [
    { id: "mexico", label: "Мексика", cities: [ { id: "cdmx", label: "Мехико" } ]},
  ]},
];

const TAGS = ["пляж","хайкинг","архитектура","ночная жизнь","музеи","уличная еда","закаты","острова","вино","смотровые","трамваи","рынки"];

/* helpers for labels */
function destPath(d) {
  // d = {continent, country, city}
  const cont = DESTINATIONS.find(c => c.id === d.continent);
  const country = cont && cont.countries.find(c => c.id === d.country);
  const city = country && d.city && country.cities.find(c => c.id === d.city);
  return [cont && cont.label, country && country.label, city && city.label].filter(Boolean);
}

/* ── Articles ── */
const ARTICLES = [
  {
    slug: "48-hours-lisbon",
    title: "48 часов в Лиссабоне: маршрут по холмам, без спешки",
    excerpt: "Алфама на рассвете, паштел-де-ната в полдень, фаду на закате. Готовый план на выходные с точными адресами, билетами на трамвай 28 и смотровыми, где нет толп.",
    cover: PHOTO.lisbon1, grad: GRAD[0],
    type: "guide", topics: ["culture","food"],
    dest: { continent: "europe", country: "portugal", city: "lisbon" },
    tags: ["трамваи","смотровые","уличная еда","закаты"],
    read: 9, date: "2026-05-18", updated: "2026-05-26",
    author: { name: "Марина Соколова", role: "Редактор · Южная Европа" },
    featured: true,
  },
  {
    slug: "algarve-beaches",
    title: "10 пляжей Алгарве, ради которых стоит арендовать машину",
    excerpt: "Скрытые бухты под золотыми скалами, куда не доезжают экскурсионные автобусы — от Прайя-да-Маринья до Понта-да-Пьедаде.",
    cover: PHOTO.algarve, grad: GRAD[3],
    type: "listicle", topics: ["adventure","budget"],
    dest: { continent: "europe", country: "portugal", city: "faro" },
    tags: ["пляж","острова","закаты"],
    read: 7, date: "2026-05-12",
    author: { name: "Алексей Гром", role: "Редактор" },
  },
  {
    slug: "d7-visa-portugal",
    title: "Виза D7 в Португалии: как оформить цифровому кочевнику",
    excerpt: "Пошагово: доход, документы, сроки, нюансы продления. Что изменилось в 2026 году и сколько реально занимает процесс.",
    cover: PHOTO.pastel, grad: GRAD[4],
    type: "tips", topics: ["nomad","visa"],
    dest: { continent: "europe", country: "portugal" },
    tags: ["архитектура"],
    read: 12, date: "2026-04-28", updated: "2026-05-20",
    author: { name: "Дарья Левина", role: "Визы и документы" },
  },
  {
    slug: "tbilisi-budget",
    title: "Бюджетная Грузия: неделя в Тбилиси за 30 000 ₽",
    excerpt: "Где жить в Сололаки, как есть хинкали недорого и почему серные бани стоят каждого лари. Реальная смета на семь дней.",
    cover: PHOTO.tbilisi, grad: GRAD[1],
    type: "guide", topics: ["budget","food"],
    dest: { continent: "asia", country: "georgia", city: "tbilisi" },
    tags: ["уличная еда","вино","архитектура"],
    read: 8, date: "2026-05-05",
    author: { name: "Нино Кахиани", role: "Редактор · Кавказ" },
  },
  {
    slug: "tokyo-vs-kyoto",
    title: "Токио против Киото: где провести первую поездку в Японию",
    excerpt: "Неон и скорость или храмы и тишина. Сравниваем по семи параметрам, чтобы вы выбрали базу для дебютной поездки.",
    cover: PHOTO.tokyo, grad: GRAD[3],
    type: "comparison", topics: ["culture","solo"],
    dest: { continent: "asia", country: "japan" },
    tags: ["музеи","ночная жизнь","архитектура"],
    read: 10, date: "2026-04-30",
    author: { name: "Ким Тэён", role: "Редактор · Азия" },
  },
  {
    slug: "kyoto-ryokan",
    title: "Рёканы Киото с онсэном: где остановиться ради тишины",
    excerpt: "Семь традиционных гостиниц с частными горячими источниками, кайсэки-ужином и видом на сад. От доступных до по-настоящему люксовых.",
    cover: PHOTO.kyoto, grad: GRAD[2],
    type: "listicle", topics: ["luxury","culture"],
    dest: { continent: "asia", country: "japan", city: "kyoto" },
    tags: ["архитектура","закаты"],
    read: 6, date: "2026-05-09",
    author: { name: "Ким Тэён", role: "Редактор · Азия" },
  },
  {
    slug: "santorini-honeymoon",
    title: "Медовый месяц на Санторини: где остановиться ради заката",
    excerpt: "Ия или Имеровигли, кальдера или пляж. Отели с инфинити-бассейном над морем и без свадебных толп.",
    cover: PHOTO.santorini, grad: GRAD[3],
    type: "inspiration", topics: ["honeymoon","luxury"],
    dest: { continent: "europe", country: "greece", city: "santorini" },
    tags: ["закаты","острова","смотровые"],
    read: 5, date: "2026-05-22",
    author: { name: "Елена Маркидес", role: "Редактор · Острова" },
    featured: true,
  },
  {
    slug: "dolomites-hiking",
    title: "Треккинг в Доломитах: 5 маршрутов для тех, кто только начинает",
    excerpt: "От прогулки вокруг Тре-Чиме до рифуджио с панорамой. Перепады, время в пути и где остановиться на ночь в горах.",
    cover: PHOTO.dolomites, grad: GRAD[2],
    type: "guide", topics: ["adventure","eco"],
    dest: { continent: "europe", country: "italy", city: "dolomites" },
    tags: ["хайкинг","смотровые"],
    read: 11, date: "2026-04-22",
    author: { name: "Лука Ферро", role: "Горы и треккинг" },
  },
  {
    slug: "istanbul-street-food",
    title: "Гастротур по Стамбулу: маршрут по уличной еде",
    excerpt: "Балык-экмек у Галатского моста, симит на завтрак, кокореч в полночь. Где есть так, как едят местные.",
    cover: PHOTO.istanbul, grad: GRAD[1],
    type: "guide", topics: ["food","culture"],
    dest: { continent: "asia", country: "turkey", city: "istanbul" },
    tags: ["уличная еда","рынки","ночная жизнь"],
    read: 8, date: "2026-05-15",
    author: { name: "Эмре Йылдыз", role: "Еда и рынки" },
  },
  {
    slug: "barcelona-deal",
    title: "Дил недели: Барселона из Москвы и обратно от 18 900 ₽",
    excerpt: "Прямые даты в сентябре, ручная кладь включена. Ловите окно до конца недели — цены уже начали ползти вверх.",
    cover: PHOTO.barcelona, grad: GRAD[0],
    type: "deal", topics: ["budget"],
    dest: { continent: "europe", country: "spain", city: "barcelona" },
    tags: ["архитектура","ночная жизнь"],
    read: 3, date: "2026-05-28",
    author: { name: "Редакция дилов", role: "Цены и акции" },
  },
  {
    slug: "family-summer-2026",
    title: "Куда поехать с детьми летом 2026: 8 спокойных направлений",
    excerpt: "Короткие перелёты, мелкое море и инфраструктура без стресса. Подборка для семей, которые не хотят героизма.",
    cover: PHOTO.beach, grad: GRAD[3],
    type: "listicle", topics: ["family"],
    dest: { continent: "europe", country: "greece" },
    tags: ["пляж","острова"],
    read: 7, date: "2026-05-02",
    author: { name: "Марина Соколова", role: "Редактор" },
  },
  {
    slug: "sustainable-travel",
    title: "Устойчивый туризм без фанатизма: 12 решений, которые работают",
    excerpt: "Поезд вместо короткого перелёта, локальные гиды, межсезонье. Что реально снижает след, а что — маркетинг.",
    cover: PHOTO.forest, grad: GRAD[2],
    type: "tips", topics: ["eco"],
    dest: { continent: "europe" },
    tags: ["хайкинг"],
    read: 9, date: "2026-04-18",
    author: { name: "Дарья Левина", role: "Редактор" },
  },
];

/* ── Full demo article: ordered block library for "48 часов в Лиссабоне" ── */
const DEMO_BLOCKS = [
  { type: "lede", text: "Лиссабон не отдаёт себя за один заход. Но за два дня — если не пытаться успеть всё — он раскрывается холм за холмом: Алфама на рассвете, Байша в полдень, мирадору на закате. Вот маршрут, который мы протестировали сами." },

  { type: "heading", id: "day1", text: "День первый: Алфама и центр" },
  { type: "text", html: "Начните до толп. К восьми утра <strong>Алфама</strong> ещё дышит вчерашним фаду, бельё сушится между домами, а на ступенях пахнет кофе. Поднимайтесь без карты — потеряться здесь и есть весь смысл." },
  { type: "photoText", side: "left", img: PHOTO.lisbon2, grad: GRAD[0], caption: "Узкие улицы Алфамы на рассвете",
    title: "Трамвай 28 — но в правильную сторону",
    html: "Легендарный маршрут забит к десяти утра. Сядьте на конечной <em>Martim Moniz</em> в 8:30 или поезжайте в обратную сторону от <em>Campo de Ourique</em> — тот же вид, вдвое меньше людей." },
  { type: "map" },
  { type: "heading", id: "food", text: "Где есть, не переплачивая за вид" },
  { type: "text", html: "Правило простое: чем дальше от смотровой площадки, тем честнее цена. Вот три места в пешей доступности от маршрута, проверенные не туристическими отзывами, а очередью из местных." },
  { type: "listCards" },
  { type: "bookingMon" },
  { type: "quote", text: "Лиссабон — единственная столица, где можно сесть на трамвай XIX века, выйти к океану и не понять, как день стал вечером.", cite: "Из путевых заметок редакции" },

  { type: "heading", id: "day2", text: "День второй: Белен и закат" },
  { type: "text", html: "Второй день — про воду и свет. Утро в <strong>Белене</strong> у монастыря Жеронимуш, обязательный паштел в исторической пекарне, а вечер — на западных мирадору, откуда Тежу становится золотой." },
  { type: "gallery" },
  { type: "fullPhoto", img: PHOTO.miradouro, grad: GRAD[3], caption: "Закат с Miradouro de Santa Catarina" },
  { type: "heading", id: "season", text: "Когда ехать" },
  { type: "text", html: "Лиссабон хорош почти круглый год, но у каждого месяца свой характер. Лето жаркое и людное, зима мягкая и дешёвая." },
  { type: "bestTime" },
  { type: "flightsMon" },
  { type: "heading", id: "pack", text: "Что взять с собой" },
  { type: "text", html: "Город крутых булыжных подъёмов. Удобная обувь важнее всего остального — это не то место, где стоит разнашивать новые ботинки." },
  { type: "checklist" },
  { type: "heading", id: "compare", text: "Где остановиться: районы" },
  { type: "compareTable" },
  { type: "activitiesMon" },
  { type: "relatedInline" },
];

window.TRIP = {
  PHOTO, GRAD, CONTENT_TYPES, TOPICS, DESTINATIONS, TAGS, ARTICLES, DEMO_BLOCKS, destPath,
};
