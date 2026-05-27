import React, { useState, useEffect, useRef } from 'react';
import { Icon } from '../../design/icons';
import { Avatar, AvatarStack, Badge, Btn, Card, Field, EmptyState, Skeleton, Toggle,
         fmt, TRIP, TRIPS, ModalHost, Dialog, PartnerLogo, PartnerPill, CityPhoto,
         WeatherChip, RoleBadge, DismissibleSeverity, BookingSuggestionCard,
         TripIdentityStrip } from '../../design/index';

// =====================================================================
// TRIP MAP — geographic lens (§14) — full-bleed map + scrollable sidebar
// =====================================================================

const ROUTE_3 = [
{ name: "Лиссабон", country: "🇵🇹 Португалия", x: 22, y: 56, nights: 4, hotel: "Memmo Alfama",
  activities: [
  { name: "Трамвай 28 — петля по Альфаме", time: "13 июл · 10:00" },
  { name: "Pastéis de Belém — pastry crawl", time: "13 июл · 15:30" },
  { name: "Закат на Miradouro da Senhora do Monte", time: "14 июл · 20:45" },
  { name: "Фаду в Tasca do Chico", time: "15 июл · 22:00" }] },
{ name: "Порту", country: "🇵🇹 Португалия", x: 21, y: 49, nights: 3, hotel: "Torel Avantgarde",
  activities: [
  { name: "Livraria Lello — визит по тикету", time: "17 июл · 11:30" },
  { name: "Дегустация портвейна в Taylor’s", time: "18 июл · 16:00" },
  { name: "Прогулка по мосту Луиша I", time: "18 июл · 19:30" }] },
{ name: "Барселона", country: "🇪🇸 Испания", x: 35, y: 47, nights: 4, hotel: "Cotton House",
  activities: [
  { name: "Sagrada Família — забронированный визит", time: "20 июл · 10:30" },
  { name: "Park Güell — утренний слот", time: "21 июл · 09:00" },
  { name: "Ужин в Disfrutar", time: "22 июл · 20:30" }] }];

// Long-route variant — 9 cities — to test layout for ambitious itineraries
const ROUTE_9 = [
{ name: "Лиссабон", country: "🇵🇹 Португалия", x: 16, y: 56, nights: 3, hotel: "Memmo Alfama", activities: [
  { name: "Трамвай 28", time: "10 июл · 10:00" }, { name: "Pastéis de Belém", time: "10 июл · 16:00" }] },
{ name: "Порту", country: "🇵🇹 Португалия", x: 15, y: 49, nights: 2, hotel: "Torel Avantgarde", activities: [
  { name: "Livraria Lello", time: "13 июл · 11:30" }] },
{ name: "Мадрид", country: "🇪🇸 Испания", x: 23, y: 51, nights: 2, hotel: "Hotel Único", activities: [
  { name: "Прадо", time: "15 июл · 10:00" }] },
{ name: "Барселона", country: "🇪🇸 Испания", x: 33, y: 48, nights: 3, hotel: "Cotton House", activities: [
  { name: "Sagrada Família", time: "17 июл · 10:30" }, { name: "Park Güell", time: "18 июл · 09:00" }] },
{ name: "Марсель", country: "🇫🇷 Франция", x: 41, y: 47, nights: 2, hotel: "Intercontinental", activities: [
  { name: "Vieux-Port", time: "21 июл · 17:00" }] },
{ name: "Ницца", country: "🇫🇷 Франция", x: 46, y: 46, nights: 2, hotel: "Hôtel La Pérouse", activities: [
  { name: "Promenade des Anglais", time: "23 июл · 18:00" }] },
{ name: "Милан", country: "🇮🇹 Италия", x: 50, y: 41, nights: 2, hotel: "Park Hyatt", activities: [
  { name: "Galleria Vittorio", time: "26 июл · 18:30" }] },
{ name: "Венеция", country: "🇮🇹 Италия", x: 54, y: 41, nights: 2, hotel: "Aman Venice", activities: [
  { name: "Piazza San Marco", time: "28 июл · 09:00" }] },
{ name: "Рим", country: "🇮🇹 Италия", x: 53, y: 49, nights: 3, hotel: "Hotel de Russie", activities: [
  { name: "Колизей", time: "30 июл · 10:00" }, { name: "Ватикан", time: "31 июл · 09:30" }] }];

const SEGMENTS = [
{ from: "Лиссабон", to: "Порту", kind: "train", carrier: "CP IC 521", date: "16 июл 14:25" },
{ from: "Порту", to: "Барселона", kind: "missing", warning: true }];


