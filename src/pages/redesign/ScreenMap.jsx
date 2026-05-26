import React, { useState } from 'react'
import { Icon } from '../../design/icons'
import { Btn, Badge, Card, Dialog, Field, TRIP } from '../../design/index'

// =====================================================================
// TRIP MAP — geographic lens (§14) — with route editing
// =====================================================================

const ROUTE = [
  { name: "Лиссабон", country: "🇵🇹 Португалия", x: 22, y: 56, nights: 4, hotel: "Memmo Alfama",
    activities: [
      { name: "Трамвай 28 — петля по Альфаме", time: "13 июл · 10:00" },
      { name: "Pastéis de Belém — pastry crawl", time: "13 июл · 15:30" },
      { name: "Закат на Miradouro da Senhora do Monte", time: "14 июл · 20:45" },
      { name: "Фаду в Tasca do Chico", time: "15 июл · 22:00" },
    ]
  },
  { name: "Порту", country: "🇵🇹 Португалия", x: 21, y: 49, nights: 3, hotel: "Torel Avantgarde",
    activities: [
      { name: "Livraria Lello — визит по тикету", time: "17 июл · 11:30" },
      { name: "Дегустация портвейна в Taylor's", time: "18 июл · 16:00" },
      { name: "Прогулка по мосту Луиша I", time: "18 июл · 19:30" },
    ]
  },
  { name: "Барселона", country: "🇪🇸 Испания", x: 35, y: 47, nights: 4, hotel: "Cotton House",
    activities: [
      { name: "Sagrada Família — забронированный визит", time: "20 июл · 10:30" },
      { name: "Park Güell — утренний слот", time: "21 июл · 09:00" },
      { name: "Ужин в Disfrutar", time: "22 июл · 20:30" },
    ]
  }
]

const SEGMENTS = [
  { from: "Лиссабон", to: "Порту", kind: "train", carrier: "CP IC 521", date: "16 июл 14:25" },
  { from: "Порту", to: "Барселона", kind: "missing", warning: true }
]

function MapCanvas({ isDark, route, activeIdx, setActiveIdx, editMode }) {
  return (
    <svg viewBox="0 0 100 70" style={{ width: "100%", height: "100%", display: "block", cursor: editMode ? "crosshair" : "default" }}>
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

      {/* Routes */}
      <line x1="22" y1="56" x2="21" y2="49" stroke="var(--brand)" strokeWidth=".5" />
      <line x1="21" y1="49" x2="35" y2="47" stroke="var(--warning)" strokeWidth=".5" strokeDasharray="1 .8" />

      {/* City pins */}
      {route.map((c, i) => (
        <g key={c.name} onClick={() => setActiveIdx(i)} style={{ cursor: "pointer" }}>
          <circle cx={c.x} cy={c.y} r={activeIdx === i ? 2.3 : 1.6} fill="var(--brand)" />
          {activeIdx === i && <circle cx={c.x} cy={c.y} r={3.6} fill="var(--brand)" opacity=".22" />}
          <text x={c.x + 3} y={c.y + 1} fontSize="2.4" fontWeight="600" fill={isDark ? "#e8edf5" : "#0F172A"}>
            {String(i + 1).padStart(2, "0")} {c.name}
          </text>
        </g>
      ))}

      {/* Edit mode ghost adder */}
      {editMode && (
        <g>
          <circle cx="50" cy="35" r="1.5" fill="var(--success)" opacity=".5" />
          <text x="52" y="36" fontSize="2" fill="var(--success)" fontWeight="600">+ Click to add city</text>
        </g>
      )}
    </svg>
  )
}

function AddCityDialog({ onAdded, onClose }) {
  const [name, setName] = useState("")
  const [results] = useState([
    { name: "Севилья", country: "🇪🇸 Испания, Севилья", x: 25, y: 58 },
    { name: "Гранада", country: "🇪🇸 Испания, Андалусия", x: 28, y: 60 },
    { name: "Валенсия", country: "🇪🇸 Испания, Валенсия", x: 33, y: 51 },
    { name: "Толедо", country: "🇪🇸 Испания, Толедо", x: 26, y: 53 }
  ])
  return (
    <Dialog title="Добавить город в маршрут" icon="pin" size="" foot={
      <Btn variant="ghost" onClick={onClose}>Отмена</Btn>
    }>
      <Field label="Поиск города" sub="по реальной географии — Google Places-like">
        <input className="input" autoFocus placeholder="Начни вводить название…" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 4 }}>
        {results.filter((r) => r.name.toLowerCase().includes(name.toLowerCase())).map((r) => (
          <button key={r.name} onClick={() => { onAdded({ ...r, nights: 3, hotel: "—" }); onClose() }} style={{
            display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
            background: "transparent", border: "1px solid var(--line-2)", borderRadius: 8,
            cursor: "pointer", textAlign: "left"
          }}
            onMouseEnter={(e) => e.currentTarget.style.background = "var(--wash)"}
            onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
            <Icon name="pin" size={14} style={{ color: "var(--muted)" }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500, fontSize: 13.5 }}>{r.name}</div>
              <div className="muted" style={{ fontSize: 12 }}>{r.country}</div>
            </div>
          </button>
        ))}
      </div>
    </Dialog>
  )
}

