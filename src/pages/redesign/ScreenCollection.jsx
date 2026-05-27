import React, { useState, useEffect, useRef } from 'react';
import { Icon } from '../../design/icons';
import { Avatar, AvatarStack, Badge, Btn, Card, Field, EmptyState, Skeleton, Toggle,
         fmt, TRIP, TRIPS, ModalHost, Dialog, PartnerLogo, PartnerPill, CityPhoto,
         WeatherChip, RoleBadge, DismissibleSeverity, BookingSuggestionCard } from '../../design/index';

// =====================================================================
// COLLECTION — Dashboard (§6)
// =====================================================================

const CollectionTripCover = ({ trip }) => {
  const hue = trip.coverHue ?? 210;
  const accentHue = trip.accentHue ?? 18;
  const isDark = document.documentElement.dataset.theme === "dark";
  const bg = `linear-gradient(135deg,
    hsl(${hue}, 60%, ${isDark ? 28 : 70}%) 0%,
    hsl(${(hue + accentHue) % 360}, 55%, ${isDark ? 22 : 60}%) 70%,
    hsl(${accentHue}, 70%, ${isDark ? 35 : 65}%) 100%)`;
  return (
    <div style={{
      aspectRatio: "16/9",
      background: bg,
      borderRadius: "var(--radius-card)",
      position: "relative",
      overflow: "hidden"
    }}>
      <svg viewBox="0 0 200 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.45 }}>
        <path d={`M0 ${60 + trip.id.length % 20} Q 50 ${30 + trip.id.length % 10} 100 ${50 + trip.id.length % 15} T 200 ${40 + trip.id.length % 12}`}
        stroke="white" strokeWidth="1" fill="none" strokeDasharray="2 3" />
      </svg>
      <div style={{ position: "absolute", top: 12, right: 12, display: "flex", gap: 6 }}>
        {trip.pro &&
        <div style={{
          background: "rgba(255,255,255,.92)", color: "var(--warm)",
          fontSize: 11, fontWeight: 700, letterSpacing: ".05em",
          padding: "3px 8px", borderRadius: 999
        }}>Pro</div>
        }
        {trip.role !== "owner" &&
        <div style={{
          background: "rgba(15,23,42,.6)", color: "white",
          fontSize: 11, fontWeight: 600,
          padding: "3px 8px", borderRadius: 999,
          backdropFilter: "blur(8px)",
          display: "inline-flex", alignItems: "center", gap: 4
        }}>
            <Icon name="users" size={11} />
            Совместный
          </div>
        }
      </div>
      {trip.status === "past" &&
      <div style={{
        position: "absolute", inset: 0,
        background: "rgba(15,23,42,.55)"
      }} />
      }
    </div>);

};

const TripCard = ({ trip, onClick }) =>
<button
  onClick={onClick}
  style={{
    border: "1px solid var(--line)",
    background: "var(--surface)",
    borderRadius: "var(--radius-card)",
    padding: 14,
    textAlign: "left",
    display: "flex", flexDirection: "column", gap: 12,
    cursor: "pointer",
    transition: "transform .15s, box-shadow .15s, border-color .15s"
  }}
  onMouseEnter={(e) => {e.currentTarget.style.transform = "translateY(-2px)";e.currentTarget.style.boxShadow = "var(--shadow-card)";e.currentTarget.style.borderColor = "#dbe1ec";}}
  onMouseLeave={(e) => {e.currentTarget.style.transform = "";e.currentTarget.style.boxShadow = "";e.currentTarget.style.borderColor = "var(--line)";}}>
  
    <CollectionTripCover trip={trip} />
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 17, letterSpacing: "-0.015em", marginBottom: 4 }}>
          {trip.title}
        </div>
        <div className="muted num" style={{ fontSize: 12.5 }}>{trip.days}</div>
      </div>
      {trip.role === "viewer" && <Badge variant="quiet" icon="eye">Зритель</Badge>}
      {trip.role === "admin" && <Badge variant="">Админ</Badge>}
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "var(--muted)" }}>
      <Icon name="pin" size={13} />
      <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{trip.scope}</span>
      {trip.status === "draft" && <Badge variant="warning" dot>Черновик</Badge>}
    </div>
  </button>;