function ScreenMap() {
  const [theme, setTheme] = useState("auto");
  const [anchorsOff, setAnchorsOff] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [routeLen, setRouteLen] = useState("3");
  const [route, setRoute] = useState(ROUTE_3);
  const [transferVariant, setTransferVariant] = useState("V1"); // 3 universal card styles
  const [cardCase, setCardCase] = useState("both"); // hotel-only | transfer-only | both | both-warn

  React.useEffect(() => {
    const next = routeLen === "9" ? ROUTE_9 : ROUTE_3;
    setRoute(next);
    if (activeIdx >= next.length) setActiveIdx(0);
  }, [routeLen]);

  const isDark = theme === "auto" && document.documentElement.dataset.theme === "dark" || theme === "dark";
  const active = route[activeIdx];

  const addCity = () => {
    window.__openModal?.(<AddCityDialog onAdded={(c) => setRoute((r) => [...r, c])} />);
  };

  return (
    // Negative margin to break out of .app-main padding — true full-bleed map
    <div style={{
      margin: "-22px -24px -80px",
      height: "calc(100vh - 56px)",
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr) 360px",
      background: "var(--surface)"
    }} className="trip-map-shell">

      {/* MAP — full-bleed, fixed */}
      <div style={{
        position: "relative",
        background: isDark ? "#0e1a2e" : "#dceaf5",
        overflow: "hidden",
        borderRight: "1px solid var(--line)"
      }}>
        <MapCanvas isDark={isDark} route={route} activeIdx={activeIdx} setActiveIdx={setActiveIdx} editMode={editMode} />

        {/* Top-left: trip identity + theme + anchors */}
        <div style={{ position: "absolute", top: 16, left: 16, display: "flex", flexDirection: "column", gap: 8, maxWidth: 360 }}>
          {/* Compact trip identity strip — replaces TripIdentityStrip for this full-bleed view */}
          <div style={{
            background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12,
            padding: "8px 12px", display: "flex", alignItems: "center", gap: 10,
            boxShadow: "var(--shadow-soft)"
          }}>
            <div style={{ width: 28, height: 28, borderRadius: 7, background: "var(--brand)", color: "white", display: "grid", placeItems: "center", flexShrink: 0 }}>
              <Icon name="map" size={14} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 200 }}>{window.TRIP?.title || "Иберия летом"}</div>
              <div className="num muted" style={{ fontSize: 11, lineHeight: 1.2, marginTop: 1 }}>{route.length} {route.length < 5 ? "города" : "городов"} · {route.reduce((n, c) => n + c.nights, 0)} ноч.</div>
            </div>
          </div>

          {/* Theme + anchors controls */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 11, padding: 5, display: "flex", gap: 3 }}>
            {[["auto", "Авто"], ["light", "День"], ["dark", "Ночь"]].map(([t, l]) =>
            <button key={t} onClick={() => setTheme(t)} style={{
              padding: "5px 9px", borderRadius: 6, border: "none", background: theme === t ? "var(--wash)" : "transparent",
              fontSize: 11.5, fontWeight: 500, cursor: "pointer", color: "var(--ink)"
            }}>{l}</button>
            )}
          </div>
          <label style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 11, padding: "7px 12px", display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer" }}>
            <input type="checkbox" checked={!anchorsOff} onChange={() => setAnchorsOff(!anchorsOff)} />
            <span>Якоря старта/финиша</span>
          </label>
          {/* Demo route length toggle */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 11, padding: 5, display: "flex", gap: 3 }} title="Демо: 3 или 9 городов">
            {[["3", "3 города"], ["9", "9 городов"]].map(([k, l]) =>
            <button key={k} onClick={() => setRouteLen(k)} style={{
              padding: "5px 9px", borderRadius: 6, border: "none", background: routeLen === k ? "var(--brand-soft)" : "transparent",
              fontSize: 11.5, fontWeight: 500, cursor: "pointer", color: routeLen === k ? "var(--brand)" : "var(--muted)"
            }}>{l}</button>
            )}
          </div>

          {/* Demo: transfer/hotel card cases */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 11, padding: 5, display: "flex", gap: 3, flexWrap: "wrap" }} title="Демо: какие карточки показывать">
            {[
              ["hotel-only", "Только отель"],
              ["transfer-only", "Только трансфер"],
              ["both", "Оба"],
              ["both-warn", "Оба ⚠"]
            ].map(([k, l]) =>
            <button key={k} onClick={() => setCardCase(k)} style={{
              padding: "5px 9px", borderRadius: 6, border: "none", background: cardCase === k ? "var(--brand-soft)" : "transparent",
              fontSize: 11.5, fontWeight: 500, cursor: "pointer", color: cardCase === k ? "var(--brand)" : "var(--muted)"
            }}>{l}</button>
            )}
          </div>

          {/* Demo: transfer card variant */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 11, padding: 5, display: "flex", gap: 3 }} title="3 варианта универсальной карточки трансфера">
            {["V1", "V2", "V3"].map(v =>
            <button key={v} onClick={() => setTransferVariant(v)} style={{
              padding: "5px 11px", borderRadius: 6, border: "none", background: transferVariant === v ? "var(--ev-transfer-soft)" : "transparent",
              fontSize: 11.5, fontWeight: 600, cursor: "pointer", color: transferVariant === v ? "var(--ev-transfer)" : "var(--muted)"
            }}>{v}</button>
            )}
          </div>
        </div>

        {/* Top-right: edit mode toggle */}
        <div style={{ position: "absolute", top: 16, right: 16, display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <Btn variant={editMode ? "primary" : "ghost"} size="sm" icon="edit" onClick={() => setEditMode(!editMode)}
          style={{ background: editMode ? undefined : "var(--surface)", boxShadow: editMode ? undefined : "var(--shadow-soft)" }}>
            {editMode ? "Готово" : "Редактировать"}
          </Btn>
          {editMode &&
          <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 11, padding: 8, display: "flex", flexDirection: "column", gap: 4, boxShadow: "var(--shadow-soft)" }}>
              <Btn variant="ghost" size="sm" icon="plus" onClick={addCity}>Добавить город</Btn>
              <Btn variant="ghost" size="sm" icon="plane">Добавить переезд</Btn>
              <Btn variant="ghost" size="sm" icon="drag">Изменить порядок</Btn>
            </div>
          }
        </div>

        {/* Legend */}
        <div style={{
          position: "absolute", bottom: 16, left: 16,
          background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 11,
          padding: "10px 14px", fontSize: 11.5, boxShadow: "var(--shadow-soft)"
        }}>
          <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 12 }}>Линии маршрута</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <Legend color="var(--brand)" dashed={false}>Запланирован</Legend>
            <Legend color="var(--success)" dashed={false}>Наземный (известный)</Legend>
            <Legend color="var(--warning)" dashed>Не запланирован</Legend>
          </div>
        </div>

        {/* Editing hint */}
        {editMode &&
        <div style={{
          position: "absolute", bottom: 16, right: 16,
          padding: "10px 14px", background: "var(--brand)", color: "white",
          borderRadius: 11, fontSize: 12, fontWeight: 500, maxWidth: 220,
          boxShadow: "var(--shadow-pop)"
        }}>
            <Icon name="info" size={13} style={{ verticalAlign: -1, marginRight: 4 }} />
            Клик по карте — добавить город. Drag pin — перенести.
          </div>
        }
      </div>

      {/* SIDEBAR — only scrolling region */}
      <aside style={{
        display: "flex", flexDirection: "column",
        background: "var(--surface)",
        overflow: "hidden",
        minWidth: 0
      }}>

        {/* Sticky route stepper at top of sidebar — collapses to compact list when long */}
        <RouteStepper
          route={route}
          activeIdx={activeIdx}
          setActiveIdx={setActiveIdx}
          editMode={editMode}
          onAddCity={addCity} />
        

        {/* Scrolling content: active city detail */}
        <div className="scrollbar-thin" style={{ flex: 1, overflow: "auto", padding: 14 }}>
          {active && <ActiveCityCard active={active} activeIdx={activeIdx} transferVariant={transferVariant} cardCase={cardCase} />}
        </div>
      </aside>
    </div>);

}

