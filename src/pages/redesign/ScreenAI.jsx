import React, { useState } from 'react'
import { Icon } from '../../design/icons'
import { Avatar, Btn, Badge, BookingSuggestionCard, TRIP } from '../../design/index'

// =====================================================================
// PERSONAL AI ASSISTANT — §22 — 3 variants
// =====================================================================

// Mock conversation
const AI_CONV = [
  { who: "me", text: "Сколько ночей мы сейчас в Барселоне?", time: "10:14" },
  { who: "ai", text: "В Барселоне сейчас 4 ночи: с 19 по 23 июля. Заезд в Cotton House 19 июля 16:00, выезд 23 июля 12:00.", time: "10:14" },
  { who: "me", text: "Добавь две ночи в Лиссабоне после Порту перед перелётом обратно. И раздели перелёт Москва-Лиссабон на сегменты с пересадкой в Стамбуле.", time: "10:17" },
  { who: "ai-proposal", time: "10:17",
    intro: "Понял. Хочу внести 3 изменения. Подтверди — и я применю.",
    changes: [
      { type: "add-city", title: "Добавить вторую остановку в Лиссабоне", sub: "23 → 25 июля · 2 ночи · после Барселоны", details: "Нужно будет переезд Барселона → Лиссабон (предлагаю самолёт TAP TP1003, 14:30 → 16:10, ≈ €110)" },
      { type: "split", title: "Разделить перелёт Москва → Лиссабон", sub: "Текущий: SU 2120 прямой. Заменить на 2 сегмента с пересадкой в Стамбуле", details: "TK 414 Москва → Стамбул (06:40 → 09:30) + TK 1455 Стамбул → Лиссабон (12:15 → 14:25)" },
      { type: "shift", title: "Сдвинуть финиш трипа", sub: "Барселона → Лиссабон · 25 июля вместо 23", details: "Якорь «Финиш» переместится. Прокат авто Sixt останется в Барселоне." },
    ],
    note: "Цены и времена ориентировочные — после применения ты сможешь поправить любую деталь."
  },
]

const HINTS = [
  "Сделай день в Барселоне свободнее, перенеси Sagrada на вторник",
  "Сколько у меня времени на пересадку в Порту?",
  "Раздели перелёт с пересадкой в Стамбуле",
  "Найди свободные дни без активностей",
  "Удали все вечерние активности — мы будем на ужинах",
]

