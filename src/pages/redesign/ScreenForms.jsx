import React, { useState } from 'react'
import { Icon } from '../../design/icons'
import { Btn, Badge, Card, Field, Severity, Avatar, TRIP } from '../../design/index'

// =====================================================================
// FORMS — Hotel, Transfer, Activity, Fork (vendor vs manual)
// =====================================================================

// ----- Free cancellation field -----
function FreeCancellationField({ ai }) {
  const [enabled, setEnabled] = useState(true)
  return (
    <div className={`field ${ai ? "field--ai" : ""}`} style={{ padding: 12, background: "var(--wash-2)", border: "1px solid var(--line-2)", borderRadius: 10 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
        <input type="checkbox" checked={enabled} onChange={() => setEnabled(!enabled)} style={{ width: 16, height: 16, accentColor: "var(--brand)" }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 500 }}>Есть бесплатная отмена</div>
          <div className="muted" style={{ fontSize: 11.5 }}>До какой даты можно отменить без штрафа</div>
        </div>
      </label>
      {enabled && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 110px", gap: 8, marginTop: 12 }}>
          <div style={{ position: "relative" }}>
            <Icon name="calendar" size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }} />
            <input className="input num" defaultValue="09.07.2026" placeholder="дд.мм.гггг" style={{ paddingLeft: 32 }} />
          </div>
          <input className="input num" defaultValue="23:59" placeholder="чч:мм" />
        </div>
      )}
    </div>
  )
}

// ----- Smart URL input with auto-detected partner logo -----
function UrlField({ label, defaultValue = "", ai }) {
  const [url, setUrl] = useState(defaultValue)
  // Simple partner detection without design system import
  const knownPartners = { "booking.com": "Booking", "airbnb.com": "Airbnb", "airbnb.ru": "Airbnb", "renfe.com": "Renfe", "cp.pt": "CP", "tap.com": "TAP", "sagradafamilia.org": "Official", "sixt.com": "Sixt", "thefork.com": "TheFork" }
  const detectedLabel = Object.entries(knownPartners).find(([k]) => url.includes(k))?.[1]
  return (
    <div className={`field ${ai ? "field--ai" : ""}`}>
      <label className="field__label">{label}</label>
      <div style={{ position: "relative" }}>
        <div style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }}>
          <Icon name="external" size={16} style={{ color: "var(--muted)" }} />
        </div>
        <input className="input" value={url} onChange={(e) => setUrl(e.target.value)}
          style={{ paddingLeft: 34 }} placeholder="https://…" />
        {detectedLabel && (
          <Badge variant="quiet" style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)" }}>
            {detectedLabel} распознан
          </Badge>
        )}
      </div>
    </div>
  )
}

// ----- Date+time split input -----
function DateTimeField({ label, dateValue, timeValue, ai, sub, required }) {
  return (
    <div className={`field ${ai ? "field--ai" : ""}`}>
      <label className="field__label">
        {label}{required && <span style={{ color: "var(--danger)" }}>*</span>}
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 110px", gap: 8 }}>
        <div style={{ position: "relative" }}>
          <Icon name="calendar" size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }} />
          <input className="input num" defaultValue={dateValue} placeholder="дд.мм.гггг" style={{ paddingLeft: 32 }} />
        </div>
        <input className="input num" defaultValue={timeValue} placeholder="чч:мм" />
      </div>
      {sub && <span className="field__sub">{sub}</span>}
    </div>
  )
}

// ----- File attach block -----
function FilesAttach({ files = [] }) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 8 }}>Документы</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {files.map((f, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 11px", border: "1px solid var(--line-2)", borderRadius: 8 }}>
            <Icon name="file" size={14} style={{ color: "var(--muted)" }} />
            <div style={{ flex: 1, fontSize: 12.5 }}>
              <div style={{ fontWeight: 500 }}>{f.name}</div>
              <div className="muted" style={{ fontSize: 11 }}>{f.size}</div>
            </div>
            <Btn variant="quiet" size="sm" icon="download" />
            <Btn variant="quiet" size="sm" icon="trash" />
          </div>
        ))}
        <div style={{
          padding: 12, border: "1.5px dashed var(--line)", borderRadius: 8,
          textAlign: "center", color: "var(--muted)", fontSize: 12.5
        }}>
          <Icon name="upload" size={14} style={{ verticalAlign: -2, marginRight: 4 }} />
          Перетащи файлы или <a href="#">выбери</a>
        </div>
      </div>
    </div>
  )
}