// ----- Route stepper — adaptive: horizontal for ≤5 cities, compact vertical list for >5 -----
function RouteStepper({ route, activeIdx, setActiveIdx, editMode, onAddCity }) {
  const isLong = route.length > 5;

  if (!isLong) {
    // Horizontal stepper, fits widely-spaced city pills
    return (
      <div style={{
        padding: "14px 14px 12px",
        borderBottom: "1px solid var(--line-2)",
        background: "var(--surface)"
      }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
          <span className="eyebrow" style={{ flex: 1 }}>Маршрут · {route.length} {route.length < 5 ? "города" : "городов"}</span>
          {editMode && <Btn variant="ghost" size="sm" icon="plus" onClick={onAddCity}>Город</Btn>}
        </div>
        <div className="scrollbar-thin" style={{ display: "flex", alignItems: "center", gap: 0, position: "relative", overflowX: "auto" }}>
          {route.map((c, i) =>
          <React.Fragment key={c.name + i}>
              <button onClick={() => setActiveIdx(i)} style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
              padding: "6px 4px", background: "transparent", border: "none", cursor: "pointer",
              flex: "0 0 auto", minWidth: 60
            }}>
                <div style={{
                width: 26, height: 26, borderRadius: "50%",
                background: activeIdx === i ? "var(--brand)" : "var(--brand-soft)",
                color: activeIdx === i ? "white" : "var(--brand)",
                display: "grid", placeItems: "center",
                fontSize: 12, fontWeight: 700,
                boxShadow: activeIdx === i ? "0 0 0 4px var(--brand-soft)" : "none",
                transition: "all .15s ease"
              }}>{i + 1}</div>
                <div style={{ fontSize: 11, fontWeight: activeIdx === i ? 600 : 500, color: activeIdx === i ? "var(--ink)" : "var(--muted)", whiteSpace: "nowrap", maxWidth: 78, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {c.name}
                </div>
              </button>
              {i < route.length - 1 &&
            <div style={{ flex: 1, minWidth: 16, display: "flex", flexDirection: "column", alignItems: "center", marginTop: -16 }}>
                  <div style={{ height: 2, width: "100%", borderTop: SEGMENTS[i]?.kind === "missing" ? "2px dashed var(--warning)" : "2px solid var(--brand-soft-12)" }} />
                </div>
            }
            </React.Fragment>
          )}
        </div>
      </div>);

  }

  // Long-route compact list — vertical strip with mini pills
  return (
    <div style={{
      borderBottom: "1px solid var(--line-2)",
      background: "var(--surface)",
      maxHeight: 280, display: "flex", flexDirection: "column"
    }}>
      <div style={{ padding: "12px 14px 8px", display: "flex", alignItems: "center", gap: 8 }}>
        <span className="eyebrow" style={{ flex: 1 }}>Маршрут · {route.length} городов</span>
        {editMode && <Btn variant="ghost" size="sm" icon="plus" onClick={onAddCity}>Город</Btn>}
      </div>
      <div className="scrollbar-thin" style={{ flex: 1, overflow: "auto", padding: "0 14px 12px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, position: "relative" }}>
          {/* Vertical mini-rail */}
          <div style={{ position: "absolute", left: 11, top: 12, bottom: 12, width: 2, background: "var(--brand-soft-12)" }} />
          {route.map((c, i) =>
          <button key={c.name + i} onClick={() => setActiveIdx(i)} style={{
            display: "grid", gridTemplateColumns: "24px 1fr auto", alignItems: "center", gap: 10,
            width: "100%", padding: "6px 6px 6px 0",
            background: activeIdx === i ? "var(--brand-soft)" : "transparent",
            border: "none", borderRadius: 8, cursor: "pointer", textAlign: "left",
            position: "relative", zIndex: 1
          }}>
              <div style={{
              width: 22, height: 22, borderRadius: "50%",
              background: activeIdx === i ? "var(--brand)" : "var(--surface)",
              color: activeIdx === i ? "white" : "var(--brand)",
              border: activeIdx === i ? "none" : "2px solid var(--brand-soft-12)",
              display: "grid", placeItems: "center",
              fontSize: 10, fontWeight: 700, flexShrink: 0,
              marginLeft: 0
            }}>{i + 1}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>
                <div className="muted num" style={{ fontSize: 10.5 }}>{c.nights} ноч.</div>
              </div>
              <Icon name="chev" size={11} style={{ color: activeIdx === i ? "var(--brand)" : "var(--muted-2)" }} />
            </button>
          )}
        </div>
      </div>
    </div>);

}

// ----- Active city card -----
function ActiveCityCard({ active, activeIdx, transferVariant = "V1", cardCase = "both" }) {
  const [moreOpen, setMoreOpen] = useState(false);

  const showTransfer = cardCase === "transfer-only" || cardCase === "both" || cardCase === "both-warn";
  const showHotel = cardCase === "hotel-only" || cardCase === "both" || cardCase === "both-warn";
  const warning = cardCase === "both-warn";

  // Mock transfer ARRIVING into the active city — kind picked per city for variety
  const transferKinds = ["plane", "train", "car", "walk", "bus"];
  const transferKind = transferKinds[activeIdx % transferKinds.length];
  const transfer = {
    kind: transferKind,
    from_city: activeIdx === 0 ? "Москва" : "Предыдущий город",
    from_code: transferKind === "plane" ? "SVO" : null,
    to_city: active.name,
    to_code: transferKind === "plane" ? (active.name === "Лиссабон" ? "LIS" : active.name === "Порту" ? "OPO" : active.name === "Барселона" ? "BCN" : "—") : null,
    depart_time: "08:35",
    arrive_time: "11:00",
    duration: transferKind === "walk" ? "1ч 20м · 5.2 км" : transferKind === "car" ? "3ч 15м · 312 км" : "4ч 25м",
    carrier: transferKind === "plane" ? "TAP Portugal" : transferKind === "train" ? "Comboios CP" : transferKind === "car" ? "Sixt rental" : transferKind === "bus" ? "FlixBus" : "Пешком",
    num: transferKind === "plane" ? "TP 1245" : transferKind === "train" ? "IC 521" : "—",
    warning,
  };

  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14,
      overflow: "hidden"
    }}>
      {/* Hero header */}
      <div style={{
        padding: "16px 16px 14px",
        background: "linear-gradient(135deg, var(--brand-soft) 0%, var(--wash) 100%)",
        borderBottom: "1px solid var(--line-2)"
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: "var(--brand)", color: "white",
            display: "grid", placeItems: "center",
            fontSize: 14, fontWeight: 700, flexShrink: 0
          }}>{activeIdx + 1}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 18, letterSpacing: "-0.02em", lineHeight: 1.2 }}>
              {active.name}
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{active.country}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", background: "var(--surface)", border: "1px solid var(--line-2)", borderRadius: 999, fontSize: 11.5, fontWeight: 500 }}>
            <Icon name="moon" size={11} style={{ color: "var(--muted)" }} /> {active.nights} {active.nights === 1 ? "ночь" : active.nights < 5 ? "ночи" : "ночей"}
          </span>
          {active.activities &&
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", background: "var(--surface)", border: "1px solid var(--line-2)", borderRadius: 999, fontSize: 11.5, fontWeight: 500 }}>
              <Icon name="cam" size={11} style={{ color: "var(--warm)" }} /> {active.activities.length} активн.
            </span>
          }
        </div>
      </div>

      {/* Transfer card (ABOVE hotel) — universal variants V1/V2/V3 */}
      {showTransfer && (
        <UniversalTransferCard transfer={transfer} variant={transferVariant} />
      )}

      {/* Hotel row */}
      {showHotel && (
        <button style={{
          display: "flex", alignItems: "center", gap: 12,
          width: "100%", padding: "12px 16px",
          border: "none", background: "transparent", cursor: "pointer", textAlign: "left",
          borderBottom: "1px solid var(--line-2)",
          borderLeft: warning ? "3px solid var(--warning)" : "3px solid transparent",
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = "var(--wash)"}
        onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
          <div style={{
            width: 36, height: 36, borderRadius: 9,
            background: warning ? "var(--warning-soft)" : "var(--ev-hotel-soft)",
            color: warning ? "var(--warning)" : "var(--ev-hotel)",
            display: "grid", placeItems: "center", flexShrink: 0,
          }}>
            <Icon name={warning ? "warning" : "bed"} size={16} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {warning ? "Нет отеля" : active.hotel}
            </div>
            <div className="muted num" style={{ fontSize: 11.5 }}>
              {warning ? "Не забронирован — нужно выбрать" : "Заезд → выезд"}
            </div>
          </div>
          {warning ? (
            <Btn variant="ghost" size="sm" icon="plus">Найти</Btn>
          ) : (
            <Icon name="chev" size={13} style={{ color: "var(--muted-2)" }} />
          )}
        </button>
      )}

      {/* Activities */}
      {active.activities && active.activities.length > 0 &&
      <div style={{ padding: "12px 16px" }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>В этом городе</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 0, position: "relative" }}>
            <div style={{ position: "absolute", left: 11, top: 6, bottom: 6, width: 2, background: "var(--line-2)" }} />
            {active.activities.map((a, i) =>
          <div key={i} style={{
            display: "flex", alignItems: "flex-start", gap: 12,
            padding: "8px 0", position: "relative", zIndex: 1
          }}>
                <div style={{
              width: 24, height: 24, borderRadius: "50%",
              background: "var(--surface)",
              border: "2px solid var(--ev-activity)",
              color: "var(--ev-activity)",
              display: "grid", placeItems: "center", flexShrink: 0
            }}>
                  <Icon name="cam" size={11} />
                </div>
                <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--ink)", lineHeight: 1.35 }}>
                    {a.name}
                  </div>
                  <div className="muted num" style={{ fontSize: 11, marginTop: 1 }}>{a.time}</div>
                </div>
              </div>
          )}
          </div>
        </div>
      }

      {/* Footer: primary "+ Активность" + 3-dot for other actions */}
      <div style={{
        display: "flex", gap: 6, alignItems: "center",
        padding: "10px 12px",
        borderTop: "1px solid var(--line-2)",
        background: "var(--wash)",
        position: "relative"
      }}>
        <Btn variant="primary" size="sm" icon="plus" onClick={() => window.__navigate?.("activity-form")} style={{ flex: 1 }}>
          Активность
        </Btn>
        <button onClick={() => setMoreOpen(!moreOpen)} className="icon-btn" style={{
          background: moreOpen ? "var(--brand-soft)" : "var(--surface)",
          color: moreOpen ? "var(--brand)" : "var(--muted)",
          border: "1px solid " + (moreOpen ? "var(--brand)" : "var(--line)"),
          width: 32, height: 32
        }} title="Ещё">
          <Icon name="more" size={15} />
        </button>
        {moreOpen &&
        <div style={{
          position: "absolute", bottom: "calc(100% + 6px)", right: 12,
          width: 220,
          background: "var(--surface)", border: "1px solid var(--line)",
          borderRadius: 11, boxShadow: "var(--shadow-pop)",
          padding: 6, zIndex: 10
        }}>
            <MenuItem icon="bed" onClick={() => {setMoreOpen(false);window.__navigate?.("hotel-form");}}>Добавить отель</MenuItem>
            <MenuItem icon="plane" onClick={() => {setMoreOpen(false);window.__navigate?.("transfer-form");}}>Добавить переезд</MenuItem>
            <MenuItem icon="edit" onClick={() => setMoreOpen(false)}>Редактировать город</MenuItem>
            <MenuItem icon="trash" danger onClick={() => setMoreOpen(false)}>Убрать из маршрута</MenuItem>
          </div>
        }
      </div>
    </div>);

}