function AiProposalCard({ proposal, applied, onApply, onCancel, onTogglePick, picked }) {
  return (
    <div style={{
      padding: 16, background: "var(--surface)", border: "1.5px solid var(--ai-soft-12)",
      borderRadius: 14, marginTop: 6,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Icon name="sparkles" size={16} style={{ color: "var(--ai)" }} />
        <div style={{ fontWeight: 600, fontSize: 13.5 }}>Предложение изменений</div>
        <Badge variant="ai">{proposal.changes.length} изменения</Badge>
      </div>
      <div style={{ fontSize: 13, marginBottom: 14, lineHeight: 1.5 }}>{proposal.intro}</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {proposal.changes.map((c, i) => (
          <div key={i} style={{
            padding: 12, border: "1px solid var(--line)", borderRadius: 10,
            display: "flex", gap: 10, alignItems: "flex-start",
            background: picked[i] ? "var(--ai-soft)" : "var(--wash)",
            opacity: applied ? 0.6 : 1,
          }}>
            <input type="checkbox" checked={picked[i]} onChange={() => onTogglePick && onTogglePick(i)} style={{ marginTop: 2 }} disabled={applied} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
                {c.type === "add-city" && <Icon name="plus" size={13} style={{ verticalAlign: -2, marginRight: 4, color: "var(--success)" }} />}
                {c.type === "split" && <Icon name="arrowSwap" size={13} style={{ verticalAlign: -2, marginRight: 4, color: "var(--brand)" }} />}
                {c.type === "shift" && <Icon name="arrow" size={13} style={{ verticalAlign: -2, marginRight: 4, color: "var(--warning)" }} />}
                {c.title}
              </div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>{c.sub}</div>
              <div style={{ fontSize: 12, color: "var(--ink-2)" }}>{c.details}</div>
            </div>
            {applied && <Badge variant="success" icon="check">Применено</Badge>}
          </div>
        ))}
      </div>

      <div className="muted" style={{ fontSize: 12, marginTop: 12, lineHeight: 1.5 }}>{proposal.note}</div>

      <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
        {applied ? (
          <Btn variant="ghost" icon="refresh">Откатить изменения</Btn>
        ) : (
          <>
            <Btn variant="quiet" onClick={onCancel}>Не применять</Btn>
            <Btn variant="primary" icon="check" onClick={onApply}>
              Применить {picked.filter(Boolean).length} {picked.filter(Boolean).length === 1 ? "изменение" : "изменений"}
            </Btn>
          </>
        )}
      </div>
    </div>
  )
}

function ConversationBody({ applied, setApplied, picked, setPicked, compact }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: compact ? 14 : 20, padding: compact ? "16px 18px" : "24px 28px" }}>
      {AI_CONV.map((m, i) => {
        if (m.who === "me") return (
          <div key={i} style={{ display: "flex", justifyContent: "flex-end" }}>
            <div style={{
              padding: "9px 14px", background: "var(--brand)", color: "white",
              fontSize: 13.5, borderRadius: 14, borderBottomRightRadius: 4, maxWidth: "75%",
            }}>{m.text}</div>
          </div>
        )
        if (m.who === "ai") return (
          <div key={i} style={{ display: "flex", gap: 10 }}>
            <Avatar kind="ai" />
            <div style={{
              padding: "9px 14px", background: "var(--ai-soft)", color: "var(--ink)",
              fontSize: 13.5, borderRadius: 14, borderBottomLeftRadius: 4, maxWidth: "75%", lineHeight: 1.5,
            }}>{m.text}</div>
          </div>
        )
        if (m.who === "ai-proposal") return (
          <div key={i} style={{ display: "flex", gap: 10 }}>
            <Avatar kind="ai" />
            <div style={{ flex: 1, maxWidth: 720 }}>
              <AiProposalCard proposal={m} applied={applied} picked={picked}
                onTogglePick={(idx) => { const p = [...picked]; p[idx] = !p[idx]; setPicked(p) }}
                onApply={() => setApplied(true)}
                onCancel={() => { setPicked(picked.map(() => false)) }}
              />
            </div>
          </div>
        )
        return null
      })}
      {applied && (
        <div style={{ display: "flex", gap: 10 }}>
          <Avatar kind="ai" />
          <div style={{ padding: "9px 14px", background: "var(--success-soft)", color: "var(--ink)", fontSize: 13.5, borderRadius: 14, borderBottomLeftRadius: 4, maxWidth: "75%" }}>
            Готово. Применил 3 изменения.{" "}
            <a href="#" onClick={() => { window.__triplanioNavigate?.("timeline") }}>Открыть хронологию</a>{" "}
            — посмотришь, как теперь выглядит трип.
          </div>
        </div>
      )}
    </div>
  )
}

function AiComposer({ size = "default" }) {
  const [val, setVal] = useState("")
  return (
    <div style={{ borderTop: "1px solid var(--line-2)", padding: 14, background: "var(--surface)" }}>
      <div style={{ position: "relative" }}>
        <textarea
          className="textarea"
          placeholder="Попроси изменить что-нибудь в трипе…"
          value={val} onChange={(e) => setVal(e.target.value)}
          style={{ paddingRight: 50, minHeight: size === "lg" ? 60 : 44, fontSize: 13.5 }}
        />
        <Btn variant="primary" icon="send" onClick={() => setVal("")}
             style={{ position: "absolute", right: 6, bottom: 6 }} />
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
        {HINTS.slice(0, size === "lg" ? 5 : 3).map((h, i) => (
          <button key={i} onClick={() => setVal(h)} style={{
            padding: "5px 10px", fontSize: 12, borderRadius: 999,
            border: "1px solid var(--line)", background: "var(--surface)",
            color: "var(--muted)", cursor: "pointer",
          }}>{h}</button>
        ))}
      </div>
    </div>
  )
}