// ------ Hotel form (§10) ------
function ScreenHotelForm() {
  const [variant] = useState("normal")
  const ai = variant === "ai-filled"

  return (
    <div style={{ maxWidth: 880, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, color: "var(--muted)", fontSize: 13 }}>
        <Btn variant="quiet" size="sm" icon="back" onClick={() => { window.__triplanioNavigate?.("timeline") }}>К трипу</Btn>
        <span>·</span>
        <span>Лиссабон</span>
        <span>·</span>
        <span>Новое проживание</span>
      </div>
      <h1 style={{ marginBottom: 24 }}>Проживание</h1>

      <div className="ai-card" style={{ padding: 14, background: "linear-gradient(135deg, var(--ai-soft) 0%, rgba(240,164,90,.06) 100%)", border: "1px dashed var(--ai-soft-12)", borderRadius: 12, marginBottom: 20, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Icon name="sparkles" size={16} style={{ color: "var(--ai)" }} />
        <div style={{ flex: 1, fontSize: 13, color: "var(--ink)", minWidth: 220 }}>
          <b>Дать ИИ заполнить за тебя?</b> Загрузи PDF или скриншот подтверждения — он распознает поля.
        </div>
        <Badge variant="warm">Pro</Badge>
        <Btn variant="ai" icon="upload">Загрузить подтверждение</Btn>
      </div>

      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, padding: 24 }}>
        <h3 style={{ marginBottom: 14 }}>Об отеле</h3>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginBottom: 12 }}>
          <Field label="Название" ai={ai} required>
            <input className="input" defaultValue="Memmo Alfama" />
          </Field>
          <Field label="Тип" ai={ai}>
            <select className="select"><option>Отель</option><option>Хостел</option><option>Апартаменты</option></select>
          </Field>
        </div>
        <div style={{ marginBottom: 12 }}>
          <Field label="Адрес" sub="автокомплит реальных адресов" ai={ai}>
            <input className="input" defaultValue="Travessa das Merceeiras 27, 1100-348 Lisboa" />
          </Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <UrlField label="Ссылка на бронирование" defaultValue="https://booking.com/hotel/pt/memmo-alfama" ai={ai} />
          <Field label="Номер брони" ai={ai}>
            <input className="input mono" defaultValue="2387491823" />
          </Field>
        </div>

        <h3 style={{ marginTop: 24, marginBottom: 14 }}>Заезд и выезд</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ padding: 14, background: "var(--wash-2)", borderRadius: 10, border: "1px solid var(--line-2)" }}>
            <div className="eyebrow" style={{ marginBottom: 8, color: "var(--success)" }}>Заезд</div>
            <DateTimeField label="Дата · время" dateValue="12.07.2026" timeValue="15:00" ai={ai} sub="в локальной таймзоне Лиссабона" required />
          </div>
          <div style={{ padding: 14, background: "var(--wash-2)", borderRadius: 10, border: "1px solid var(--line-2)" }}>
            <div className="eyebrow" style={{ marginBottom: 8, color: "var(--warning)" }}>Выезд</div>
            <DateTimeField label="Дата · время" dateValue="16.07.2026" timeValue="11:00" ai={ai} required />
          </div>
        </div>

        <h3 style={{ marginTop: 24, marginBottom: 14 }}>Финансы и отмена</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 0.5fr 1fr", gap: 12, marginBottom: 14 }}>
          <Field label="Цена" ai={ai}><input className="input num" defaultValue="880.00" /></Field>
          <Field label="Валюта"><select className="select"><option>EUR</option><option>USD</option></select></Field>
          <Field label="Статус оплаты" ai={ai}><select className="select"><option>По прибытии</option><option>Оплачено</option><option>Частично</option></select></Field>
        </div>
        <FreeCancellationField ai={ai} />

        <h3 style={{ marginTop: 24, marginBottom: 14 }}>Контакты и заметки</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <Field label="Телефон"><input className="input num" placeholder="+351 …" /></Field>
          <Field label="E-mail"><input className="input" placeholder="—" /></Field>
        </div>
        <Field label="Заметки (markdown)" sub="например: «вид с террасы на закат»">
          <textarea className="textarea" placeholder="Свободные заметки про этот отель…" />
        </Field>

        <hr className="hr" style={{ margin: "24px 0" }} />
        <FilesAttach files={[{ name: "memmo-alfama-voucher.pdf", size: "380 KB" }, { name: "map-screenshot.png", size: "104 KB" }]} />

        <Severity level="info" title="Подсказка">
          На 14 июля у вас уже есть вечерняя активность — заезд 15:00 даёт 6 часов «буфера».
        </Severity>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 24, paddingTop: 18, borderTop: "1px solid var(--line-2)" }}>
          <Btn variant="ghost" onClick={() => { window.__triplanioNavigate?.("timeline") }}>Отмена</Btn>
          <Btn variant="primary" icon="check">Сохранить проживание</Btn>
        </div>
      </div>
    </div>
  )
}