// =====================================================================
// UNIVERSAL TRANSFER CARD — 3 visual variants that work for any transfer kind
// (plane / train / bus / car / walk / bike / ferry)
// =====================================================================
const KIND_META = {
  plane: { icon: "plane", label: "Перелёт" },
  train: { icon: "train", label: "Поезд" },
  bus:   { icon: "bus",   label: "Автобус" },
  car:   { icon: "car",   label: "На авто" },
  walk:  { icon: "walk",  label: "Пешком" },
  bike:  { icon: "walk",  label: "Велосипед" },
  ferry: { icon: "ferry", label: "Паром" }
};

function UniversalTransferCard({ transfer, variant = "V1" }) {
  const meta = KIND_META[transfer.kind] || KIND_META.car;
  const warn = transfer.warning;
  const tintBg = warn ? "var(--warning-soft)" : "var(--ev-transfer-soft)";
  const tintFg = warn ? "var(--warning)" : "var(--ev-transfer)";
  const tintBorder = warn ? "var(--warning)" : "var(--ev-transfer)";

  // ---- V1 — Compact strip: icon + from→to + duration + carrier ----
  if (variant === "V1") {
    return (
      <button style={{
        display: "flex", alignItems: "center", gap: 12,
        width: "100%", padding: "12px 16px",
        border: "none", background: "transparent", cursor: "pointer", textAlign: "left",
        borderBottom: "1px solid var(--line-2)",
        borderLeft: `3px solid ${tintBorder}`,
      }}
      onMouseEnter={(e) => e.currentTarget.style.background = "var(--wash)"}
      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
        <div style={{
          width: 36, height: 36, borderRadius: 9,
          background: tintBg, color: tintFg,
          display: "grid", placeItems: "center", flexShrink: 0,
        }}>
          <Icon name={warn ? "warning" : meta.icon} size={16} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {warn ? "Нет переезда" : <>{transfer.from_city} <Icon name="arrowR" size={11} style={{ color: "var(--muted-2)", verticalAlign: -1 }} /> {transfer.to_city}</>}
          </div>
          <div className="muted num" style={{ fontSize: 11.5, marginTop: 1 }}>
            {warn ? "Из «" + transfer.from_city + "» — добавить" : `${meta.label} · ${transfer.duration}${transfer.carrier ? " · " + transfer.carrier : ""}`}
          </div>
        </div>
        {warn ? (
          <Btn variant="ghost" size="sm" icon="plus">Найти</Btn>
        ) : (
          <Icon name="chev" size={13} style={{ color: "var(--muted-2)" }} />
        )}
      </button>
    );
  }

  // ---- V2 — Boarding-pass stub: two lines, big arrival time + from/to ----
  if (variant === "V2") {
    return (
      <button style={{
        display: "grid", gridTemplateColumns: "auto 1fr auto",
        gap: 14, alignItems: "center",
        width: "100%", padding: "14px 16px",
        border: "none", background: warn ? "var(--warning-soft)" : "transparent",
        cursor: "pointer", textAlign: "left",
        borderBottom: "1px solid var(--line-2)",
        borderLeft: `3px solid ${tintBorder}`,
      }}
      onMouseEnter={(e) => { if (!warn) e.currentTarget.style.background = "var(--wash)"; }}
      onMouseLeave={(e) => { if (!warn) e.currentTarget.style.background = "transparent"; }}>
        <div style={{
          width: 38, height: 38, borderRadius: 10,
          background: tintBg, color: tintFg,
          display: "grid", placeItems: "center", flexShrink: 0,
        }}>
          <Icon name={warn ? "warning" : meta.icon} size={17} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <span className="num" style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em", color: warn ? "var(--warning)" : "var(--ink)" }}>
              {warn ? "—" : transfer.arrive_time}
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: warn ? "var(--warning)" : "var(--ink)" }}>
              {warn ? "Нет переезда" : `Прибытие в ${transfer.to_city}`}
            </span>
          </div>
          <div className="muted num" style={{ fontSize: 11.5, marginTop: 2, display: "flex", flexWrap: "wrap", gap: 6 }}>
            <span>из {transfer.from_city}</span>
            {!warn && <><span style={{ color: "var(--muted-2)" }}>·</span> <span>{transfer.duration}</span></>}
            {!warn && transfer.carrier && <><span style={{ color: "var(--muted-2)" }}>·</span> <span>{transfer.carrier}</span></>}
          </div>
        </div>
        {warn ? (
          <Btn variant="ghost" size="sm" icon="plus">Найти</Btn>
        ) : (
          <Icon name="chev" size={13} style={{ color: "var(--muted-2)" }} />
        )}
      </button>
    );
  }

  // ---- V3 — Mini-timeline: depart point + dashed line + arrive point ----
  return (
    <button style={{
      width: "100%", padding: "12px 16px",
      border: "none", background: warn ? "var(--warning-soft)" : "transparent",
      cursor: "pointer", textAlign: "left",
      borderBottom: "1px solid var(--line-2)",
      borderLeft: `3px solid ${tintBorder}`,
    }}
    onMouseEnter={(e) => { if (!warn) e.currentTarget.style.background = "var(--wash)"; }}
    onMouseLeave={(e) => { if (!warn) e.currentTarget.style.background = "transparent"; }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 7,
          background: tintBg, color: tintFg,
          display: "grid", placeItems: "center", flexShrink: 0,
        }}>
          <Icon name={warn ? "warning" : meta.icon} size={14} />
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, color: warn ? "var(--warning)" : tintFg, textTransform: "uppercase", letterSpacing: ".06em" }}>
          {warn ? "Переезд не задан" : `${meta.label} · ${transfer.duration}`}
        </div>
      </div>
      {warn ? (
        <div className="muted" style={{ fontSize: 12, paddingLeft: 38 }}>
          Из «{transfer.from_city}» в «{transfer.to_city}» — добавь способ.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 10, alignItems: "center", paddingLeft: 38 }}>
          <div style={{ minWidth: 0 }}>
            <div className="num" style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.01em" }}>{transfer.depart_time}</div>
            <div style={{ fontSize: 11.5, fontWeight: 600, marginTop: 1 }}>
              {transfer.from_code ? <><span className="num">{transfer.from_code}</span> · </> : null}{transfer.from_city}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 3, color: tintFg, minWidth: 56 }}>
            <div style={{ height: 1, flex: 1, borderTop: `1.5px dashed ${tintFg}` }} />
            <Icon name={meta.icon} size={11} />
            <div style={{ height: 1, flex: 1, borderTop: `1.5px dashed ${tintFg}` }} />
          </div>
          <div style={{ minWidth: 0, textAlign: "right" }}>
            <div className="num" style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-0.01em" }}>{transfer.arrive_time}</div>
            <div style={{ fontSize: 11.5, fontWeight: 600, marginTop: 1 }}>
              {transfer.to_code ? <><span className="num">{transfer.to_code}</span> · </> : null}{transfer.to_city}
            </div>
          </div>
        </div>
      )}
      {!warn && transfer.carrier && (
        <div className="muted" style={{ fontSize: 11, marginTop: 6, paddingLeft: 38 }}>
          {transfer.carrier}{transfer.num && transfer.num !== "—" ? <> · <span className="num">{transfer.num}</span></> : null}
        </div>
      )}
    </button>
  );
}

