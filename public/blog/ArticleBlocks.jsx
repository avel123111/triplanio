/* global React, window, Icon */
const { useState: useStateB, useEffect: useEffectB } = React;
const P = window.TRIP.PHOTO, G = window.TRIP.GRAD;

/* ── content datasets for the demo (Lisbon) ── */
const GALLERY_IMGS = [
  { src: P.belem, grad: G[0], cap: "Монастырь Жеронимуш, Белен" },
  { src: P.tram28, grad: G[3], cap: "Трамвай 28 на спуске" },
  { src: P.fado, grad: G[1], cap: "Вечер фаду в Алфаме" },
  { src: P.pastel, grad: G[4], cap: "Азулежу на фасадах" },
  { src: P.lisbon3, grad: G[2], cap: "Жёлтый фуникулёр" },
  { src: P.miradouro, grad: G[0], cap: "Вид с мирадору" },
];
const MAP_POINTS = [
  { x: 26, y: 38, n: 1, t: "Алфама", d: "Старейший район — лабиринт улиц и фаду", img: P.lisbon2 },
  { x: 48, y: 24, n: 2, t: "Miradouro da Graça", d: "Смотровая без толп, лучший закат", img: P.miradouro, warm: 1 },
  { x: 62, y: 56, n: 3, t: "Time Out Market", d: "Гастрорынок, 24 кухни под одной крышей", img: P.food },
  { x: 80, y: 70, n: 4, t: "Белен", d: "Монастырь и оригинальные паштел-де-ната", img: P.belem },
  { x: 40, y: 70, n: 5, t: "Cais do Sodré", d: "Набережная и розовая улица", img: P.lisbon1, warm: 1 },
];
const PLACES = [
  { n: 1, t: "Taberna da Rua das Flores", meta: "Байру-Алту · €€ · без брони", d: "Маленькая таверна, меню меняется каждый день — приходите к открытию в 12:00.", rate: "4.8", img: P.food },
  { n: 2, t: "A Cevicheria", meta: "Принсипи-Реал · €€€", d: "Севиче под гигантским осьминогом на потолке. Очередь идёт быстро.", rate: "4.7", img: P.lisbon1 },
  { n: 3, t: "O Trevo", meta: "Cais do Sodré · €", d: "Тот самый бифана, который хвалил Бурдейн. Стоя, у стойки, с бокалом вина.", rate: "4.6", img: P.pastel },
];
const MONTHS = [
  { m: "Я", h: 30, c: "#7aa5ff" }, { m: "Ф", h: 32, c: "#7aa5ff" }, { m: "М", h: 48, c: "#5b8fff" },
  { m: "А", h: 64, c: "#2167e2" }, { m: "М", h: 82, c: "#1f8a5b" }, { m: "И", h: 92, c: "#1f8a5b", peak: 1 },
  { m: "И", h: 100, c: "#c9603a", peak: 1 }, { m: "А", h: 100, c: "#c9603a", peak: 1 }, { m: "С", h: 88, c: "#1f8a5b", peak: 1 },
  { m: "О", h: 66, c: "#2167e2" }, { m: "Н", h: 44, c: "#5b8fff" }, { m: "Д", h: 34, c: "#7aa5ff" },
];
const VISA = [
  { p: "Россия", v: "Шенген", st: "viza", note: "Виза C, до 90 дней" },
  { p: "Казахстан", v: "Шенген", st: "viza", note: "Виза C, запись заранее" },
  { p: "ЕС / Шенген", v: "Не нужна", st: "ok", note: "Свободный въезд" },
  { p: "Грузия", v: "Шенген", st: "viza", note: "Виза C" },
  { p: "Сербия", v: "Не нужна", st: "ok", note: "До 90 дней" },
];
const CHECK = [
  { t: "Удобная обувь на подъёмы", s: "обязательно" }, { t: "Ветровка — с океана дует", s: "" },
  { t: "Универсальный переходник (тип F)", s: "" }, { t: "Наличные на маленькие таверны", s: "€50–80" },
  { t: "Viva Viagem — транспортная карта", s: "" }, { t: "Солнцезащитный крем", s: "" },
];
const COMPARE = [
  { area: "Алфама", vibe: "Атмосфера, фаду", price: "€€", who: "Впервые", best: 0 },
  { area: "Шиаду / Байша", vibe: "Центр, всё рядом", price: "€€€", who: "Шопинг", best: 1 },
  { area: "Príncipe Real", vibe: "Стильно, тихо", price: "€€€", who: "Пары", best: 0 },
  { area: "Cais do Sodré", vibe: "Бары, набережная", price: "€€", who: "Ночная жизнь", best: 0 },
];