// ------ Transfer form (§11) ------
function Segment({ idx, from, to, departDate, departTime, arriveDate, arriveTime, carrier, num }) {
  return (
    <div style={{ padding: 14, border: "1px solid var(--line-2)", borderRadius: 12, marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <Badge variant="solid">{idx}</Badge>
        <span className="num" style={{ fontWeight: 600 }}>{from} → {to}</span>
        <div style={{ flex: 1 }} />
        <Badge variant="">{carrier} {num}</Badge>
        <Btn variant="quiet" size="sm" icon="trash" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={{ padding: 12, background: "var(--wash-2)", borderRadius: 9, border: "1px solid var(--line-2)" }}>
          <div className="eyebrow" style={{ marginBottom: 6, color: "var(--brand)" }}>Отправление</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 90px", gap: 6 }}>
            <input className="input num" defaultValue={departDate} />
            <input className="input num" defaultValue={departTime} />
          </div>
        </div>
        <div style={{ padding: 12, background: "var(--wash-2)", borderRadius: 9, border: "1px solid var(--line-2)" }}>
          <div className="eyebrow" style={{ marginBottom: 6, color: "var(--warm)" }}>Прибытие</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 90px", gap: 6 }}>
            <input className="input num" defaultValue={arriveDate} />
            <input className="input num" defaultValue={arriveTime} />
          </div>
        </div>
      </div>
    </div>
  )
}

function ScreenTransferForm() {
  return (
    <div style={{ maxWidth: 880, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, color: "var(--muted)", fontSize: 13 }}>
        <Btn variant="quiet" size="sm" icon="back" onClick={() => { window.__triplanioNavigate?.("timeline") }}>К трипу</Btn>
        <span>·</span><span>Лиссабон → Барселона</span>
      </div>
      <h1 style={{ marginBottom: 24 }}>Переезд</h1>

      <div className="ai-card" style={{ padding: 14, background: "linear-gradient(135deg, var(--ai-soft) 0%, rgba(240,164,90,.06) 100%)", border: "1px dashed var(--ai-soft-12)", borderRadius: 12, marginBottom: 20, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Icon name="sparkles" size={16} style={{ color: "var(--ai)" }} />
        <div style={{ flex: 1, fontSize: 13, minWidth: 200 }}>
          <b>Многосегментный билет?</b> ИИ распознает пересадки и создаст несколько переездов.
        </div>
        <Badge variant="warm">Pro</Badge>
        <Btn variant="ai" icon="upload">Загрузить билет</Btn>
      </div>

      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, padding: 24 }}>
        <h3 style={{ marginBottom: 14 }}>Тип транспорта</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8, marginBottom: 24 }}>
          {[
            ["plane", "Самолёт", true], ["train", "Поезд", false], ["bus", "Автобус", false],
            ["car", "Машина", false], ["ferry", "Паром", false], ["walk", "Пешком", false]
          ].map(([icon, label, sel]) => (
            <button key={label} style={{
              padding: "12px 8px", background: sel ? "var(--brand-soft)" : "var(--surface)",
              border: "1px solid " + (sel ? "var(--brand)" : "var(--line)"),
              borderRadius: 10, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
              color: sel ? "var(--brand)" : "var(--ink-2)"
            }}>
              <Icon name={icon} size={20} />
              <span style={{ fontSize: 12, fontWeight: 500 }}>{label}</span>
            </button>
          ))}
        </div>

        <h3 style={{ marginBottom: 14 }}>Сегменты</h3>
        <Segment idx={1} from="Lisboa Oriente" to="Madrid Atocha" departDate="16.07" departTime="14:25" arriveDate="16.07" arriveTime="19:40" carrier="Renfe AVE" num="03051" />
        <Segment idx={2} from="Madrid Atocha" to="Barcelona Sants" departDate="16.07" departTime="20:30" arriveDate="16.07" arriveTime="23:15" carrier="Renfe AVE" num="03127" />
        <Btn variant="ghost" icon="plus" block style={{ marginTop: 8 }}>Добавить сегмент пересадки</Btn>

        <h3 style={{ marginTop: 24, marginBottom: 14 }}>Финансы и ссылка</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 0.5fr 1fr", gap: 12, marginBottom: 12 }}>
          <Field label="Цена"><input className="input num" defaultValue="184.00" /></Field>
          <Field label="Валюта"><select className="select"><option>EUR</option></select></Field>
          <Field label="Номер брони"><input className="input mono" defaultValue="RW-8AX12" /></Field>
        </div>
        <UrlField label="Ссылка на бронирование" defaultValue="https://renfe.com/booking/RW-8AX12" />

        <Severity level="warning" title="Пересадка 50 минут — может быть мало">
          Между прибытием в Мадрид и отправлением — 50 минут. Если первый поезд опоздает, можно не успеть.
        </Severity>

        <hr className="hr" style={{ margin: "20px 0" }} />
        <FilesAttach files={[{ name: "renfe-ticket-RW-8AX12.pdf", size: "210 KB" }]} />

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 24, paddingTop: 18, borderTop: "1px solid var(--line-2)" }}>
          <Btn variant="ghost" onClick={() => { window.__triplanioNavigate?.("timeline") }}>Отмена</Btn>
          <Btn variant="primary" icon="check">Сохранить переезд</Btn>
        </div>
      </div>
    </div>
  )
}

