import React, { useState, useEffect, useRef } from 'react';
import { Icon } from '../../design/icons';
import { Avatar, AvatarStack, Badge, Btn, Card, Field, EmptyState, Skeleton, Toggle,
         fmt, TRIP, TRIPS, ModalHost, Dialog, PartnerLogo, PartnerPill, CityPhoto,
         WeatherChip, RoleBadge, DismissibleSeverity, BookingSuggestionCard } from '../../design/index';

// =====================================================================
// PUBLIC READ-ONLY TRIP (§19) — same chronological timeline, no CTAs
// =====================================================================

function ScreenPublic() {
  const [lens, setLens] = useState("timeline");
  const groups = groupByDate(STREAM);
  const openEvent = (e) => window.__openModal?.(<EventModal event={e} />);
  return (
    <div style={{ background: "var(--wash)", minHeight: "100vh", paddingBottom: 60 }}>
      {/* Marketing-ish header */}
      <div style={{ background: "var(--surface)", borderBottom: "1px solid var(--line)", padding: "12px 24px", display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <img src={window.__resources?.logoMark || "assets/logo-mark.svg"} style={{ width: 22, height: 22 }} alt="" />
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 16, letterSpacing: "-0.02em" }}>Triplanio</span>
        </div>
        <div style={{ flex: 1 }} />
        <Badge variant="quiet" icon="eye">Просмотр · не аутентифицирован</Badge>
        <Btn variant="ghost" size="sm">Узнать о Triplanio</Btn>
        <Btn variant="primary" size="sm">Войти</Btn>
      </div>

      {/* Hero / cover */}
      <div style={{
        position: "relative", height: 320,
        background: "linear-gradient(135deg, #2167e2 0%, #5a8ff0 40%, #c9603a 100%)",
        overflow: "hidden", color: "white",
      }}>
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 0%, rgba(11,31,71,.7) 100%)" }} />
        <div style={{ position: "relative", padding: "60px 32px", maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ fontSize: 11.5, letterSpacing: ".14em", textTransform: "uppercase", opacity: 0.7, marginBottom: 8 }}>Публичная ссылка · только для чтения</div>
          <h1 style={{ color: "white", fontSize: 50, letterSpacing: "-0.035em", marginBottom: 10 }}>{TRIP.title}</h1>
          <div className="num" style={{ fontSize: 15.5, opacity: 0.9, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <span>{TRIP.start} → {TRIP.end} · {TRIP.year}</span>
            <span>·</span>
            <span>{TRIP.duration}</span>
            <span>·</span>
            <span>{TRIP.cities.join(" → ")}</span>
            <span>·</span>
            <span>{TRIP.travelers} участника</span>
          </div>
        </div>
      </div>

      {/* Lens tabs (only timeline + map) */}
      <div style={{ background: "var(--surface)", borderBottom: "1px solid var(--line)", padding: "0 32px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", gap: 8 }}>
          {[["timeline", "Хронология", "list"], ["map", "Карта", "map"]].map(([k, l, ic]) => (
            <button key={k} onClick={() => setLens(k)} style={{
              padding: "16px 12px", background: "transparent", border: "none",
              borderBottom: "2px solid " + (lens === k ? "var(--brand)" : "transparent"),
              color: lens === k ? "var(--brand)" : "var(--muted)",
              fontWeight: 500, fontSize: 14, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 6,
            }}>
              <Icon name={ic} size={15} /> {l}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px" }}>
        {lens === "timeline" && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--brand)", color: "white", display: "grid", placeItems: "center", flexShrink: 0 }}>
                <Icon name="flag" size={13} />
              </div>
              <div>
                <div style={{ fontWeight: 600 }}>Старт · Москва</div>
              </div>
            </div>
            {groups.map((g, gi) => (
              <div key={gi}>
                <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 14, padding: "16px 0 6px", alignItems: "baseline" }}>
                  <div>
                    <div className="num" style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 24, letterSpacing: "-0.02em", lineHeight: 1 }}>{fmtDate(g.date)}</div>
                    <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", marginTop: 4 }}>{weekday(g.date)}</div>
                  </div>
                  <div style={{ borderBottom: "1px solid var(--line-2)", paddingBottom: 6 }}>
                    {(g.items.find(i => i.city) || {}).city && (
                      <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
                        <Icon name="pin" size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
                        {(g.items.find(i => i.city) || {}).city}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 134 }}>
                  {g.items.map(e => <StreamEventRow key={e.id} e={e} onClick={() => openEvent(e)} />)}
                </div>
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 22 }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--ink-2)", color: "white", display: "grid", placeItems: "center", flexShrink: 0 }}>
                <Icon name="check" size={13} />
              </div>
              <div><div style={{ fontWeight: 600 }}>Финиш · Москва</div></div>
            </div>
          </>
        )}
        {lens === "map" && (
          <div style={{ aspectRatio: "16/9", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, display: "grid", placeItems: "center", color: "var(--muted)" }}>
            <div style={{ textAlign: "center" }}>
              <Icon name="map" size={32} />
              <div style={{ marginTop: 8 }}>Маршрут на карте (read-only)</div>
            </div>
          </div>
        )}
      </div>

      <div style={{ maxWidth: 600, margin: "60px auto 0", padding: 24, background: "var(--brand-soft)", borderRadius: 16, textAlign: "center" }}>
        <h3 style={{ marginBottom: 8 }}>Понравился способ планирования?</h3>
        <div className="muted" style={{ fontSize: 13.5, marginBottom: 14 }}>Triplanio — для сложных трипов, в одиночку или группой. Бесплатно для одного трипа.</div>
        <Btn variant="primary">Попробовать бесплатно</Btn>
      </div>
    </div>
  );
}

export default ScreenPublic;
