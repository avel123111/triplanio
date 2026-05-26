import React, { useState, useEffect } from 'react'
import { Icon } from '../../design/icons'
import { Avatar, Btn, Badge, Card, Severity, EmptyState, fmt, TRIP, PartnerPill, detectPartner } from '../../design/index'

// =====================================================================
// TRIP TIMELINE — chronological lens (§7, §8) — 3 variants
// =====================================================================

// ---------- True chronological event stream ----------
const STREAM = [
  { type: "hotel-deadline", id: "d1", date: "2026-07-09", time: "23:59", city: "Лиссабон", title: "Дедлайн бесплатной отмены · Memmo Alfama",
    hotel: "Memmo Alfama", price: 880, cur: "EUR", note: "После — невозвратно. Решить сейчас, ехать ли." },

  { type: "flight", id: "f0", date: "2026-07-12", time: "08:35", duration: "4ч 25м", title: "TAP TP 1245",
    from: "SVO", to: "LIS", kind: "plane", carrier: "TAP Portugal", num: "TP 1245", price: 544, cur: "EUR",
    platformUrl: "https://tap.com", depart_loc: "Шереметьево T-D", arrive_loc: "Лиссабон-Портела" },
  { type: "hotel-checkin", id: "h1-in", date: "2026-07-12", time: "15:00", city: "Лиссабон", title: "Заезд · Memmo Alfama",
    hotelId: "h1", hotel: "Memmo Alfama", address: "Travessa das Merceeiras 27", price: 880, cur: "EUR", nights: 4,
    platformUrl: "https://booking.com/h/memmo", num: "BKN-72931" },

  { type: "activity", id: "a1", date: "2026-07-13", time: "10:00", duration: "1ч", city: "Лиссабон",
    title: "Завтрак · Pastéis de Belém", price: 24, cur: "EUR", category: "food",
    address: "R. de Belém 84-92" },
  { type: "activity", id: "a2", date: "2026-07-13", time: "14:00", duration: "2ч 30м", city: "Лиссабон",
    title: "Castelo de São Jorge", price: 30, cur: "EUR", category: "sight", address: "R. de Santa Cruz" },

  { type: "activity", id: "a3", date: "2026-07-14", time: "10:00", duration: "8ч", city: "Sintra",
    title: "Винный тур в Sintra", price: 145, cur: "EUR", category: "experience",
    address: "Sintra, Portugal · трансфер из отеля" },

  { type: "hotel-checkout", id: "h1-out", date: "2026-07-16", time: "11:00", city: "Лиссабон", title: "Выезд · Memmo Alfama", hotelId: "h1" },
  { type: "activity", id: "a-train-lunch", date: "2026-07-16", time: "13:00", duration: "1ч", city: "в пути",
    title: "Обед перед поездом · Time Out Market", price: 28, cur: "EUR", category: "food",
    address: "Av. 24 de Julho, Lisboa" },
  { type: "transfer", id: "t1", date: "2026-07-16", time: "14:25", duration: "3ч 15м", title: "CP IC 521",
    from: "Lisboa Oriente", to: "Porto Campanhã", from_city: "Лиссабон", to_city: "Порту",
    kind: "train", carrier: "Comboios CP", num: "IC 521",
    price: 36, cur: "EUR", platformUrl: "https://cp.pt" },
  { type: "hotel-checkin", id: "h2-in", date: "2026-07-16", time: "18:30", city: "Порту",
    title: "Заезд · Torel Avantgarde", hotelId: "h2", hotel: "Torel Avantgarde", address: "Rua da Restauração 336",
    price: 720, cur: "EUR", nights: 3, platformUrl: "https://booking.com/h/torel", num: "BKN-72932" },

  { type: "activity", id: "a4", date: "2026-07-17", time: "16:00", duration: "2ч", city: "Порту",
    title: "Дегустация в погребе Sandeman", price: 65, cur: "EUR", category: "experience",
    address: "Largo Miguel Bombarda, Vila Nova de Gaia" },

  { type: "transfer-missing", id: "tm1", date: "2026-07-19", time: "?", from: "Порту", to: "Барселона",
    title: "Нет переезда · добавить" },
  { type: "hotel-checkout", id: "h2-out", date: "2026-07-19", time: "11:00", city: "Порту", title: "Выезд · Torel Avantgarde", hotelId: "h2" },

  { type: "hotel-checkin", id: "h3-in", date: "2026-07-19", time: "16:00", city: "Барселона",
    title: "Заезд · Cotton House", hotelId: "h3", hotel: "Cotton House", address: "Gran Via 670",
    price: 1340, cur: "EUR", nights: 4, num: "—" },
  { type: "car-pickup", id: "cp1", date: "2026-07-19", time: "17:30", city: "Барселона", title: "Получение авто · Sixt",
    address: "Барселона аэропорт T1", platformUrl: "https://sixt.com" },

  { type: "activity", id: "a5", date: "2026-07-20", time: "10:25", duration: "1ч 35м", city: "Барселона",
    title: "Sagrada Família", price: 33, cur: "EUR", category: "sight", address: "C/ Mallorca 401" },

  { type: "activity", id: "a6", date: "2026-07-21", city: "Барселона",
    title: "Парк Гуэль", price: 18, cur: "EUR", category: "sight",
    warning: "Не указано время — желательно поставить", address: "C/ Olot, 5" },

  { type: "hotel-checkout", id: "h3-out", date: "2026-07-23", time: "12:00", city: "Барселона", title: "Выезд · Cotton House", hotelId: "h3" },
  { type: "car-return", id: "cr1", date: "2026-07-23", time: "13:00", city: "Барселона", title: "Возврат авто · Sixt",
    address: "Барселона аэропорт T1", platformUrl: "https://sixt.com" },
  { type: "flight", id: "f1", date: "2026-07-23", time: "15:40", duration: "5ч 30м", title: "Lufthansa LH 1731",
    from: "BCN", to: "SVO", from_city: "Барселона", to_city: "Москва",
    kind: "plane", carrier: "Lufthansa", num: "LH 1731", price: 412, cur: "EUR",
    platformUrl: "https://lufthansa.com" }
]