/* ── primitive blocks ── */
const Lede = ({ text }) => <p className="lede-p blockgap">{text}</p>;
const TextBlock = ({ html }) => <p dangerouslySetInnerHTML={{ __html: html }} />;
const Heading = ({ id, text }) => <h2 id={id} data-toc={id}>{text}</h2>;
const Quote = ({ text, cite }) => <blockquote className="bquote"><p>{text}</p>{cite && <cite>— {cite}</cite>}</blockquote>;

function PhotoText({ side, img, grad, title, html, caption }) {
  return (
    <div className={`photoText ${side === "right" ? "right" : ""}`}>
      <figure className="pt-media" style={{ margin: 0 }}>
        <window.Img src={img} grad={grad} />
        {caption && <figcaption style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8 }}>{caption}</figcaption>}
      </figure>
      <div><h3>{title}</h3><p dangerouslySetInnerHTML={{ __html: html }} /></div>
    </div>
  );
}
function FullPhoto({ img, grad, caption }) {
  return (
    <figure className="figure fullbleed"><window.Img src={img} grad={grad} />{caption && <figcaption>{caption}</figcaption>}</figure>
  );
}

/* ── gallery + lightbox (lightbox lifted to app context) ── */
function Gallery() {
  const { openLightbox } = window.useApp();
  const imgs = GALLERY_IMGS;
  const shown = imgs.slice(0, 5);
  return (
    <div className="gallery">
      {shown.map((g, i) => (
        <button key={i} onClick={() => openLightbox(imgs, i)}>
          <window.Img src={g.src} grad={g.grad} />
          {i === 4 && imgs.length > 5 && <span className="more-ov">+{imgs.length - 5}</span>}
        </button>
      ))}
    </div>
  );
}

/* ── interactive map ── */
function MapBlock() {
  const [active, setActive] = useStateB(null);
  return (
    <div className="mapblock">
      <div className="mapcanvas" onClick={() => setActive(null)}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path d="M10 95 Q 20 70 26 60 T 48 40 T 80 28" fill="none" stroke="rgba(33,103,226,.5)" strokeWidth="0.8" strokeDasharray="2 2">
            <animate attributeName="stroke-dashoffset" from="0" to="-12" dur="1.4s" repeatCount="indefinite" />
          </path>
        </svg>
        {MAP_POINTS.map(p => (
          <div key={p.n} className="mappin" data-warm={p.warm} style={{ left: p.x + "%", top: p.y + "%" }}
            onClick={(e) => { e.stopPropagation(); setActive(active === p.n ? null : p.n); }}>
            <div className="mappin__dot"><span className="mappin__num">{p.n}</span></div>
          </div>
        ))}
        {active && (() => { const p = MAP_POINTS.find(x => x.n === active); return (
          <div className="mappopup" style={{ left: Math.min(Math.max(p.x, 20), 80) + "%", top: p.y + "%" }} onClick={e => e.stopPropagation()}>
            <window.Img src={p.img} grad={G[0]} />
            <div className="mappopup__b"><div className="mappopup__t">{p.n}. {p.t}</div><div className="mappopup__d">{p.d}</div></div>
          </div>
        ); })()}
      </div>
      <div className="maplegend">
        <span><Icon name="pin" size={13} style={{ color: "var(--brand)" }} />Точки маршрута</span>
        <span><i style={{ background: "var(--warm)" }} />Смотровые</span>
        <span className="muted" style={{ marginLeft: "auto" }}>Нажмите на точку</span>
      </div>
    </div>
  );
}

