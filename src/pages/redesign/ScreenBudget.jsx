import React, { useState, useEffect, useRef } from 'react';
import { Icon } from '../../design/icons';
import { Avatar, AvatarStack, Badge, Btn, Card, Field, EmptyState, Skeleton, Toggle,
         fmt, TRIP, TRIPS, ModalHost, Dialog, PartnerLogo, PartnerPill, CityPhoto,
         WeatherChip, RoleBadge, DismissibleSeverity, BookingSuggestionCard } from '../../design/index';

// =====================================================================
// TRIP BUDGET — full breakdown (§16)
// Currency is set in trip settings — not here.
// =====================================================================

const CATEGORIES = [
{ id: "stay", name: "Проживание", color: "#2167e2", icon: "bed", spent: 2940, planned: 3500, system: true, items: [
  { name: "Memmo Alfama", sub: "Лиссабон · 4 ночи", amount: 880, source: "hotel", city: "Лиссабон" },
  { name: "Torel Avantgarde", sub: "Порту · 3 ночи", amount: 720, source: "hotel", city: "Порту" },
  { name: "Cotton House", sub: "Барселона · 4 ночи", amount: 1340, source: "hotel", city: "Барселона" }]
},
{ id: "transport", name: "Транспорт", color: "#6a3ee2", icon: "plane", spent: 580, planned: 850, system: true, items: [
  { name: "Поезд CP IC 521", sub: "Лиссабон → Порту", amount: 36, source: "transfer", city: "в пути" },
  { name: "Перелёт TAP 1245", sub: "Москва → Лиссабон", amount: 544, source: "transfer", city: "Лиссабон" }]
},
{ id: "act", name: "Активности", color: "#c9603a", icon: "spark", spent: 412, planned: 600, system: true, items: [
  { name: "Sintra винный тур", sub: "14 июл", amount: 145, source: "activity", city: "Лиссабон" },
  { name: "Sagrada Família", sub: "20 июл", amount: 33, source: "activity", city: "Барселона" },
  { name: "Дегустация Sandeman", sub: "17 июл", amount: 65, source: "activity", city: "Порту" },
  { name: "Castelo São Jorge", sub: "13 июл", amount: 30, source: "activity", city: "Лиссабон" }]
},
{ id: "services", name: "Сервисы", color: "#1f8a5b", icon: "esim", spent: 230, planned: 250, system: true, items: [
  { name: "Holafly eSIM", sub: "10 GB · EU", amount: 35, source: "service", city: "—" },
  { name: "Sixt прокат", sub: "Барселона", amount: 195, source: "service", city: "Барселона" }]
},
{ id: "food", name: "Еда (своё)", color: "#e08158", icon: "cup", spent: 318, planned: 800, system: false, items: [
  { name: "Завтраки", sub: "Лиссабон · 4 дня", amount: 96, source: "manual", city: "Лиссабон" },
  { name: "Ужин LX Factory", sub: "13 июл", amount: 84, source: "manual", city: "Лиссабон" },
  { name: "Tasca + ужин", sub: "Порту, 18 июл", amount: 138, source: "manual", city: "Порту" }]
},
{ id: "gifts", name: "Подарки", color: "#c98a1a", icon: "gift", spent: 0, planned: 200, system: false, items: [] }];


const TOTAL_SPENT = CATEGORIES.reduce((s, c) => s + c.spent, 0);
const TOTAL_PLANNED = CATEGORIES.reduce((s, c) => s + c.planned, 0);
const TRIP_CUR = "EUR";

// Group all items by city
function groupByCity() {
  const cities = {};
  for (const c of CATEGORIES) {
    for (const it of c.items) {
      if (!cities[it.city]) cities[it.city] = [];
      cities[it.city].push({ ...it, category: c.name, catColor: c.color, catIcon: c.icon });
    }
  }
  return Object.entries(cities).map(([city, items]) => ({
    city,
    total: items.reduce((s, it) => s + it.amount, 0),
    items
  }));
}