// ------ Activity form (§12) ------
function ScreenActivityForm() {
  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, color: "var(--muted)", fontSize: 13 }}>
        <Btn variant="quiet" size="sm" icon="back" onClick={() => { window.__triplanioNavigate?.("timeline") }}>К трипу</Btn>
        <span>·</span><span>Барселона</span><span>·</span><span>Новая активность</span>
      </div>
      <h1 style={{ marginBottom: 24 }}>Активность</h1>

      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
        <Field label="Название" required sub="по тексту определю категорию (еда / достопримечательность / экскурсия)">
          <input className="input" defaultValue="Sagrada Família — забронированный визит" />
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ padding: 12, background: "var(--wash-2)", borderRadius: 9, border: "1px solid var(--line-2)" }}>
            <div className="eyebrow" style={{ marginBottom: 6, color: "var(--brand)" }}>Начало</div>
            <DateTimeField label="Дата · время" dateValue="20.07.2026" timeValue="10:25" required />
          </div>
          <div style={{ padding: 12, background: "var(--wash-2)", borderRadius: 9, border: "1px solid var(--line-2)" }}>
            <div className="eyebrow" style={{ marginBottom: 6, color: "var(--warm)" }}>Окончание</div>
            <DateTimeField label="Дата · время" dateValue="20.07.2026" timeValue="12:00" />
          </div>
        </div>

        <Field label="Локация" sub="реальный адрес с автокомплитом">
          <input className="input" defaultValue="Carrer de Mallorca 401, Barcelona" />
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 0.5fr 1fr", gap: 12 }}>
          <Field label="Цена"><input className="input num" defaultValue="33.00" /></Field>
          <Field label="Валюта"><select className="select"><option>EUR</option></select></Field>
          <Field label="Номер брони / тикета"><input className="input mono" defaultValue="SF-2026-77143" /></Field>
        </div>

        <UrlField label="Ссылка на билет" defaultValue="https://sagradafamilia.org/buy" />

        <Field label="Заметки">
          <textarea className="textarea" placeholder="Билеты на телефоне, подойти за 10 минут к северному входу." />
        </Field>

        <hr className="hr" />
        <FilesAttach files={[{ name: "sagrada-ticket.pdf", size: "78 KB" }]} />

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 8, borderTop: "1px solid var(--line-2)" }}>
          <Btn variant="ghost" onClick={() => { window.__triplanioNavigate?.("timeline") }}>Отмена</Btn>
          <Btn variant="primary" icon="check">Сохранить активность</Btn>
        </div>
      </div>
    </div>
  )
}