function MenuItem({ icon, onClick, children, danger }) {
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 10,
      width: "100%", padding: "8px 10px",
      background: "transparent", border: "none",
      borderRadius: 7, cursor: "pointer", textAlign: "left",
      fontSize: 13, color: danger ? "var(--danger)" : "var(--ink)"
    }}
    onMouseEnter={(e) => e.currentTarget.style.background = danger ? "var(--danger-soft)" : "var(--wash)"}
    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
      <Icon name={icon} size={14} />
      {children}
    </button>);

}

function Legend({ color, dashed, children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <svg width="30" height="2"><line x1="0" y1="1" x2="30" y2="1" stroke={color} strokeWidth="2" strokeDasharray={dashed ? "4 3" : "0"} /></svg>
      <span>{children}</span>
    </div>);

}

function MapCanvas({ isDark, route, activeIdx, setActiveIdx, editMode }) {
  return (
    <svg viewBox="0 0 100 70" preserveAspectRatio="xMidYMid slice" style={{ width: "100%", height: "100%", display: "block", cursor: editMode ? "crosshair" : "default" }}>
      <defs>
        <pattern id="dots-mp" width="2" height="2" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r=".15" fill={isDark ? "#1a3050" : "#bcd4e8"} />
        </pattern>
      </defs>
      <rect width="100" height="70" fill={isDark ? "#0e1a2e" : "#dceaf5"} />
      <rect width="100" height="70" fill="url(#dots-mp)" />
      {/* Land mass */}
      <path
        d="M5 20 Q 12 12 22 18 L 30 14 Q 40 10 55 16 Q 70 14 85 20 L 95 28 Q 92 38 80 42 L 60 45 Q 50 52 45 55 L 30 60 Q 20 58 15 50 L 8 40 Q 4 30 5 20 Z"
        fill={isDark ? "#1d2f4a" : "#f6f3ed"}
        stroke={isDark ? "#2c4566" : "#dcd3c2"}
        strokeWidth=".3" />

      <path
        d="M16 42 Q 16 46 18 50 L 22 58 Q 28 60 32 56 L 35 50 Q 37 44 33 42 L 26 40 Q 20 40 16 42 Z"
        fill={isDark ? "#243a59" : "#ece5d4"}
        stroke={isDark ? "#345780" : "#c9bd9f"}
        strokeWidth=".4" />

      {/* Routes — auto-derive lines connecting consecutive cities */}
      {route.slice(0, -1).map((c, i) => {
        const next = route[i + 1];
        const seg = SEGMENTS[i];
        const isMissing = seg?.kind === "missing";
        return (
          <line key={i}
          x1={c.x} y1={c.y} x2={next.x} y2={next.y}
          stroke={isMissing ? "var(--warning)" : "var(--brand)"}
          strokeWidth=".5"
          strokeDasharray={isMissing ? "1 .8" : "0"}
          opacity=".7" />);

      })}

      {/* City pins */}
      {route.map((c, i) =>
      <g key={c.name + i} onClick={() => setActiveIdx(i)} style={{ cursor: "pointer" }}>
          <circle cx={c.x} cy={c.y} r={activeIdx === i ? 2.3 : 1.6} fill="var(--brand)" />
          {activeIdx === i && <circle cx={c.x} cy={c.y} r={3.6} fill="var(--brand)" opacity=".22" />}
          <text x={c.x + 3} y={c.y + 1} fontSize="2.4" fontWeight="600" fill={isDark ? "#e8edf5" : "#0F172A"}>
            {String(i + 1).padStart(2, "0")} {c.name}
          </text>
        </g>
      )}

      {/* Edit mode ghost adder */}
      {editMode &&
      <g>
          <circle cx="50" cy="35" r="1.5" fill="var(--success)" opacity=".5" />
          <text x="52" y="36" fontSize="2" fill="var(--success)" fontWeight="600">+ Click to add city</text>
        </g>
      }
    </svg>);

}