// ---- VARIANT A: Chat + live trip preview ----
function VariantPreview() {
  const [applied, setApplied] = useState(false)
  const [picked, setPicked] = useState([true, true, true])
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 20, height: "calc(100vh - 240px)", minHeight: 600 }}>
      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line-2)", display: "flex", alignItems: "center", gap: 10 }}>
          <Avatar kind="ai" />
          <div style={{ flex: 1 }}>
            <h3 style={{ marginBottom: 0 }}>ИИ-помощник</h3>
            <div className="muted" style={{ fontSize: 11.5 }}>Личный · только ты видишь этот диалог</div>
          </div>
          <Btn variant="ghost" size="sm" icon="trash">Очистить</Btn>
        </div>
        <div className="scrollbar-thin" style={{ flex: 1, overflow: "auto" }}>
          <ConversationBody applied={applied} setApplied={setApplied} picked={picked} setPicked={setPicked} compact />
        </div>
        <AiComposer />
      </div>

      <aside style={{ background: "var(--wash-2)", border: "1px solid var(--line)", borderRadius: 16, padding: 18, overflow: "auto" }} className="scrollbar-thin">
        <div className="eyebrow" style={{ marginBottom: 10 }}>Предпросмотр изменений</div>
        <h3 style={{ marginBottom: 14 }}>{applied ? "После применения" : "Что станет после применения"}</h3>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ padding: 12, background: picked[0] ? "var(--success-soft)" : "var(--surface)", border: "1.5px " + (picked[0] ? "solid" : "dashed") + " " + (picked[0] ? "var(--success)" : "var(--line)"), borderRadius: 10 }}>
            <div style={{ fontSize: 11.5, color: "var(--success)", fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 4 }}>+ Новый город</div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Лиссабон #2 · 23 → 25 июля</div>
            <div className="muted num" style={{ fontSize: 12, marginTop: 2 }}>2 ночи · после Барселоны</div>
          </div>
          <div style={{ padding: 12, background: picked[1] ? "var(--brand-soft)" : "var(--surface)", border: "1.5px " + (picked[1] ? "solid" : "dashed") + " " + (picked[1] ? "var(--brand)" : "var(--line)"), borderRadius: 10 }}>
            <div style={{ fontSize: 11.5, color: "var(--brand)", fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 4 }}>↻ Переделать переезд</div>
            <div style={{ fontWeight: 600, fontSize: 14 }} className="num">SVO → IST → LIS</div>
            <div className="muted num" style={{ fontSize: 12, marginTop: 2 }}>TK 414 + TK 1455 · 2 сегмента</div>
          </div>
          <div style={{ padding: 12, background: picked[2] ? "var(--warning-soft)" : "var(--surface)", border: "1.5px " + (picked[2] ? "solid" : "dashed") + " " + (picked[2] ? "var(--warning)" : "var(--line)"), borderRadius: 10 }}>
            <div style={{ fontSize: 11.5, color: "var(--warning)", fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 4 }}>↦ Сдвиг финиша</div>
            <div style={{ fontWeight: 600, fontSize: 14 }} className="num">Финиш: 23 → 25 июля</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>Трип станет на 2 дня длиннее</div>
          </div>
        </div>

        <div style={{ marginTop: 18, padding: 12, background: "var(--brand-soft)", borderRadius: 10, fontSize: 12.5, color: "var(--ink)" }}>
          <Icon name="info" size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
          После применения изменения появятся в хронологии, на карте и в календаре. Можешь откатить с помощью «История изменений ИИ».
        </div>
      </aside>
    </div>
  )
}