function ScreenBudget() {
  const [active, setActive] = useState("stay");
  const [grouping, setGrouping] = useState("category"); // category | city
  const cat = CATEGORIES.find((c) => c.id === active);
  const cityGroups = groupByCity();

  return (
    <>
      <TripIdentityStrip compact />

      {/* Top summary */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 22 }}>
        <Card>
          <div className="muted" style={{ fontSize: 12 }}>Всего потрачено</div>
          <div className="num" style={{ fontSize: 30, fontFamily: "var(--font-display)", fontWeight: 600, marginTop: 4 }}>{fmt(TOTAL_SPENT, TRIP_CUR)}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>из планируемых {fmt(TOTAL_PLANNED, TRIP_CUR)}</div>
          <div style={{ marginTop: 12, height: 6, borderRadius: 3, background: "var(--wash)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${TOTAL_SPENT / TOTAL_PLANNED * 100}%`, background: "var(--success)" }} />
          </div>
        </Card>
        <Card>
          <div className="muted" style={{ fontSize: 12 }}>На одного</div>
          <div className="num" style={{ fontSize: 30, fontFamily: "var(--font-display)", fontWeight: 600, marginTop: 4 }}>{fmt(Math.round(TOTAL_SPENT / 4), TRIP_CUR)}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>4 участника · поровну</div>
        </Card>
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <span className="muted" style={{ fontSize: 12 }}>Курсы валют</span>
          </div>
          <div className="num" style={{ fontSize: 13, color: "var(--ink)", marginTop: 8, lineHeight: 1.7 }}>
            1 USD ≈ 1.08 EUR<br />
            1 RUB ≈ 94 EUR
          </div>
          <Btn variant="ghost" size="sm" icon="edit" style={{ marginTop: 8 }} onClick={() => window.__openModal?.(<FxRatesDialog />)}>Изменить курсы</Btn>
        </Card>
      </div>

      <Severity level="warning" title="Курсы для TRY не получены">
        Две траты в TRY не пересчитаны и не включены в итог. <a href="#" onClick={(e) => {e.preventDefault();window.__openModal?.(<FxRatesDialog />);}} style={{ fontWeight: 500 }}>Поставить курс вручную</a>
      </Severity>

      {/* Grouping switcher */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 22, marginBottom: 14 }}>
        <div className="tweaks__seg">
          <button className={grouping === "category" ? "active" : ""} onClick={() => setGrouping("category")}>По категориям</button>
          <button className={grouping === "city" ? "active" : ""} onClick={() => setGrouping("city")}>По городам</button>
        </div>
        <div style={{ flex: 1 }} />
        {grouping === "category" && <Btn variant="ghost" size="sm" icon="plus" onClick={() => window.__openModal?.(<CategoryDialog />)}>Категория</Btn>}
        <Btn variant="primary" size="sm" icon="plus" onClick={() => window.__openModal?.(<window.AddExpenseDialog />)}>Ручная трата</Btn>
      </div>

      {grouping === "category" ?
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 18 }}>
          {/* Categories list */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {CATEGORIES.map((c) =>
          <button key={c.id} onClick={() => setActive(c.id)} style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "11px 13px",
            background: active === c.id ? "var(--brand-soft)" : "var(--surface)",
            border: "1px solid " + (active === c.id ? "var(--brand-soft-12)" : "var(--line)"),
            borderRadius: 10, cursor: "pointer", textAlign: "left", width: "100%"
          }}>
                <div style={{ width: 28, height: 28, borderRadius: 7, background: c.color + "22", color: c.color, display: "grid", placeItems: "center" }}>
                  <Icon name={c.icon === "gift" ? "spark" : c.icon} size={14} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                    {c.name}
                    {!c.system && <Badge variant="quiet" style={{ fontSize: 10, padding: "1px 5px" }}>польз.</Badge>}
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>{c.items.length} {c.items.length === 1 ? "трата" : "трат"}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="num" style={{ fontWeight: 600, fontSize: 13 }}>{fmt(c.spent, TRIP_CUR)}</div>
                  <div className="muted num" style={{ fontSize: 10 }}>/ {fmt(c.planned, TRIP_CUR)}</div>
                </div>
              </button>
          )}
          </div>

          {/* Category drill-down */}
          <div>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 10, gap: 8 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: cat.color + "22", color: cat.color, display: "grid", placeItems: "center" }}>
                <Icon name={cat.icon === "gift" ? "spark" : cat.icon} size={15} />
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{ marginBottom: 2 }}>{cat.name}</h3>
                <div className="muted num" style={{ fontSize: 12 }}>{fmt(cat.spent, TRIP_CUR)} из {fmt(cat.planned, TRIP_CUR)}</div>
              </div>
              {!cat.system &&
            <Btn variant="ghost" size="sm" icon="edit" onClick={() => window.__openModal?.(<CategoryDialog existing={cat} />)}>Изменить</Btn>
            }
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {cat.items.length === 0 &&
            <div style={{ padding: 22, textAlign: "center", color: "var(--muted)", border: "1.5px dashed var(--line)", borderRadius: 10 }}>
                  Пока пусто. <a href="#">Добавить первую трату</a>
                </div>
            }
              {cat.items.map((it, i) =>
            <ExpenseRow key={i} it={it} catColor={cat.color} />
            )}
            </div>
          </div>
        </div> :

      // By city — same master/detail layout as categories
      <CityGrouping cityGroups={cityGroups} />
      }
    </>);

}