const TripRow = ({ trip, onClick }) =>
<button onClick={onClick} style={{
  display: "grid",
  gridTemplateColumns: "44px 1fr 180px 140px 100px 30px",
  alignItems: "center", gap: 14,
  padding: "12px 16px",
  background: "var(--surface)",
  border: "1px solid var(--line)",
  borderRadius: 12,
  cursor: "pointer", textAlign: "left",
  fontSize: 13.5
}}
onMouseEnter={(e) => e.currentTarget.style.borderColor = "#dbe1ec"}
onMouseLeave={(e) => e.currentTarget.style.borderColor = "var(--line)"}>
    <div style={{ width: 44, height: 44, borderRadius: 10, background: `hsl(${trip.coverHue ?? 210}, 50%, 60%)`, position: "relative" }}>
      {trip.role !== "owner" &&
    <span style={{
      position: "absolute", bottom: -3, right: -3,
      width: 20, height: 20, borderRadius: "50%",
      background: "var(--surface)", border: "2px solid var(--surface)",
      display: "grid", placeItems: "center"
    }}>
          <Icon name="users" size={11} style={{ color: "var(--brand)" }} />
        </span>
    }
    </div>
    <div>
      <div style={{ fontWeight: 600, color: "var(--ink)", marginBottom: 2 }}>{trip.title}</div>
      <div className="muted" style={{ fontSize: 12 }}>{trip.scope}</div>
    </div>
    <div className="muted num" style={{ fontSize: 12.5 }}>{trip.days}</div>
    <div>
      {trip.role === "owner" && <Badge>Владелец</Badge>}
      {trip.role === "admin" && <Badge>Админ</Badge>}
      {trip.role === "viewer" && <Badge variant="quiet" icon="eye">Зритель</Badge>}
    </div>
    <div>{trip.pro && <Badge variant="warm">Pro</Badge>}</div>
    <Icon name="chev" size={14} style={{ color: "var(--muted-2)" }} />
  </button>;


// ----- Empty state (zero trips) -----
function CollectionEmpty() {
  return (
    <div style={{ maxWidth: 720, margin: "60px auto", textAlign: "center" }}>
      <div style={{
        width: 96, height: 96, margin: "0 auto 22px",
        borderRadius: 24,
        background: "linear-gradient(135deg, var(--brand-soft), var(--ai-soft))",
        display: "grid", placeItems: "center"
      }}>
        <Icon name="globe" size={42} style={{ color: "var(--brand)" }} />
      </div>
      <h1 style={{ marginBottom: 10 }}>Спланируй первый трип</h1>
      <div className="muted" style={{ fontSize: 16, marginBottom: 28, maxWidth: 480, margin: "0 auto 28px" }}>
        Triplanio собирает города, переезды, отели, активности и бюджет в одну картину. Начни с любого.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, maxWidth: 600, margin: "0 auto" }}>
        <button onClick={() => window.__navigate?.("manual-planner")} style={{
          padding: 22, background: "var(--surface)", border: "1.5px solid var(--brand-soft-12)", borderRadius: 14,
          cursor: "pointer", textAlign: "left"
        }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "var(--brand)", color: "white", display: "grid", placeItems: "center", marginBottom: 14 }}>
            <Icon name="edit" size={19} />
          </div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Собрать руками</div>
          <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>Сам выбираю города, даты, отели и активности. Полный контроль.</div>
        </button>
        <button onClick={() => window.__navigate?.("ai-planner")} className="ai-card" style={{
          padding: 22, background: "linear-gradient(135deg, var(--ai-soft) 0%, rgba(240,164,90,.05) 100%)",
          border: "1.5px solid var(--ai-soft-12)", borderRadius: 14,
          cursor: "pointer", textAlign: "left"
        }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, #6a3ee2, #c66ce2)", color: "white", display: "grid", placeItems: "center", marginBottom: 14 }}>
            <Icon name="sparkles" size={19} />
          </div>
          <div style={{ fontWeight: 600, marginBottom: 4 }} className="ai-text">Начать с ИИ <Badge variant="warm" style={{ marginLeft: 4 }}>Pro</Badge></div>
          <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>Описать словами — получить черновик и доработать с ассистентом.</div>
        </button>
      </div>

      <div style={{ marginTop: 32, fontSize: 12.5, color: "var(--muted)" }}>
        Или <a href="#">прими приглашение</a>, если кто-то поделился с тобой трипом.
      </div>
    </div>);

}

