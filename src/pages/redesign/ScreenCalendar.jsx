import React, { useState } from 'react';
import { Icon } from '../../design/icons';
import { Btn, TRIP } from '../../design/index';

// =====================================================================
// TRIP CALENDAR — calendar lens (§15) — month + week views
// =====================================================================

const EVENTS = {
  12: [{ t: "Заезд Memmo Alfama", c: "var(--success)", time: "15:00" }],
  13: [{ t: "Pastéis de Belém", c: "var(--warm)", time: "10:00" }, { t: "Castelo São Jorge", c: "var(--success)", time: "14:00" }],
  14: [{ t: "Винный тур Sintra", c: "var(--ai)", time: "10:00" }],
  16: [{ t: "Поезд в Порту", c: "var(--brand)", time: "14:25" }, { t: "Заезд Torel", c: "var(--success)", time: "18:30" }],
  17: [{ t: "Sandeman дегустация", c: "var(--ai)", time: "16:00" }],
  19: [{ t: "⚠ Нет переезда", c: "var(--warning)", time: "" }, { t: "Заезд Cotton House", c: "var(--success)", time: "16:00" }],
  20: [{ t: "Sagrada Família", c: "var(--success)", time: "10:25" }],
  21: [{ t: "Парк Гуэль ⚠", c: "var(--warning)", time: "" }],
  23: [{ t: "Выезд Cotton House", c: "var(--success)", time: "12:00" }],
};
const SPANS = [
  { from: 12, to: 16, label: "Лиссабон", c: "var(--brand)" },
  { from: 16, to: 19, label: "Порту", c: "var(--brand)" },
  { from: 19, to: 23, label: "Барселона", c: "var(--brand)" },
];

// Week view — Jul 12 → Jul 18 (week 1 of trip)
const WEEK_EVENTS = [
  { day: 0, date: 12, start: 15, end: 16, t: "Заезд Memmo Alfama", c: "var(--success)" },
  { day: 1, date: 13, start: 10, end: 11, t: "Pastéis de Belém", c: "var(--warm)" },
  { day: 1, date: 13, start: 14, end: 16.5, t: "Castelo São Jorge", c: "var(--success)" },
  { day: 2, date: 14, start: 10, end: 18, t: "Винный тур Sintra", c: "var(--ai)" },
  { day: 4, date: 16, start: 13, end: 14, t: "Обед перед поездом", c: "var(--warm)" },
  { day: 4, date: 16, start: 14.4, end: 17.7, t: "Поезд CP IC 521", c: "var(--brand)" },
  { day: 4, date: 16, start: 18.5, end: 19.5, t: "Заезд Torel", c: "var(--success)" },
  { day: 5, date: 17, start: 16, end: 18, t: "Sandeman дегустация", c: "var(--ai)" },
];

function ScreenCalendar() {
  const [view, setView] = useState("month");
  const WD = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  const startOffset = 2;
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= 31; d++) cells.push(d);

  return (
    <>
      <div style={{marginBottom: 22, paddingBottom: 16, borderBottom: "1px solid var(--line-2)", display:"flex", alignItems:"center", gap:10}}>
        <h2 style={{flex:1}}>{TRIP.title}</h2>
        <span style={{fontSize:12, color:"var(--muted)"}}>12 июл → 23 июл · 2026</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <h2 style={{ flex: 1 }}>Июль 2026{view === "week" && <span className="muted" style={{ fontSize: 16, fontWeight: 400, marginLeft: 12 }}>· неделя 12 — 18</span>}</h2>
        <Btn variant="ghost" size="sm" icon="back" />
        <Btn variant="ghost" size="sm">Сегодня</Btn>
        <Btn variant="ghost" size="sm">К старту трипа</Btn>
        <Btn variant="ghost" size="sm" icon="chev" />
        <div className="tweaks__seg" style={{ marginLeft: 6 }}>
          <button className={view === "month" ? "active" : ""} onClick={() => setView("month")}>Месяц</button>
          <button className={view === "week" ? "active" : ""} onClick={() => setView("week")}>Неделя</button>
        </div>
      </div>

      {view === "month" ? <MonthView cells={cells} WD={WD} /> : <WeekView />}

      <div style={{ marginTop: 16, fontSize: 12, color: "var(--muted)", display: "flex", gap: 14, flexWrap: "wrap" }}>
        <Legend color="var(--brand)">Город (полоса)</Legend>
        <Legend color="var(--success)">Проживание</Legend>
        <Legend color="var(--warm)">Еда</Legend>
        <Legend color="var(--ai)">Активности</Legend>
        <Legend color="var(--warning)">Внимание</Legend>
      </div>
    </>
  );
}

function Legend({ color, children }) {
  return (
    <span><span style={{ display: "inline-block", width: 10, height: 10, background: color, borderRadius: 2, marginRight: 6, verticalAlign: -1 }} />{children}</span>
  );
}