// City grouping with master-detail like categories
function CityGrouping({ cityGroups }) {
  const [activeCity, setActiveCity] = useState(cityGroups[0]?.city);
  const cur = cityGroups.find((g) => g.city === activeCity);
  if (!cur) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 18 }} className="budget-2col">
      {/* Cities list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {cityGroups.map((g) => {
          const isActive = g.city === activeCity;
          return (
            <button key={g.city} onClick={() => setActiveCity(g.city)} style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "11px 13px",
              background: isActive ? "var(--brand-soft)" : "var(--surface)",
              border: "1px solid " + (isActive ? "var(--brand-soft-12)" : "var(--line)"),
              borderRadius: 10, cursor: "pointer", textAlign: "left", width: "100%",
            }}>
              <div style={{ width: 28, height: 28, borderRadius: 7, background: "var(--brand-soft)", color: "var(--brand)", display: "grid", placeItems: "center" }}>
                <Icon name="pin" size={14} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: 13 }}>{g.city}</div>
                <div className="muted" style={{ fontSize: 11 }}>{g.items.length} {g.items.length === 1 ? "трата" : "трат"}</div>
              </div>
              <div className="num" style={{ fontWeight: 600, fontSize: 13 }}>{fmt(g.total, "EUR")}</div>
            </button>
          );
        })}
      </div>

      {/* City drill-down */}
      <div>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 10, gap: 8 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--brand-soft)", color: "var(--brand)", display: "grid", placeItems: "center" }}>
            <Icon name="pin" size={15} />
          </div>
          <div style={{ flex: 1 }}>
            <h3 style={{ marginBottom: 2 }}>{cur.city}</h3>
            <div className="muted num" style={{ fontSize: 12 }}>{cur.items.length} {cur.items.length === 1 ? "трата" : "трат"} · итого {fmt(cur.total, "EUR")}</div>
          </div>
          <Btn variant="ghost" size="sm" icon="plus" onClick={() => window.__openModal?.(<window.AddExpenseDialog />)}>Трата</Btn>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {cur.items.map((it, i) =>
            <ExpenseRow key={i} it={it} catColor={it.catColor} catName={it.category} catIcon={it.catIcon} showCategory />
          )}
        </div>
      </div>
    </div>
  );
}

function ExpenseRow({ it, catColor, catName, catIcon, showCategory }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "10px 12px",
      background: "var(--surface)",
      border: "1px solid var(--line)",
      borderRadius: 9
    }}>
      <div style={{ width: 26, height: 26, borderRadius: 6, background: catColor + "22", color: catColor, display: "grid", placeItems: "center" }}>
        <Icon name={catIcon || (it.source === "hotel" ? "bed" : it.source === "transfer" ? "plane" : it.source === "activity" ? "spark" : it.source === "service" ? "esim" : "edit")} size={13} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{it.name}</div>
        <div className="muted" style={{ fontSize: 11.5, display: "flex", alignItems: "center", gap: 6 }}>
          <span>{it.sub}</span>
          {showCategory && <Badge variant="quiet" style={{ fontSize: 10, padding: "1px 5px" }}>{catName}</Badge>}
        </div>
      </div>
      {it.source === "manual" ?
      <Btn variant="quiet" size="sm" icon="edit" /> :

      <Badge variant="quiet" icon="link" style={{ fontSize: 10 }}>авто</Badge>
      }
      <div className="num" style={{ fontWeight: 600, fontSize: 13.5, minWidth: 64, textAlign: "right" }}>{fmt(it.amount, TRIP_CUR)}</div>
    </div>);

}

export default ScreenBudget;