function SegmentInline({ seg }) {
  if (!seg) return null
  if (seg.kind === "missing") {
    return (
      <div style={{ marginLeft: 12, paddingLeft: 12, borderLeft: "2px dashed var(--warning)", padding: "8px 10px", fontSize: 11.5, color: "var(--warning)" }}>
        <Icon name="warning" size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
        Нет переезда <Btn variant="ghost" size="sm" icon="plus" style={{ marginLeft: 6, padding: "1px 6px" }}>Добавить</Btn>
      </div>
    )
  }
  return (
    <div style={{ marginLeft: 12, paddingLeft: 12, borderLeft: "2px solid var(--brand)", padding: "8px 10px", fontSize: 11.5, color: "var(--muted)" }}>
      <Icon name={seg.kind === "train" ? "train" : seg.kind === "plane" ? "plane" : "car"} size={11} style={{ verticalAlign: -1, marginRight: 4, color: "var(--brand)" }} />
      {seg.carrier} · <span className="num">{seg.date}</span>
    </div>
  )
}

function Legend({ color, dashed, children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <svg width="30" height="2"><line x1="0" y1="1" x2="30" y2="1" stroke={color} strokeWidth="2" strokeDasharray={dashed ? "4 3" : "0"} /></svg>
      <span>{children}</span>
    </div>
  )
}