function MonthView({ cells, WD }) {
  const openEvent = () => {};
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: "1px solid var(--line)" }}>
        {WD.map(w => (
          <div key={w} style={{ padding: "10px 12px", fontSize: 11.5, color: "var(--muted-2)", letterSpacing: ".08em", textTransform: "uppercase", fontWeight: 600, borderRight: "1px solid var(--line-2)" }}>{w}</div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gridAutoRows: "112px" }}>
        {cells.map((d, i) => {
          const inTrip = d >= 12 && d <= 23;
          const ev = (EVENTS[d] || []);
          const spans = SPANS.filter(s => s.from === d);
          return (
            <div key={i} style={{
              borderRight: "1px solid var(--line-2)",
              borderBottom: "1px solid var(--line-2)",
              padding: "8px 8px 6px",
              position: "relative",
              background: inTrip ? "var(--brand-soft)" : "var(--surface)",
              opacity: d ? 1 : 0.35,
              cursor: ev.length ? "pointer" : "default",
            }} onClick={() => d && ev.length && openEvent(d)}>
              {d && (
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 13.5, color: inTrip ? "var(--brand)" : "var(--ink-2)" }}>{d}</div>
              )}
              {spans.map((s, si) => (
                <div key={si} style={{
                  position: "absolute", left: 4, top: 28,
                  padding: "2px 6px", fontSize: 10.5, fontWeight: 500,
                  background: s.c, color: "white",
                  borderRadius: 4,
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  width: `calc(${(s.to - s.from) * 100}% + ${(s.to - s.from - 1) * 1}px - 8px)`,
                  zIndex: 2,
                }}>{s.label}</div>
              ))}
              <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 50, position: "relative", zIndex: 3 }}>
                {ev.map((e, ei) => (
                  <div key={ei} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5 }}>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: e.c, flexShrink: 0 }} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} className="num">
                      {e.time && <span className="muted">{e.time} </span>}{e.t}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekView() {
  const DAYS = [
    { wd: "Пн", date: 12, city: "Лиссабон" },
    { wd: "Вт", date: 13, city: "Лиссабон" },
    { wd: "Ср", date: 14, city: "Лиссабон" },
    { wd: "Чт", date: 15, city: "Лиссабон" },
    { wd: "Пт", date: 16, city: "Лиссабон → Порту" },
    { wd: "Сб", date: 17, city: "Порту" },
    { wd: "Вс", date: 18, city: "Порту" },
  ];
  const HOURS = []; for (let h = 8; h <= 22; h++) HOURS.push(h);
  const HOUR_HEIGHT = 36;

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, overflow: "hidden" }}>
      {/* Header row with day names */}
      <div style={{ display: "grid", gridTemplateColumns: "56px repeat(7, 1fr)", borderBottom: "1px solid var(--line)" }}>
        <div style={{ borderRight: "1px solid var(--line-2)" }} />
        {DAYS.map((d, i) => (
          <div key={i} style={{ padding: "10px 8px", borderRight: i < 6 ? "1px solid var(--line-2)" : "none", textAlign: "center" }}>
            <div className="num" style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 19, letterSpacing: "-0.02em" }}>{d.date}</div>
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", marginTop: 2 }}>{d.wd}</div>
            <div className="muted" style={{ fontSize: 11, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.city}</div>
          </div>
        ))}
      </div>
      {/* Hour grid + events */}
      <div style={{ display: "grid", gridTemplateColumns: "56px repeat(7, 1fr)", position: "relative" }}>
        {/* Hours column */}
        <div style={{ borderRight: "1px solid var(--line-2)" }}>
          {HOURS.map(h => (
            <div key={h} style={{ height: HOUR_HEIGHT, fontSize: 10.5, color: "var(--muted-2)", padding: "2px 6px", textAlign: "right" }} className="num">{String(h).padStart(2, "0")}:00</div>
          ))}
        </div>
        {/* 7 day columns */}
        {DAYS.map((d, di) => (
          <div key={di} style={{
            position: "relative",
            borderRight: di < 6 ? "1px solid var(--line-2)" : "none",
            backgroundImage: `repeating-linear-gradient(to bottom, transparent, transparent ${HOUR_HEIGHT - 1}px, var(--line-2) ${HOUR_HEIGHT - 1}px, var(--line-2) ${HOUR_HEIGHT}px)`,
            minHeight: HOURS.length * HOUR_HEIGHT,
          }}>
            {WEEK_EVENTS.filter(e => e.day === di).map((e, ei) => {
              const top = (e.start - HOURS[0]) * HOUR_HEIGHT;
              const h = (e.end - e.start) * HOUR_HEIGHT;
              return (
                <div key={ei} style={{
                  position: "absolute", left: 4, right: 4,
                  top, height: Math.max(h, 22),
                  background: e.c, color: "white",
                  borderRadius: 5, padding: "3px 6px",
                  fontSize: 11, fontWeight: 500,
                  overflow: "hidden", lineHeight: 1.3,
                  cursor: "pointer",
                }}>
                  <div className="num" style={{ fontSize: 10, opacity: 0.85 }}>{Math.floor(e.start)}:{String(Math.round((e.start % 1) * 60)).padStart(2, "0")}</div>
                  <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.t}</div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export default ScreenCalendar;