function groupByDate(events) {
  const groups = {}
  for (const e of events) {
    if (!groups[e.date]) groups[e.date] = []
    groups[e.date].push(e)
  }
  return Object.entries(groups).map(([date, items]) => ({ date, items }))
}

const WEEKDAYS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"]
const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]
function fmtDate(iso) {
  const d = new Date(iso + "T00:00:00")
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}
function weekday(iso) {
  return WEEKDAYS[new Date(iso + "T00:00:00").getDay()]
}

// crude time addition to fake arrival time (HH:MM + Xч Yм)
function addDuration(time, dur) {
  if (!time || !dur) return null
  const [h, m] = time.split(":").map(Number)
  const hm = dur.match(/(\d+)ч/)
  const mm = dur.match(/(\d+)м/)
  const dh = hm ? +hm[1] : 0
  const dm = mm ? +mm[1] : 0
  let nh = h + dh, nm = m + dm
  nh += Math.floor(nm / 60); nm %= 60
  nh %= 24
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`
}

const CITY_COLOR = { "Лиссабон": "#2167e2", "Порту": "#1f8a5b", "Барселона": "#c9603a", "Sintra": "#6a3ee2", "в пути": "var(--muted)" }

// Weather forecast per date (mock)
const WEATHER = {
  "2026-07-12": { temp: 26, condition: "sun" },
  "2026-07-13": { temp: 28, condition: "sun" },
  "2026-07-14": { temp: 24, condition: "partly" },
  "2026-07-16": { temp: 23, condition: "partly" },
  "2026-07-17": { temp: 22, condition: "rain" },
  "2026-07-19": { temp: 31, condition: "sun" },
  "2026-07-20": { temp: 32, condition: "sun" },
  "2026-07-21": { temp: 30, condition: "partly" },
  "2026-07-23": { temp: 29, condition: "sun" }
}

// ---------- Context side: budget, members, services ----------
function ContextSide() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <h3 style={{ flex: 1, marginBottom: 0 }}>Бюджет</h3>
          <Btn variant="quiet" size="sm" icon="chev" onClick={() => { window.__triplanioNavigate?.("budget") }} />
        </div>
        <div className="num" style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600 }}>
          {fmt(TRIP.budget.spent, TRIP.budget.currency)} <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}>/ {fmt(TRIP.budget.planned, TRIP.budget.currency)}</span>
        </div>
        <div style={{ height: 6, borderRadius: 3, background: "var(--wash)", overflow: "hidden", marginTop: 10, marginBottom: 10 }}>
          <div style={{ height: "100%", width: `${TRIP.budget.spent / TRIP.budget.planned * 100}%`, background: "var(--brand)" }} />
        </div>
        <div style={{
          padding: "7px 10px", borderRadius: 8,
          background: "var(--warning-soft)", border: "1px solid rgba(201,138,26,.25)",
          display: "flex", alignItems: "center", gap: 8, marginTop: 4
        }}>
          <Icon name="warning" size={12} style={{ color: "var(--warning)" }} />
          <div style={{ flex: 1, fontSize: 11.5, lineHeight: 1.4, color: "var(--ink-2)" }}>
            Курсы TRY не получены — 2 траты вне итога
          </div>
          <button onClick={() => {}} style={{ background: "transparent", border: "none", color: "var(--warning)", fontWeight: 600, fontSize: 11.5, cursor: "pointer" }}>
            Курсы →
          </button>
        </div>
      </Card>
      <Card title="Кто едет" action={<Btn variant="quiet" size="sm" icon="chev" onClick={() => { window.__triplanioNavigate?.("members") }} />}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {TRIP.members.map((m) => (
            <div key={m.name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Avatar name={m.name} size="sm" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 500, display: "flex", alignItems: "center", gap: 4, lineHeight: 1.3 }}>
                  <Icon name={m.role === "owner" ? "crown" : m.role === "admin" ? "shield" : "eye"} size={11}
                    style={{ color: m.role === "owner" ? "var(--warm)" : m.role === "admin" ? "var(--brand)" : "var(--muted)", flexShrink: 0 }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</span>
                </div>
                <div className="muted" style={{ fontSize: 11, marginTop: 1 }}>
                  {m.role === "owner" ? "Владелец" : m.role === "admin" ? "Админ" : "Зритель"}
                  {m.status === "pending" && <span style={{ color: "var(--warning)" }}> · ожидает</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
      <ServicesCard />
    </div>
  )
}

function ServicesCard() {
  const [esimAdded, setEsimAdded] = useState(true)
  const [carAdded, setCarAdded] = useState(true)
  const [moreOpen, setMoreOpen] = useState(false)
  return (
    <Card title="Сервисы">
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {esimAdded
          ? <ServiceRowFilled icon="esim" name="Holafly eSIM" sub="10 ГБ · EU · €35" partner="holafly" />
          : <ServiceRowEmpty icon="esim" name="eSIM" desc="Связь в Европе на 10 дней" onAdd={() => setEsimAdded(true)} />
        }
        {carAdded
          ? <ServiceRowFilled icon="car" name="Sixt прокат" sub="Барселона · 19 → 23 июл · €195" partner="sixt" />
          : <ServiceRowEmpty icon="car" name="Прокат авто" desc="В Барселоне на 4 дня" onAdd={() => setCarAdded(true)} />
        }
        {moreOpen
          ? <ServiceRowEmpty icon="shield" name="Страховка" desc="Не подключена" onAdd={() => {}} />
          : (
            <button onClick={() => setMoreOpen(true)} style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "8px 4px", border: "none", background: "transparent",
              color: "var(--muted)", fontSize: 12, cursor: "pointer", textAlign: "left"
            }}>
              <Icon name="more" size={12} />
              <span>Ещё: страховка и др.</span>
            </button>
          )
        }
      </div>
    </Card>
  )
}

function ServiceRowFilled({ icon, name, sub }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 0" }}>
      <div style={{ width: 28, height: 28, borderRadius: 7, background: "var(--success-soft)", color: "var(--success)", display: "grid", placeItems: "center", flexShrink: 0 }}>
        <Icon name={icon} size={14} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>
          {name}
          <Icon name="check" size={11} style={{ color: "var(--success)" }} />
        </div>
        <div className="muted" style={{ fontSize: 11 }}>{sub}</div>
      </div>
    </div>
  )
}

function ServiceRowEmpty({ icon, name, desc, onAdd }) {
  return (
    <button onClick={onAdd} style={{
      display: "flex", alignItems: "center", gap: 9, padding: "8px 8px",
      background: "transparent", border: "1.5px dashed var(--line)", borderRadius: 8,
      cursor: "pointer", textAlign: "left", color: "var(--ink)"
    }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--brand)"; e.currentTarget.style.background = "var(--brand-soft)" }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--line)"; e.currentTarget.style.background = "transparent" }}>
      <div style={{ width: 28, height: 28, borderRadius: 7, background: "var(--wash)", color: "var(--muted)", display: "grid", placeItems: "center", flexShrink: 0 }}>
        <Icon name={icon} size={14} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500 }}>
          <Icon name="plus" size={11} style={{ verticalAlign: -1, marginRight: 3, color: "var(--brand)" }} />
          Добавить {name}
        </div>
        <div className="muted" style={{ fontSize: 11 }}>{desc}</div>
      </div>
    </button>
  )
}

// ---------- City Hero ----------
function CityHero({ city, country, dateRange, nights, weather, hotels, transitFrom }) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--line)",
      borderRadius: 14, overflow: "hidden", marginBottom: 12
    }}>
      <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 0 }}>
        {/* City photo placeholder */}
        <div style={{ width: 120, height: 120, background: "linear-gradient(135deg, var(--brand-soft) 0%, var(--brand) 100%)", display: "grid", placeItems: "center" }}>
          <Icon name="pin" size={32} style={{ color: "white", opacity: 0.7 }} />
        </div>
        <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
            {transitFrom && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--warm)", fontWeight: 600, background: "var(--warm-tint)", padding: "2px 8px", borderRadius: 999 }}>
                <Icon name="arrowSwap" size={10} /> ПЕРЕЕЗД из {transitFrom}
              </span>
            )}
            <span className="eyebrow" style={{ color: "var(--brand)" }}>
              <Icon name="pin" size={11} style={{ verticalAlign: -1, marginRight: 3 }} /> {country}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <h2 style={{ marginBottom: 0, fontSize: 24 }}>{city}</h2>
            {dateRange && <span className="muted num" style={{ fontSize: 13 }}>{dateRange}</span>}
            {nights && <span className="muted" style={{ fontSize: 13 }}>· {nights} {nights === 1 ? "ночь" : nights < 5 ? "ночи" : "ночей"}</span>}
            {weather && (
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                {weather.temp}°C · {weather.condition === "sun" ? "☀️" : weather.condition === "rain" ? "🌧" : "⛅"}
              </span>
            )}
          </div>
        </div>
      </div>

      <div style={{ padding: "12px 16px", borderTop: "1px solid var(--line-2)", display: "flex", flexDirection: "column", gap: 8 }}>
        {hotels && hotels.length > 0
          ? hotels.map((h, i) => <HotelMiniCard key={i} hotel={h} />)
          : <MissingHotelWarning city={city} />
        }
      </div>
    </div>
  )
}

function HotelMiniCard({ hotel }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: 10, background: "var(--wash)", borderRadius: 10, border: "1px solid var(--line-2)"
    }}>
      <div style={{ width: 36, height: 36, borderRadius: 8, background: "var(--success-soft)", color: "var(--success)", display: "grid", placeItems: "center", flexShrink: 0 }}>
        <Icon name="bed" size={18} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {hotel.name}
          {hotel.platformUrl && <PartnerPill url={hotel.platformUrl} />}
        </div>
        <div className="muted num" style={{ fontSize: 11.5, marginTop: 2 }}>
          Заезд {hotel.in} · Выезд {hotel.out} · {hotel.nights} {hotel.nights === 1 ? "ночь" : "ночи"}
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div className="num" style={{ fontWeight: 600, fontSize: 14 }}>{fmt(hotel.price, hotel.cur)}</div>
      </div>
      {hotel.platformUrl && (
        <Btn variant="ghost" size="sm" icon="external" onClick={() => window.open(hotel.platformUrl, "_blank")}>Бронь</Btn>
      )}
    </div>
  )
}

function MissingHotelWarning({ city }) {
  const [open, setOpen] = useState(true)
  if (!open) return null
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: 10, background: "var(--warning-soft)", borderRadius: 10, border: "1.5px dashed var(--warning)"
    }}>
      <div style={{ width: 36, height: 36, borderRadius: 8, background: "rgba(201,138,26,.2)", color: "var(--warning)", display: "grid", placeItems: "center", flexShrink: 0 }}>
        <Icon name="warning" size={18} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Нет бронирования в {city}</div>
        <div className="muted" style={{ fontSize: 11.5 }}>Добавь отель или место проживания</div>
      </div>
      <Btn variant="primary" size="sm" icon="plus" onClick={() => { window.__triplanioNavigate?.("hotel-form") }}>Добавить</Btn>
      <button onClick={() => setOpen(false)} style={{ width: 22, height: 22, borderRadius: 6, border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer", display: "grid", placeItems: "center" }}>
        <Icon name="close" size={12} />
      </button>
    </div>
  )
}

// ---------- Rail dot ----------
function RailDot({ color, icon, warning, large }) {
  const size = large ? 22 : 16
  return (
    <div style={{
      position: "absolute", left: large ? 4 : 7, top: large ? 14 : 16,
      width: size, height: size, borderRadius: "50%",
      background: warning ? "var(--surface)" : color,
      border: warning ? `2px dashed ${color}` : `2px solid var(--surface)`,
      boxShadow: warning ? "none" : `0 0 0 2px ${color}33`,
      display: "grid", placeItems: "center", color: "white",
      zIndex: 2
    }}>
      {icon && large && <Icon name={icon} size={12} />}
    </div>
  )
}

// ---------- Event row ----------
function StreamEventRow({ e, onClick, editMode }) {
  if (e.type === "transfer-missing") {
    const [hidden, setHidden] = useState(false)
    if (hidden) return null
    return (
      <div style={{ position: "relative", paddingLeft: 36 }}>
        <RailDot color="var(--warning)" warning />
        <div style={{
          width: "100%", display: "flex", alignItems: "center", gap: 12,
          padding: "12px 14px", background: "var(--warning-soft)",
          border: "1.5px dashed var(--warning)", borderRadius: 12,
          textAlign: "left"
        }}>
          <Icon name="warning" size={16} style={{ color: "var(--warning)" }} />
          <div style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>Нет переезда · {e.from} → {e.to}</div>
          <Btn variant="primary" size="sm" icon="plus" onClick={onClick}>Добавить переезд</Btn>
          <button onClick={() => setHidden(true)} title="Скрыть варнинг" style={{
            width: 24, height: 24, borderRadius: 6, border: "none",
            background: "transparent", color: "var(--warning)", cursor: "pointer",
            display: "grid", placeItems: "center",
          }}><Icon name="close" size={12} /></button>
        </div>
      </div>
    )
  }

  if (e.type === "flight" || e.type === "transfer") {
    return (
      <div style={{ position: "relative", paddingLeft: 36 }}>
        <RailDot color="var(--brand)" icon={e.kind === "train" ? "train" : e.kind === "plane" ? "plane" : "car"} large />
        <button onClick={onClick} style={{
          width: "100%", display: "grid", gridTemplateColumns: "1fr auto 1fr auto", gap: 14,
          alignItems: "center",
          padding: "14px 16px", background: "var(--surface)",
          border: "1px solid var(--line)", borderRadius: 12,
          cursor: "pointer", textAlign: "left"
        }}
          onMouseEnter={(ev) => { ev.currentTarget.style.borderColor = "#dbe1ec"; ev.currentTarget.style.transform = "translateY(-1px)"; ev.currentTarget.style.boxShadow = "var(--shadow-soft)" }}
          onMouseLeave={(ev) => { ev.currentTarget.style.borderColor = "var(--line)"; ev.currentTarget.style.transform = ""; ev.currentTarget.style.boxShadow = "" }}>
          <div>
            <div className="num" style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1 }}>{e.time}</div>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 4 }}>{e.from}</div>
            {e.depart_loc && <div className="muted" style={{ fontSize: 11 }}>{e.depart_loc}</div>}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 80 }}>
            <Icon name={e.kind === "train" ? "train" : e.kind === "plane" ? "plane" : "car"} size={16} style={{ color: "var(--brand)" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 4, width: "100%" }}>
              <div style={{ height: 1, flex: 1, borderTop: "1.5px dashed var(--brand)" }} />
              <span className="muted num" style={{ fontSize: 10.5, whiteSpace: "nowrap" }}>{e.duration}</span>
              <div style={{ height: 1, flex: 1, borderTop: "1.5px dashed var(--brand)" }} />
            </div>
            <div className="muted" style={{ fontSize: 10.5 }}>{e.carrier} · <span className="num">{e.num}</span></div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="num" style={{ fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1 }}>
              {e.arrive_time || addDuration(e.time, e.duration) || "—"}
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 4 }}>{e.to}</div>
            {e.arrive_loc && <div className="muted" style={{ fontSize: 11 }}>{e.arrive_loc}</div>}
          </div>
          <div style={{ textAlign: "right", borderLeft: "1px solid var(--line-2)", paddingLeft: 14, minWidth: 80 }}>
            <div className="num" style={{ fontWeight: 600, fontSize: 15 }}>{fmt(e.price, e.cur)}</div>
            {e.platformUrl && <div style={{ marginTop: 4 }}><PartnerPill url={e.platformUrl} /></div>}
          </div>
        </button>
      </div>
    )
  }

  const META = {
    "hotel-checkin": { icon: "bed", c: "var(--success)", bg: "var(--success-soft)", label: "Заезд" },
    "hotel-checkout": { icon: "bed", c: "var(--success)", bg: "var(--success-soft)", label: "Выезд" },
    "hotel-deadline": { icon: "warning", c: "var(--warning)", bg: "var(--warning-soft)", label: "Дедлайн" },
    "activity": {
      icon: e.category === "food" ? "cup" : e.category === "sight" ? "cam" : "spark",
      c: e.category === "food" ? "var(--warm)" : e.category === "experience" ? "var(--ai)" : "var(--success)",
      bg: e.category === "food" ? "var(--warm-tint)" : e.category === "experience" ? "var(--ai-soft)" : "var(--success-soft)"
    },
    "car-pickup": { icon: "car", c: "var(--brand)", bg: "var(--brand-soft)" },
    "car-return": { icon: "car", c: "var(--brand)", bg: "var(--brand-soft)" }
  }
  const meta = META[e.type] || { icon: "spark", c: "var(--ink)", bg: "var(--wash)" }
  const isCheckin = e.type === "hotel-checkin" || e.type === "hotel-checkout"

  return (
    <div style={{ position: "relative", paddingLeft: 36 }}>
      <RailDot color={meta.c} icon={meta.icon} />
      <button onClick={onClick} style={{
        width: "100%", display: "flex", alignItems: "center", gap: 14,
        padding: "12px 14px", background: "var(--surface)",
        border: "1px solid var(--line)", borderRadius: 12,
        cursor: "pointer", textAlign: "left"
      }}
        onMouseEnter={(ev) => { ev.currentTarget.style.borderColor = "#dbe1ec"; ev.currentTarget.style.transform = "translateY(-1px)"; ev.currentTarget.style.boxShadow = "var(--shadow-soft)" }}
        onMouseLeave={(ev) => { ev.currentTarget.style.borderColor = "var(--line)"; ev.currentTarget.style.transform = ""; ev.currentTarget.style.boxShadow = "" }}>
        <div className="num" style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em", minWidth: 52, color: e.time === "?" ? "var(--warning)" : "var(--ink)" }}>
          {e.time || "—"}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>{e.title}</span>
            {e.warning && <Badge variant="warning" icon="warning">Нет времени</Badge>}
            {isCheckin && <Badge variant="success">{meta.label}</Badge>}
          </div>
          <div className="muted" style={{ fontSize: 12, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            {e.duration && <span className="num">{e.duration}</span>}
            {e.address && <span>· {e.address}</span>}
            {e.platformUrl && <PartnerPill url={e.platformUrl} />}
          </div>
        </div>
        {e.price && <span className="num" style={{ fontWeight: 600, fontSize: 14 }}>{fmt(e.price, e.cur)}</span>}
      </button>
    </div>
  )
}

// ---------- Day separator ----------
function DaySeparator({ date, weatherOn }) {
  const today = "2026-07-13"
  const isToday = date === today
  const w = WEATHER[date]
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "20px 0 10px", paddingLeft: 36, position: "relative" }}>
      <div style={{
        position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)",
        width: 8, height: 8, borderRadius: "50%", background: "var(--muted-2)"
      }} />
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span className="num" style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 22, letterSpacing: "-0.02em", color: isToday ? "var(--brand)" : "var(--ink)" }}>
          {fmtDate(date)}
        </span>
        <span className="muted" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em", fontWeight: 600 }}>{weekday(date)}</span>
        {isToday && <Badge dot>Сегодня</Badge>}
      </div>
      {weatherOn && w && (
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {w.temp}°C · {w.condition === "sun" ? "☀️" : w.condition === "rain" ? "🌧" : "⛅"}
        </span>
      )}
      <div style={{ flex: 1, borderBottom: "1px solid var(--line-2)" }} />
    </div>
  )
}

// ---------- Inline add menu ----------
function InlineAddMenu({ onAddCity, onAddHotel, onAddActivity, onAddTransfer }) {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{
        marginLeft: 36, marginTop: 6, marginBottom: 6,
        padding: "6px 12px", background: "transparent", border: "1.5px dashed var(--line)",
        borderRadius: 8, color: "var(--muted)", fontSize: 12, fontWeight: 500, cursor: "pointer",
        display: "inline-flex", alignItems: "center", gap: 6
      }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--brand)"; e.currentTarget.style.color = "var(--brand)" }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--line)"; e.currentTarget.style.color = "var(--muted)" }}>
        <Icon name="plus" size={12} /> Добавить
      </button>
    )
  }
  return (
    <div style={{ marginLeft: 36, marginTop: 6, marginBottom: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
      <Btn variant="ghost" size="sm" icon="pin" onClick={() => { onAddCity?.(); setOpen(false) }}>Город</Btn>
      <Btn variant="ghost" size="sm" icon="bed" onClick={() => { onAddHotel?.(); setOpen(false) }}>Отель</Btn>
      <Btn variant="ghost" size="sm" icon="spark" onClick={() => { onAddActivity?.(); setOpen(false) }}>Активность</Btn>
      <Btn variant="ghost" size="sm" icon="arrowSwap" onClick={() => { onAddTransfer?.(); setOpen(false) }}>Переезд</Btn>
      <Btn variant="ai" size="sm" icon="sparkles" onClick={() => { window.__triplanioNavigate?.("ai") }}>Спросить ИИ</Btn>
      <Btn variant="quiet" size="sm" icon="close" onClick={() => setOpen(false)} />
    </div>
  )
}

// ---------- Stream anchor ----------
function StreamAnchor({ label, sub, color, icon }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, margin: "16px 0", paddingLeft: 8 }}>
      <div style={{ width: 28, height: 28, borderRadius: "50%", background: color, color: "white", display: "grid", placeItems: "center", flexShrink: 0 }}>
        <Icon name={icon} size={13} />
      </div>
      <div>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{label}</div>
        <div className="muted" style={{ fontSize: 12 }}>{sub}</div>
      </div>
    </div>
  )
}

// ---------- Empty day state ----------
function EmptyDay({ editMode }) {
  return (
    <div style={{ paddingLeft: 36, marginBottom: 6 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 14px",
        background: "transparent", border: "1.5px dashed var(--line)",
        borderRadius: 10, color: "var(--muted)",
      }}>
        <Icon name="info" size={14} />
        <div style={{ flex: 1, fontSize: 12.5 }}>На этот день ничего не запланировано</div>
        {editMode && (
          <>
            <Btn variant="ghost" size="sm" icon="plus" onClick={() => { window.__triplanioNavigate?.("activity-form") }}>Активность</Btn>
            <Btn variant="ai" size="sm" icon="sparkles" onClick={() => { window.__triplanioNavigate?.("ai") }}>Спросить ИИ</Btn>
          </>
        )}
      </div>
    </div>
  )
}

// ---------- Empty trip state ----------
function EmptyTripState() {
  return (
    <div style={{
      padding: "40px 28px", textAlign: "center",
      background: "linear-gradient(180deg, var(--brand-soft) 0%, transparent 80%)",
      border: "1.5px dashed var(--brand-soft-12)",
      borderRadius: 18,
    }}>
      <div style={{
        width: 72, height: 72, margin: "0 auto 18px", borderRadius: 18,
        background: "var(--brand)", color: "white",
        display: "grid", placeItems: "center",
      }}>
        <Icon name="globe" size={32} />
      </div>
      <h2 style={{ marginBottom: 8 }}>Новый трип готов к планированию</h2>
      <div className="muted" style={{ fontSize: 14, lineHeight: 1.6, maxWidth: 460, margin: "0 auto 22px" }}>
        Добавь первый город — а дальше Triplanio предложит, что заполнить:
        переезды, отели, активности, бюджет. Или попроси ИИ собрать черновик.
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginBottom: 18 }}>
        <Btn variant="primary" icon="plus">Добавить первый город</Btn>
        <Btn variant="ai" icon="sparkles" onClick={() => { window.__triplanioNavigate?.("ai-planner") }}>Начать с ИИ</Btn>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, maxWidth: 560, margin: "20px auto 0" }}>
        {[
          { icon: "pin", label: "Города" },
          { icon: "plane", label: "Переезды" },
          { icon: "bed", label: "Отели" },
          { icon: "spark", label: "Активности" },
        ].map((s) => (
          <div key={s.label} style={{
            padding: "10px 12px", background: "var(--surface)",
            border: "1px solid var(--line-2)", borderRadius: 10,
            display: "flex", alignItems: "center", gap: 8,
            opacity: 0.7,
          }}>
            <Icon name={s.icon} size={14} style={{ color: "var(--muted-2)" }} />
            <span style={{ flex: 1, textAlign: "left", fontSize: 12, color: "var(--muted)" }}>{s.label}</span>
            <Badge variant="quiet">0</Badge>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------- Timeline with heroes ----------
function TimelineWithHeroes({ groups, cityVisits, weatherOn, openEvent, editMode }) {
  const seenCities = new Set()

  const filledGroups = []
  if (groups.length > 0) {
    const dateToGroup = Object.fromEntries(groups.map((g) => [g.date, g]))
    const start = new Date(groups[0].date + "T00:00:00")
    const end = new Date(groups[groups.length - 1].date + "T00:00:00")
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const iso = d.toISOString().slice(0, 10)
      filledGroups.push(dateToGroup[iso] || { date: iso, items: [], empty: true })
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <div style={{ position: "absolute", left: 11, top: 30, bottom: 30, width: 2, background: "var(--line)", zIndex: 1 }} />

      {filledGroups.map((g, gi) => {
        const dayCities = [...new Set(g.items.filter((it) => it.city && it.city !== "в пути" && it.city !== "Sintra").map((it) => it.city))]
        const newCity = dayCities.find((c) => !seenCities.has(c))
        const isTransitDay = dayCities.length > 1
        const transitFrom = isTransitDay ? dayCities.find((c) => seenCities.has(c)) : null

        if (newCity) seenCities.add(newCity)

        return (
          <div key={gi}>
            <DaySeparator date={g.date} weatherOn={weatherOn} />
            {newCity && cityVisits[newCity] && (
              <div style={{ paddingLeft: 36 }}>
                <CityHero city={newCity} country={cityVisits[newCity].country} dateRange={cityVisits[newCity].dateRange}
                  nights={cityVisits[newCity].nights} weather={cityVisits[newCity].weather} hotels={cityVisits[newCity].hotels}
                  transitFrom={transitFrom} />
              </div>
            )}
            {g.empty ? (
              <EmptyDay editMode={editMode} />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {g.items.map((e) => <StreamEventRow key={e.id} e={e} onClick={() => openEvent(e)} editMode={editMode} />)}
              </div>
            )}
            {editMode && (
              <InlineAddMenu
                onAddHotel={() => { window.__triplanioNavigate?.("hotel-form") }}
                onAddActivity={() => { window.__triplanioNavigate?.("activity-form") }}
                onAddTransfer={() => { window.__triplanioNavigate?.("transfer-form") }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

// =====================================================================
// VARIANT A — Stream
// =====================================================================
function VariantStream() {
  const groups = groupByDate(STREAM)
  const editMode = false
  const [weatherOn, setWeatherOn] = useState(true)
  const openEvent = () => {}

  const cityVisits = {
    "Лиссабон": { country: "Португалия", dateRange: "12 → 16 июл", nights: 4, weather: { temp: 26, condition: "sun" },
      hotels: [{ name: "Memmo Alfama", in: "12 июл 15:00", out: "16 июл 11:00", nights: 4, price: 880, cur: "EUR", platformUrl: "https://booking.com/memmo" }] },
    "Порту": { country: "Португалия", dateRange: "16 → 19 июл", nights: 3, weather: { temp: 22, condition: "rain" },
      hotels: [{ name: "Torel Avantgarde", in: "16 июл 18:30", out: "19 июл 11:00", nights: 3, price: 720, cur: "EUR", platformUrl: "https://booking.com/torel" }] },
    "Барселона": { country: "Испания", dateRange: "19 → 23 июл", nights: 4, weather: { temp: 31, condition: "sun" },
      hotels: [] }
  }

  return (
    <div className="trip-2col" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px", gap: 28 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ marginBottom: 18 }}>
          <Severity level="warning" title="В трипе 2 предупреждения">
            Нет переезда Порту → Барселона (19 июля). Одна активность 21 июля без времени.
          </Severity>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
          <div style={{ flex: 1 }} />
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--muted)", cursor: "pointer" }}>
            <input type="checkbox" checked={weatherOn} onChange={() => setWeatherOn(!weatherOn)} />
            <Icon name="sun" size={13} /> Погода
          </label>
        </div>

        <StreamAnchor label="Старт · Москва" sub="Якорь без точной даты" color="var(--brand)" icon="flag" />
        <TimelineWithHeroes groups={groups} cityVisits={cityVisits} weatherOn={weatherOn} openEvent={openEvent} editMode={editMode} />
        <StreamAnchor label="Финиш · Москва" sub="23 июля, после возврата" color="var(--ink-2)" icon="check" />
      </div>

      <aside style={{ position: "sticky", top: 80, alignSelf: "start" }}>
        <ContextSide />
      </aside>
    </div>
  )
}

// =====================================================================
// VARIANT B — Day cards
// =====================================================================
function VariantDayCards() {
  const groups = groupByDate(STREAM)
  const openEvent = () => {}
  return (
    <div className="trip-2col" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px", gap: 28 }}>
      <div style={{ minWidth: 0 }}>
        <Severity level="warning" title="В трипе 2 предупреждения">
          Нет переезда Порту → Барселона. Одна активность без времени.
        </Severity>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12, marginTop: 16 }}>
          {groups.map((g, i) => {
            const cityHere = (g.items.find((it) => it.city) || {}).city
            const w = WEATHER[g.date]
            return (
              <div key={i} style={{
                background: "var(--surface)", border: "1px solid var(--line)",
                borderRadius: 12, padding: 14,
                display: "flex", flexDirection: "column", gap: 8, minHeight: 180
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                  <span className="num" style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 22, letterSpacing: "-0.02em" }}>{fmtDate(g.date).split(" ")[0]}</span>
                  <span className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" }}>{weekday(g.date)} · {fmtDate(g.date).split(" ")[1]}</span>
                  <div style={{ flex: 1 }} />
                  {w && <span style={{ fontSize: 11, color: "var(--muted)" }}>{w.temp}°</span>}
                </div>
                {cityHere && (
                  <div style={{ fontSize: 12, color: "var(--brand)", display: "flex", alignItems: "center", gap: 4, fontWeight: 500 }}>
                    <Icon name="pin" size={11} /> {cityHere}
                  </div>
                )}
                <div style={{ height: 1, background: "var(--line-2)", margin: "2px -14px" }} />
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {g.items.map((it) => (
                    <button key={it.id} onClick={() => openEvent(it)} style={{
                      display: "flex", alignItems: "flex-start", gap: 6, fontSize: 11.5,
                      color: "var(--ink)", border: "none", background: "transparent",
                      padding: "3px 0", cursor: "pointer", textAlign: "left"
                    }}>
                      <span className="num muted" style={{ minWidth: 30 }}>{it.time && it.time !== "?" ? it.time : "—"}</span>
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <aside style={{ position: "sticky", top: 80, alignSelf: "start" }}>
        <ContextSide />
      </aside>
    </div>
  )
}

// =====================================================================
// VARIANT C — City rail
// =====================================================================
function VariantCityRail() {
  const cities = [...new Set(STREAM.filter((e) => e.city && e.city !== "в пути" && e.city !== "Sintra").map((e) => e.city))]
  const [activeCity, setActiveCity] = useState(cities[0])
  const cityEvents = STREAM.filter((e) => e.city === activeCity)
  const groups = groupByDate(cityEvents)
  const openEvent = () => {}

  const cityMeta = {
    "Лиссабон": { country: "Португалия", dateRange: "12 → 16 июл", nights: 4, weather: { temp: 26, condition: "sun" },
      hotels: [{ name: "Memmo Alfama", in: "12 июл 15:00", out: "16 июл 11:00", nights: 4, price: 880, cur: "EUR", platformUrl: "https://booking.com/memmo" }] },
    "Порту": { country: "Португалия", dateRange: "16 → 19 июл", nights: 3, weather: { temp: 22, condition: "rain" },
      hotels: [{ name: "Torel Avantgarde", in: "16 июл 18:30", out: "19 июл 11:00", nights: 3, price: 720, cur: "EUR", platformUrl: "https://booking.com/torel" }] },
    "Барселона": { country: "Испания", dateRange: "19 → 23 июл", nights: 4, weather: { temp: 31, condition: "sun" },
      hotels: [{ name: "Cotton House", in: "19 июл 16:00", out: "23 июл 12:00", nights: 4, price: 1340, cur: "EUR" }] }
  }

  return (
    <div className="trip-3col" style={{ display: "grid", gridTemplateColumns: "200px minmax(0, 1fr) 280px", gap: 22 }}>
      <div style={{ position: "sticky", top: 80, alignSelf: "start" }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Маршрут</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, position: "relative" }}>
          <div style={{ position: "absolute", left: 12, top: 16, bottom: 16, width: 2, background: "var(--line)" }} />
          {cities.map((c) => {
            const ev = STREAM.filter((e) => e.city === c)
            const dates = [...new Set(ev.map((e) => e.date))]
            return (
              <button key={c} onClick={() => setActiveCity(c)} style={{
                padding: "8px 10px 8px 32px",
                borderRadius: 9, border: "none", textAlign: "left", cursor: "pointer",
                background: activeCity === c ? "var(--brand-soft)" : "transparent",
                color: activeCity === c ? "var(--brand)" : "var(--ink-2)",
                position: "relative"
              }}>
                <span style={{
                  position: "absolute", left: 5, top: "50%", transform: "translateY(-50%)",
                  width: 16, height: 16, borderRadius: "50%",
                  background: activeCity === c ? "var(--brand)" : "var(--surface)",
                  border: "2px solid " + (activeCity === c ? "var(--brand)" : "var(--line)")
                }} />
                <div style={{ fontWeight: 600, fontSize: 13 }}>{c}</div>
                <div className="muted num" style={{ fontSize: 11 }}>{dates.length} дн · {ev.length} событий</div>
              </button>
            )
          })}
        </div>
      </div>

      <div>
        {cityMeta[activeCity] && (
          <CityHero city={activeCity} country={cityMeta[activeCity].country} dateRange={cityMeta[activeCity].dateRange}
            nights={cityMeta[activeCity].nights} weather={cityMeta[activeCity].weather} hotels={cityMeta[activeCity].hotels} />
        )}
        {groups.map((g, gi) => (
          <div key={gi} style={{ marginBottom: 14 }}>
            <DaySeparator date={g.date} weatherOn={true} />
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {g.items.map((it) => <StreamEventRow key={it.id} e={it} onClick={() => openEvent(it)} />)}
            </div>
          </div>
        ))}
      </div>

      <aside style={{ position: "sticky", top: 80, alignSelf: "start" }}>
        <ContextSide />
      </aside>
    </div>
  )
}

// ---------- Main component ----------
function ScreenTimeline() {
  const [variant, setVariant] = useState("A")
  const [, force] = useState(0)

  useEffect(() => {
    const fn = () => force((x) => x + 1)
    window.addEventListener("__tweak", fn)
    return () => window.removeEventListener("__tweak", fn)
  }, [])

  return (
    <>
      <div style={{ marginBottom: 22, paddingBottom: 16, borderBottom: "1px solid var(--line-2)", display: "flex", alignItems: "center", gap: 10 }}>
        <h2 style={{ flex: 1 }}>{TRIP.title}</h2>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>12 июл → 23 июл · 2026</span>
      </div>

      {/* Variant switcher */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
        {[["A", "Поток"], ["B", "Дни"], ["C", "Города"]].map(([v, label]) => (
          <button key={v} onClick={() => setVariant(v)} style={{
            padding: "6px 14px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500,
            background: variant === v ? "var(--brand)" : "var(--wash)",
            color: variant === v ? "white" : "var(--ink-2)",
          }}>{label}</button>
        ))}
      </div>

      {variant === "A" && <VariantStream />}
      {variant === "B" && <VariantDayCards />}
      {variant === "C" && <VariantCityRail />}
    </>
  )
}

export default ScreenTimeline