function ScreenMap() {
  const [theme, setTheme] = useState("auto")
  const [anchorsOff, setAnchorsOff] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const [editMode, setEditMode] = useState(false)
  const [route, setRoute] = useState(ROUTE)
  const [addCityOpen, setAddCityOpen] = useState(false)

  const isDark = (theme === "auto" && document.documentElement.dataset.theme === "dark") || theme === "dark"
  const active = route[activeIdx]

  return (
    <>
      <div style={{ marginBottom: 22, paddingBottom: 16, borderBottom: "1px solid var(--line-2)", display: "flex", alignItems: "center", gap: 10 }}>
        <h2 style={{ flex: 1 }}>{TRIP.title}</h2>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>12 июл → 23 июл · 2026</span>
      </div>

      {addCityOpen && (
        <AddCityDialog
          onAdded={(c) => setRoute((r) => [...r, c])}
          onClose={() => setAddCityOpen(false)}
        />
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 18, height: "calc(100vh - 240px)", minHeight: 580 }}>
        {/* Map */}
        <div style={{
          position: "relative",
          border: "1px solid var(--line)",
          borderRadius: 16, overflow: "hidden",
          background: isDark ? "#0e1a2e" : "#dceaf5"
        }}>
          <MapCanvas isDark={isDark} route={route} activeIdx={activeIdx} setActiveIdx={setActiveIdx} editMode={editMode} />

          {/* Top-left: theme + anchors */}
          <div style={{ position: "absolute", top: 14, left: 14, display: "flex", flexDirection: "column", gap: 8, maxWidth: 240 }}>
            <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 11, padding: 5, display: "flex", gap: 3 }}>
              {[["auto", "Авто"], ["light", "Светлая"], ["dark", "Тёмная"]].map(([t, l]) => (
                <button key={t} onClick={() => setTheme(t)} style={{
                  padding: "5px 9px", borderRadius: 6, border: "none", background: theme === t ? "var(--wash)" : "transparent",
                  fontSize: 11.5, fontWeight: 500, cursor: "pointer", color: "var(--ink)"
                }}>{l}</button>
              ))}
            </div>
            <label style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 11, padding: "7px 12px", display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer" }}>
              <input type="checkbox" checked={!anchorsOff} onChange={() => setAnchorsOff(!anchorsOff)} />
              <span>Якоря старта/финиша</span>
            </label>
          </div>

          {/* Top-right: edit mode */}
          <div style={{ position: "absolute", top: 14, right: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            <Btn variant={editMode ? "primary" : "ghost"} size="sm" icon="edit" onClick={() => setEditMode(!editMode)}>
              {editMode ? "Завершить редактирование" : "Редактировать маршрут"}
            </Btn>
            {editMode && (
              <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 11, padding: 8, display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                <Btn variant="ghost" size="sm" icon="plus" onClick={() => setAddCityOpen(true)}>Добавить город</Btn>
                <Btn variant="ghost" size="sm" icon="plane">Добавить переезд</Btn>
                <Btn variant="ghost" size="sm" icon="drag">Изменить порядок</Btn>
              </div>
            )}
          </div>

          {/* Legend */}
          <div style={{
            position: "absolute", bottom: 14, left: 14,
            background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 11,
            padding: "10px 14px", fontSize: 11.5
          }}>
            <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 12 }}>Линии маршрута</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <Legend color="var(--brand)" dashed={false}>Запланирован</Legend>
              <Legend color="var(--success)" dashed={false}>Наземный (известный)</Legend>
              <Legend color="var(--warning)" dashed>Не запланирован</Legend>
            </div>
          </div>

          {/* Editing hint */}
          {editMode && (
            <div style={{
              position: "absolute", bottom: 14, right: 14,
              padding: "10px 14px", background: "var(--brand)", color: "white",
              borderRadius: 11, fontSize: 12, fontWeight: 500, maxWidth: 220,
              boxShadow: "var(--shadow-pop)"
            }}>
              <Icon name="info" size={13} style={{ verticalAlign: -1, marginRight: 4 }} />
              Клик по карте — добавить город. Drag pin — перенести.
            </div>
          )}
        </div>

        {/* Right panel — route + context */}
        <aside style={{ display: "flex", flexDirection: "column", gap: 14, overflow: "auto" }} className="scrollbar-thin">
          {/* Route list */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
              <h3 style={{ flex: 1, marginBottom: 0, fontSize: 14 }}>Маршрут</h3>
              <Btn variant="ghost" size="sm" icon="plus" onClick={() => setAddCityOpen(true)}>Город</Btn>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 0, position: "relative" }}>
              {route.map((c, i) => (
                <div key={c.name}>
                  <button onClick={() => setActiveIdx(i)} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    width: "100%", padding: "8px 8px",
                    background: activeIdx === i ? "var(--brand-soft)" : "transparent",
                    border: "none", borderRadius: 8, cursor: "pointer", textAlign: "left"
                  }}>
                    <div style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--brand)", color: "white", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{i + 1}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                      <div className="muted" style={{ fontSize: 11 }}>{c.country} · {c.nights} ночей</div>
                    </div>
                    {editMode && <Btn variant="quiet" size="sm" icon="drag" />}
                  </button>
                  {i < route.length - 1 && <SegmentInline seg={SEGMENTS[i]} />}
                </div>
              ))}
              {editMode && (
                <button onClick={() => setAddCityOpen(true)} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "10px 8px",
                  background: "transparent", border: "1.5px dashed var(--line)", borderRadius: 8,
                  cursor: "pointer", color: "var(--muted)", marginTop: 4
                }}>
                  <Icon name="plus" size={14} />
                  <span style={{ fontSize: 12.5 }}>Добавить ещё один город</span>
                </button>
              )}
            </div>
          </div>

          {/* Active city details */}
          <Card title={active.name} subtitle={active.country}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
                <div style={{ width: 28, height: 28, borderRadius: 7, background: "var(--success-soft)", color: "var(--success)", display: "grid", placeItems: "center" }}>
                  <Icon name="bed" size={14} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{active.hotel}</div>
                  <div className="muted num" style={{ fontSize: 11 }}>{active.nights} ночей</div>
                </div>
                <Btn variant="quiet" size="sm" icon="chev" />
              </div>

              {active.activities && active.activities.length > 0 && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line-2)" }}>
                  <div className="eyebrow" style={{ marginBottom: 8, fontSize: 11, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>Активности · {active.activities.length}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                    {active.activities.map((a, i) => (
                      <div key={i} style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "8px 0",
                        borderBottom: i < active.activities.length - 1 ? "1px solid var(--line-2)" : "none"
                      }}>
                        <div style={{
                          width: 24, height: 24, borderRadius: 6,
                          background: "var(--warm-tint)", color: "var(--warm)",
                          display: "grid", placeItems: "center", flexShrink: 0
                        }}>
                          <Icon name="cam" size={12} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {a.name}
                          </div>
                          <div className="muted num" style={{ fontSize: 11 }}>{a.time}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                <Btn variant="ghost" size="sm" icon="plus" onClick={() => { window.__triplanioNavigate?.("hotel-form") }}>Отель</Btn>
                <Btn variant="ghost" size="sm" icon="plus" onClick={() => { window.__triplanioNavigate?.("activity-form") }}>Активность</Btn>
              </div>
            </div>
          </Card>
        </aside>
      </div>
    </>
  )
}

export default ScreenMap