function ScreenCollection() {
  const variant = window.__collectionVariant || "A";
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("active"); // active | past
  const userHasSub = window.__userHasSub ?? false;

  // Free users can have at most one active trip. Clicking "New trip" while at
  // the limit opens an upsell dialog instead of the create modal.
  const handleCreateClick = () => {
    if (variant === "E") {
      window.__openModal?.(<window.NewTripDialog />);
      return;
    }
    const activeCount = TRIPS.filter((t) => t.status !== "past").length;
    if (!userHasSub && activeCount >= 1) {
      window.__openModal?.(<window.FreeLimitDialog />);
      return;
    }
    window.__openModal?.(<window.NewTripDialog />);
  };

  if (variant === "E") return <CollectionEmpty />;

  const active = TRIPS.filter((t) => t.status !== "past");
  const past = TRIPS.filter((t) => t.status === "past");
  const visible = activeTab === "active" ? active : past;
  const filtered = visible.filter((t) =>
  t.title.toLowerCase().includes(search.toLowerCase()) ||
  t.scope.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h1 style={{ marginBottom: 6 }}>Твои трипы</h1>
          <div className="muted" style={{ fontSize: 15 }}>{active.length} активных · {past.length} в архиве</div>
        </div>
        <div>
          <Btn variant="primary" size="lg" icon="plus" onClick={handleCreateClick}>Новый трип</Btn>
        </div>
      </div>

      {/* Active/Past tabs + search + visible view toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18, flexWrap: "wrap" }}>
        <div className="tweaks__seg" style={{ flexShrink: 0 }}>
          <button className={activeTab === "active" ? "active" : ""} onClick={() => setActiveTab("active")} style={{ whiteSpace: "nowrap" }}>Активные · {active.length}</button>
          <button className={activeTab === "past" ? "active" : ""} onClick={() => setActiveTab("past")} style={{ whiteSpace: "nowrap" }}>Прошедшие · {past.length}</button>
        </div>
        <div style={{ position: "relative", flex: 1, minWidth: 220, maxWidth: 360 }}>
          <Icon name="search" size={15} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: "var(--muted-2)" }} />
          <input className="input" placeholder="Поиск по названию, городу, описанию" value={search} onChange={(e) => setSearch(e.target.value)} style={{ paddingLeft: 34 }} />
        </div>
        <div style={{ flex: 1 }} />
        <div className="tweaks__seg" title="Вид">
          <button className={variant === "A" ? "active" : ""} onClick={() => window.dispatchEvent(new CustomEvent("__proto_set", { detail: { key: "collectionVariant", val: "A" } }))}><Icon name="grid" size={13} /></button>
          <button className={variant === "B" ? "active" : ""} onClick={() => window.dispatchEvent(new CustomEvent("__proto_set", { detail: { key: "collectionVariant", val: "B" } }))}><Icon name="list" size={13} /></button>
        </div>
      </div>

      {filtered.length === 0 ?
      <EmptyState icon={activeTab === "past" ? "calendar" : "search"} title={activeTab === "past" ? "В архиве пока ничего нет" : "По этому запросу ничего не нашлось"} body={activeTab === "past" ? "Завершённые трипы будут собираться здесь." : "Поправь поиск или переключись на другую вкладку."} /> :
      variant === "A" ?
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
          {filtered.map((t) => <TripCard key={t.id} trip={t} onClick={() => window.__navigate?.("timeline")} />)}
          {activeTab === "active" &&
        <button onClick={handleCreateClick} style={{
          border: "1.5px dashed var(--line)",
          background: "transparent",
          borderRadius: "var(--radius-card)",
          padding: 24,
          display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 10,
          cursor: "pointer", color: "var(--muted)",
          minHeight: 260
        }} onMouseEnter={(e) => {e.currentTarget.style.borderColor = "var(--brand)";e.currentTarget.style.color = "var(--brand)";}}
        onMouseLeave={(e) => {e.currentTarget.style.borderColor = "var(--line)";e.currentTarget.style.color = "var(--muted)";}}>
              <Icon name="plus" size={22} />
              <div style={{ fontWeight: 500 }}>Добавить трип</div>
              <div style={{ fontSize: 12, textAlign: "center", maxWidth: 200 }}>Собрать руками или начать с ИИ.</div>
            </button>
        }
        </div> :

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map((t) => <TripRow key={t.id} trip={t} onClick={() => window.__navigate?.("timeline")} />)}
        </div>
      }

      {/* Free limit banner — only in active, only for free users */}
      {activeTab === "active" && !userHasSub &&
      <div className="ai-card" style={{
        marginTop: 36,
        padding: "18px 22px",
        background: "linear-gradient(135deg, var(--ai-soft) 0%, rgba(240,164,90,.06) 100%)",
        border: "1px solid var(--ai-soft-12)",
        borderRadius: "var(--radius-card)",
        display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap"
      }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, #6a3ee2, #c66ce2)", color: "white", display: "grid", placeItems: "center" }}>
            <Icon name="sparkles" size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>На Free доступен 1 активный трип</div>
            <div className="muted" style={{ fontSize: 12.5 }}>Pro — безлимит трипов, ИИ-планировщик и парсинг бронирований.</div>
          </div>
          <Btn variant="primary" onClick={() => window.__navigate?.("pro")}>Перейти к Pro</Btn>
        </div>
      }
    </div>);

}

// Listen to set events from inside screens (collection variant toggle)
window.addEventListener("__proto_set", (e) => {
  // The Proto component handles this via re-render; we use a ref-style global setter
  if (window.__protoSetters?.[e.detail.key]) window.__protoSetters[e.detail.key](e.detail.val);
});

export default ScreenCollection;