// ---- VARIANT B: Full-screen chat ----
function VariantFull() {
  const [applied, setApplied] = useState(false)
  const [picked, setPicked] = useState([true, true, true])
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--line)",
      borderRadius: 16, display: "flex", flexDirection: "column", overflow: "hidden",
      height: "calc(100vh - 240px)", minHeight: 600,
      maxWidth: 920, margin: "0 auto",
    }}>
      <div style={{ padding: "20px 28px", borderBottom: "1px solid var(--line-2)", display: "flex", alignItems: "center", gap: 12 }}>
        <Avatar kind="ai" size="lg" />
        <div style={{ flex: 1 }}>
          <h2 style={{ marginBottom: 2 }}>ИИ-помощник</h2>
          <div className="muted" style={{ fontSize: 13 }}>Личный диалог про этот трип · только ты его видишь</div>
        </div>
        <Btn variant="ghost" icon="trash">Очистить историю</Btn>
      </div>
      <div className="scrollbar-thin" style={{ flex: 1, overflow: "auto" }}>
        <ConversationBody applied={applied} setApplied={setApplied} picked={picked} setPicked={setPicked} />
      </div>
      <AiComposer size="lg" />
    </div>
  )
}

// ---- VARIANT C: Sidesheet (chat docked to side, trip visible) ----
function VariantSidesheet() {
  const [applied, setApplied] = useState(false)
  const [picked, setPicked] = useState([true, true, true])
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 420px", gap: 0, height: "calc(100vh - 240px)", minHeight: 600 }}>
      <div style={{ paddingRight: 20, overflow: "auto" }} className="scrollbar-thin">
        <div style={{ background: "var(--ai-soft)", border: "1.5px solid var(--ai-soft-12)", borderRadius: 12, padding: "10px 14px", marginBottom: 14, display: "flex", alignItems: "center", gap: 10 }}>
          <Icon name="sparkles" size={14} style={{ color: "var(--ai)" }} />
          <span style={{ fontSize: 12.5, color: "var(--ai)", flex: 1 }}>ИИ предложил 3 изменения — посмотри справа</span>
        </div>
        <h3 style={{ marginBottom: 12 }}>Хронология трипа</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            { city: "Лиссабон", dates: "12 → 16 июл", n: 4 },
            { city: "Порту", dates: "16 → 19 июл", n: 3 },
            { city: "Барселона", dates: "19 → 23 июл", n: 4 },
            { city: "Лиссабон (новый)", dates: "23 → 25 июл", n: 2, ghost: true },
          ].map((c, i) => (
            <div key={i} style={{
              padding: "14px 18px",
              background: "var(--surface)", borderRadius: 12,
              border: c.ghost ? "1.5px dashed var(--ai)" : "1px solid var(--line)",
              display: "flex", alignItems: "center", gap: 14, opacity: c.ghost ? 0.85 : 1,
            }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: c.ghost ? "var(--ai-soft)" : "var(--brand-soft)", color: c.ghost ? "var(--ai)" : "var(--brand)", display: "grid", placeItems: "center" }}>
                <Icon name="pin" size={15} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{c.city}</div>
                <div className="muted num" style={{ fontSize: 12 }}>{c.dates} · {c.n} ночей</div>
              </div>
              {c.ghost && <Badge variant="ai" icon="sparkles">от ИИ</Badge>}
            </div>
          ))}
        </div>
      </div>
      <aside style={{
        background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16,
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line-2)", display: "flex", alignItems: "center", gap: 10, background: "var(--ai-soft)" }}>
          <Avatar kind="ai" />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>ИИ-помощник</div>
            <div className="muted" style={{ fontSize: 11.5 }}>Личный</div>
          </div>
          <button className="icon-btn" style={{ width: 30, height: 30 }}><Icon name="close" size={15} /></button>
        </div>
        <div className="scrollbar-thin" style={{ flex: 1, overflow: "auto" }}>
          <ConversationBody applied={applied} setApplied={setApplied} picked={picked} setPicked={setPicked} compact />
        </div>
        <AiComposer />
      </aside>
    </div>
  )
}