/* ── list cards (places) ── */
function ListCards() {
  return (
    <div className="placelist">
      {PLACES.map(p => (
        <div className="placecard" key={p.n}>
          <window.Img src={p.img} grad={G[1]} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="placecard__t"><span className="placecard__n">{p.n}</span>{p.t}<span className="placecard__rate" style={{ marginLeft: "auto" }}><Icon name="star" size={13} fill="currentColor" />{p.rate}</span></div>
            <div className="placecard__meta">{p.meta}</div>
            <div className="placecard__d">{p.d}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── best time ── */
function BestTime() {
  return (
    <div className="besttime">
      <div className="flexrow" style={{ marginBottom: 6 }}><Icon name="calendar" size={18} style={{ color: "var(--brand)" }} /><b style={{ fontFamily: "var(--font-display)" }}>Лучшее время для поездки</b></div>
      <div className="months">
        {MONTHS.map((m, i) => (
          <div key={i} className={`month ${m.peak ? "peak" : ""}`}>
            <div className="month__bar" style={{ background: "var(--surface-2)" }}><div style={{ width: "100%", height: m.h + "%", background: m.c, borderRadius: 6 }} /></div>
            <div className="month__lbl">{m.m}</div>
          </div>
        ))}
      </div>
      <div className="besttime__legend">
        <span><i style={{ background: "#c9603a" }} />Пик · жарко и людно</span>
        <span><i style={{ background: "#1f8a5b" }} />Идеально</span>
        <span><i style={{ background: "#7aa5ff" }} />Низкий сезон · дёшево</span>
      </div>
    </div>
  );
}

/* ── visa / compare tables ── */
function VisaTable() {
  return (
    <div className="tablewrap">
      <table><thead><tr><th>Паспорт</th><th>Виза</th><th>Условия</th></tr></thead>
        <tbody>{VISA.map((r, i) => (
          <tr key={i}><td className="hl">{r.p}</td><td><span className={r.st === "ok" ? "pillok" : "pillmid"}>{r.v}</span></td><td>{r.note}</td></tr>
        ))}</tbody></table>
    </div>
  );
}
function CompareTable() {
  return (
    <div className="tablewrap">
      <table><thead><tr><th>Район</th><th>Атмосфера</th><th>Цена</th><th>Кому</th></tr></thead>
        <tbody>{COMPARE.map((r, i) => (
          <tr key={i}><td className="hl">{r.area}{r.best ? <span className="pillok" style={{ marginLeft: 6 }}>выбор</span> : null}</td><td>{r.vibe}</td><td className="num">{r.price}</td><td>{r.who}</td></tr>
        ))}</tbody></table>
    </div>
  );
}

/* ── interactive checklist ── */
function Checklist() {
  const [done, setDone] = useStateB(() => {
    try { return JSON.parse(localStorage.getItem("trip_check") || "[]"); } catch { return []; }
  });
  const toggle = (i) => setDone(prev => { const n = prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]; localStorage.setItem("trip_check", JSON.stringify(n)); return n; });
  return (
    <div className="checklist">
      <div className="checklist__head"><Icon name="check" size={18} style={{ color: "var(--success)" }} /><h4>Чеклист для упаковки</h4><span className="checklist__progress">{done.length}/{CHECK.length}</span></div>
      {CHECK.map((c, i) => (
        <button key={i} className={`checkitem ${done.includes(i) ? "done" : ""}`} onClick={() => toggle(i)}>
          <span className="checkbox">{done.includes(i) && <Icon name="check" size={14} />}</span>
          <span className="ci-lbl">{c.t}</span>{c.s && <span className="ci-sub">{c.s}</span>}
        </button>
      ))}
    </div>
  );
}

/* ── monetization: embed wrapper with load state ── */
function useEmbedLoad(delay) {
  const [loaded, setLoaded] = useStateB(false);
  useEffectB(() => { const t = setTimeout(() => setLoaded(true), delay || 1200); return () => clearTimeout(t); }, []);
  return loaded;
}
function MonHead({ brand, color, badge }) {
  return (
    <div className="mon__head">
      <span className="mon__logo"><span className="sq" style={{ background: color }}>{brand[0]}</span>{brand}</span>
      <span className="mon__tag"><Icon name="sparkles" size={12} />{badge || "партнёр"}</span>
    </div>
  );
}
function EmbedLoading({ label }) {
  return <div className="embedload"><div className="spin" /><div className="muted" style={{ fontSize: 13 }}>{label}</div></div>;
}

function BookingWidget() {
  const loaded = useEmbedLoad(1300);
  return (
    <div className="mon">
      <MonHead brand="Booking.com" color="#003580" badge="поиск отелей" />
      <div className="mon__body">
        {!loaded ? <EmbedLoading label="Загружаем доступные отели в Лиссабоне…" /> : (
          <div className="mon__fields row3">
            <div className="monfield"><label>Город</label><div className="inp"><Icon name="pin" size={15} style={{ color: "var(--muted)" }} />Лиссабон</div></div>
            <div className="monfield"><label>Заезд</label><div className="inp"><Icon name="calendar" size={15} style={{ color: "var(--muted)" }} />12 июл</div></div>
            <div className="monfield"><label>Выезд</label><div className="inp"><Icon name="calendar" size={15} style={{ color: "var(--muted)" }} />14 июл</div></div>
            <button className="btn btn--primary" style={{ background: "#003580" }}><Icon name="search" size={16} />Найти</button>
          </div>
        )}
      </div>
    </div>
  );
}
function FlightsWidget() {
  const loaded = useEmbedLoad(1500);
  return (
    <div className="mon">
      <MonHead brand="Skyscanner" color="#0770e3" badge="авиабилеты" />
      <div className="mon__body">
        {!loaded ? <EmbedLoading label="Ищем лучшие цены на перелёты…" /> : (
          <div className="mon__fields row3">
            <div className="monfield"><label>Маршрут</label><div className="inp num"><Icon name="plane" size={15} style={{ color: "var(--muted)" }} />MOW → LIS</div></div>
            <div className="monfield"><label>Туда</label><div className="inp">12 июл</div></div>
            <div className="monfield"><label>Обратно</label><div className="inp">23 июл</div></div>
            <button className="btn btn--primary" style={{ background: "#0770e3" }}><Icon name="search" size={16} />Цены</button>
          </div>
        )}
      </div>
    </div>
  );
}
function ActivitiesWidget() {
  const loaded = useEmbedLoad(1400);
  const acts = [
    { t: "Прогулка на тук-туке по холмам", p: "€35", m: "2 ч · ⭐ 4.9", img: P.lisbon1 },
    { t: "Дегустация портвейна и закаты", p: "€42", m: "3 ч · ⭐ 4.8", img: P.fado },
  ];
  return (
    <div className="mon">
      <MonHead brand="GetYourGuide" color="#ff5533" badge="активности" />
      <div className="mon__body">
        {!loaded ? <EmbedLoading label="Подбираем экскурсии и впечатления…" /> : (
          <div className="actgrid">
            {acts.map((a, i) => (
              <div className="actcard" key={i}>
                <window.Img src={a.img} grad={G[i]} />
                <div className="actcard__b"><div className="actcard__t">{a.t}</div><div className="actcard__m"><span>{a.m}</span><span>от <b>{a.p}</b></span></div></div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
function AffiliateCard() {
  return (
    <div className="mon"><MonHead brand="Memmo Alfama" color="#c9603a" badge="отель · реклама" />
      <div className="affcard"><window.Img src={P.lisbon2} grad={G[0]} />
        <div className="affcard__b">
          <div className="affcard__name">Memmo Alfama Hotel</div>
          <div className="affcard__loc"><Icon name="pin" size={13} />Алфама · бассейн на крыше</div>
          <div className="affcard__rate"><Icon name="star" size={13} fill="currentColor" />9.1 · Превосходно</div>
          <div className="affcard__foot"><div className="affcard__price"><b className="num">€189</b> <span>/ ночь</span></div><button className="btn btn--primary" style={{ padding: "9px 14px" }}>Смотреть</button></div>
        </div>
      </div>
    </div>
  );
}

const ARTICLE_BLOCKS = {
  Lede, TextBlock, Heading, Quote, PhotoText, FullPhoto, Gallery, MapBlock, ListCards,
  BestTime, VisaTable, CompareTable, Checklist, BookingWidget, FlightsWidget, ActivitiesWidget, AffiliateCard,
};
Object.assign(window, { ARTICLE_BLOCKS, GALLERY_IMGS });