function AddCityDialog({ onAdded }) {
  const [name, setName] = useState("");
  const [results] = useState([
  { name: "Севилья", country: "🇪🇸 Испания" },
  { name: "Гранада", country: "🇪🇸 Испания" },
  { name: "Бордо", country: "🇫🇷 Франция" }]);

  const filtered = results.filter((r) => r.name.toLowerCase().includes(name.toLowerCase()));
  return (
    <window.Dialog title="Добавить город в маршрут" icon="pin" size="" foot={<>
      <Btn variant="ghost" onClick={() => window.__closeModal?.()}>Отмена</Btn>
    </>}>
      <div style={{ position: "relative", marginBottom: 10 }}>
        <Icon name="search" size={15} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--muted-2)" }} />
        <input className="input" placeholder="Поиск города…" value={name} onChange={(e) => setName(e.target.value)} style={{ paddingLeft: 34 }} autoFocus />
      </div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>Подсказано исходя из соседних городов вашего маршрута</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {filtered.map((r, i) =>
        <button key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", border: "none", background: "transparent", borderRadius: 8, cursor: "pointer", textAlign: "left" }}
        onMouseEnter={(e) => e.currentTarget.style.background = "var(--wash)"} onMouseLeave={(e) => e.currentTarget.style.background = ""}
        onClick={() => {onAdded?.({ ...r, x: 30 + i * 5, y: 50, nights: 2, hotel: "—" });window.__closeModal?.();}}>
            <Icon name="pin" size={14} style={{ color: "var(--brand)" }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500, fontSize: 13 }}>{r.name}</div>
              <div className="muted" style={{ fontSize: 11.5 }}>{r.country}</div>
            </div>
            <Btn variant="ghost" size="sm" icon="plus">Добавить</Btn>
          </button>
        )}
      </div>
    </window.Dialog>);

}

export default ScreenMap;