// ------ Fork picker (§31.1) ------
function ScreenForkPartner() {
  return (
    <div style={{ maxWidth: 720, margin: "40px auto" }}>
      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, padding: 28, boxShadow: "var(--shadow-card)" }}>
        <h2 style={{ marginBottom: 6 }}>Как добавить проживание?</h2>
        <div className="muted" style={{ fontSize: 14, marginBottom: 22 }}>Этот же выбор повторится для переездов, проката авто и eSIM. Решение запоминается.</div>

        <button style={{
          width: "100%", textAlign: "left", padding: 18, border: "1px solid var(--brand-soft-12)",
          background: "var(--brand-soft)", borderRadius: 12, cursor: "pointer",
          display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 12
        }} onClick={() => { window.__triplanioNavigate?.("hotel-form") }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "var(--brand)", color: "white", display: "grid", placeItems: "center" }}>
            <Icon name="edit" size={18} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>Заполнить руками</div>
            <div className="muted" style={{ fontSize: 12.5 }}>У меня уже есть бронь — внесу название, даты, цены, контакты сам.</div>
          </div>
          <Icon name="chev" size={16} style={{ color: "var(--brand)", marginTop: 12 }} />
        </button>

        <div className="muted" style={{ fontSize: 12, textAlign: "center", margin: "14px 0" }}>или открыть партнёра</div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
          {[
            ["Booking.com", "#003580", "booking.com"],
            ["Airbnb", "#ff385c", "airbnb"],
            ["Marriott", "#a8945c", "marriott"],
            ["Agoda", "#fe424d", "agoda"]
          ].map(([n, c, key]) => (
            <button key={n} style={{
              padding: 14, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10,
              display: "flex", alignItems: "center", gap: 10, cursor: "pointer", textAlign: "left"
            }}>
              <div style={{ width: 28, height: 28, borderRadius: 6, background: c, display: "grid", placeItems: "center" }}>
                <Icon name="external" size={14} style={{ color: "white" }} />
              </div>
              <div style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{n}</div>
              <Icon name="external" size={13} style={{ color: "var(--muted)" }} />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------- Main export with tab switcher ----------
const TABS = [
  { key: "hotel", label: "Отель" },
  { key: "transfer", label: "Переезд" },
  { key: "activity", label: "Активность" },
  { key: "fork", label: "Выбор способа" },
]

function ScreenForms() {
  const [activeTab, setActiveTab] = useState("hotel")

  return (
    <div>
      {/* Tab switcher */}
      <div style={{ display: "flex", gap: 4, marginBottom: 28, borderBottom: "1px solid var(--line-2)", paddingBottom: 0 }}>
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
            padding: "8px 16px", border: "none", background: "transparent",
            borderBottom: activeTab === t.key ? "2px solid var(--brand)" : "2px solid transparent",
            marginBottom: -1,
            fontSize: 13.5, fontWeight: activeTab === t.key ? 600 : 400,
            color: activeTab === t.key ? "var(--brand)" : "var(--ink-2)",
            cursor: "pointer",
          }}>{t.label}</button>
        ))}
      </div>

      {activeTab === "hotel" && <ScreenHotelForm />}
      {activeTab === "transfer" && <ScreenTransferForm />}
      {activeTab === "activity" && <ScreenActivityForm />}
      {activeTab === "fork" && <ScreenForkPartner />}
    </div>
  )
}

export default ScreenForms