// ---- VARIANT D: Conversational chat without proposed changes ----
function VariantNoChanges() {
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--line)",
      borderRadius: 16, display: "flex", flexDirection: "column", overflow: "hidden",
      height: "calc(100vh - 240px)", minHeight: 600,
      maxWidth: 920, margin: "0 auto",
    }}>
      <div className="ai-card" style={{ padding: "16px 22px", borderBottom: "1px solid var(--line-2)", display: "flex", alignItems: "center", gap: 12, background: "linear-gradient(135deg, var(--ai-soft) 0%, rgba(240,164,90,.06) 100%)" }}>
        <Avatar kind="ai" size="lg" />
        <div style={{ flex: 1 }}>
          <h2 style={{ marginBottom: 2 }} className="ai-text">ИИ-помощник</h2>
          <div className="muted" style={{ fontSize: 13 }}>Можно просто общаться — спрашивать, искать варианты, идеи. Изменения в трип внесу, только если попросишь.</div>
        </div>
        <Btn variant="ghost" icon="trash">Очистить</Btn>
      </div>
      <div className="scrollbar-thin" style={{ flex: 1, overflow: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "flex", gap: 10 }}>
          <Avatar kind="ai" />
          <div style={{ padding: "10px 14px", background: "var(--ai-soft)", fontSize: 13.5, borderRadius: 14, borderBottomLeftRadius: 4, maxWidth: "75%", lineHeight: 1.5 }}>
            Привет, Анна. Я знаю всё про этот трип. Спроси что угодно — про маршрут, время, расходы, погоду. Или попроси подобрать что-то.
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <div style={{ padding: "9px 14px", background: "var(--brand)", color: "white", fontSize: 13.5, borderRadius: 14, borderBottomRightRadius: 4, maxWidth: "75%" }}>
            Найди ресторан с морепродуктами в Лиссабоне на 14 июля вечер. До €70/чел.
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Avatar kind="ai" />
          <div style={{ flex: 1, maxWidth: 720 }}>
            <div style={{ padding: "10px 14px", background: "var(--ai-soft)", fontSize: 13.5, borderRadius: 14, borderBottomLeftRadius: 4, lineHeight: 1.5, marginBottom: 10, display: "inline-block" }}>
              Нашёл два места рядом с твоим отелем в Альфаме. Оба берут резерв на 14 июля 20:30.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <BookingSuggestionCard type="activity" name="Cervejaria Ramiro" partner="TheFork" url="https://thefork.com/ramiro"
                price={48} cur="EUR" rating="4.8" sub="Av. Almirante Reis 1 · морепродукты · 12 мин пешком" extras={["Brand pick", "20:30 свободно"]} />
              <BookingSuggestionCard type="activity" name="A Cevicheria" partner="TheFork" url="https://thefork.com/a-cevicheria"
                price={58} cur="EUR" rating="4.6" sub="Rua Dom Pedro V 129 · перуанская · 18 мин" extras={["20:00 свободно"]} />
            </div>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <div style={{ padding: "9px 14px", background: "var(--brand)", color: "white", fontSize: 13.5, borderRadius: 14, borderBottomRightRadius: 4, maxWidth: "75%" }}>
            Ramiro нравится. Сейчас сам забронирую. Спасибо.
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Avatar kind="ai" />
          <div style={{ padding: "10px 14px", background: "var(--ai-soft)", fontSize: 13.5, borderRadius: 14, borderBottomLeftRadius: 4, maxWidth: "75%", lineHeight: 1.5 }}>
            Отличный выбор. Когда подтвердишь — могу добавить эту активность в твой трип на 14 июля 20:30, чтобы напомнить за день.
            <div style={{ marginTop: 8 }}>
              <Btn variant="ai" size="sm" icon="plus">Да, добавь в трип</Btn>
            </div>
          </div>
        </div>
      </div>
      <AiComposer size="lg" />
    </div>
  )
}

function ScreenAI() {
  const [variant, setVariant] = useState("A")
  return (
    <>
      <div style={{ marginBottom: 22, paddingBottom: 16, borderBottom: "1px solid var(--line-2)", display: "flex", alignItems: "center", gap: 10 }}>
        <h2 style={{ flex: 1 }}>{TRIP.title}</h2>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>12 июл → 23 июл · 2026</span>
      </div>
      {variant === "A" && <VariantPreview />}
      {variant === "B" && <VariantFull />}
      {variant === "C" && <VariantSidesheet />}
      {variant === "D" && <VariantNoChanges />}
    </>
  )
}

export default ScreenAI
