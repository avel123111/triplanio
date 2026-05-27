import React, { useState, useEffect, useRef } from 'react';
import { Icon } from '../../design/icons';
import { Avatar, AvatarStack, Badge, Btn, Card, Field, EmptyState, Skeleton, Toggle,
         fmt, TRIP, TRIPS, ModalHost, Dialog, PartnerLogo, PartnerPill, CityPhoto,
         WeatherChip, RoleBadge, DismissibleSeverity, BookingSuggestionCard } from '../../design/index';

// =====================================================================
// HOTEL VOTING — collective decision (§26)
// Compact cards · partner logos · losing proposals design
// =====================================================================

const VOTING_CITIES = [
  { id: "lis", city: "Лиссабон", dateIn: "12 → 16 июл", final: null, proposals: [
    { id: "p1", name: "Memmo Alfama", url: "https://booking.com/h/memmo", rating: 9.0, price: 880, cur: "EUR", by: "Анна Лебедева", note: "В сердце Альфамы, бассейн.",
      approvers: [{ name: "Анна Лебедева", vote: "yes" }, { name: "Игорь Мейзинский", vote: "yes" }, { name: "Миша Петров", vote: "pending" }]},
    { id: "p2", name: "Hotel Britania", url: "https://marriott.com/lisbon-britania", rating: 8.6, price: 1040, cur: "EUR", by: "Игорь Мейзинский", note: "Ар-деко классика.",
      approvers: [{ name: "Анна Лебедева", vote: "no" }, { name: "Игорь Мейзинский", vote: "yes" }, { name: "Миша Петров", vote: "yes" }]},
  ], lost: [
    { id: "l1", name: "Bairro Alto Hotel", url: "https://bairroalto.com", rating: 8.4, price: 970, by: "Лена Краснова", reason: "withdrawn" },
  ]},
  { id: "por", city: "Порту", dateIn: "16 → 19 июл", final: { name: "Torel Avantgarde", price: 720, cur: "EUR", url: "https://booking.com/torel" }, proposals: [], lost: [
    { id: "l2", name: "PortoBay Liberdade", url: "https://portobay.com", rating: 8.7, price: 680, by: "Игорь Мейзинский", reason: "not-chosen" },
    { id: "l3", name: "InterContinental Porto", url: "https://ihg.com", rating: 9.1, price: 920, by: "Анна Лебедева", reason: "not-chosen" },
  ]},
  { id: "bcn", city: "Барселона", dateIn: "19 → 23 июл", final: null, proposals: [
    { id: "p3", name: "Cotton House", url: "https://cottonhousehotel.com", rating: 9.1, price: 1340, cur: "EUR", by: "Анна Лебедева", note: "",
      approvers: [{ name: "Анна Лебедева", vote: "yes" }, { name: "Игорь Мейзинский", vote: "yes" }, { name: "Миша Петров", vote: "yes" }]},
  ], lost: []},
];

const APPROVED = (p) => p.approvers.every(a => a.vote === "yes");

// ---------- Compact proposal card ----------
function ProposalCard({ p }) {
  const yesCount = p.approvers.filter(a => a.vote === "yes").length;
  const total = p.approvers.length;
  const approved = APPROVED(p);
  const partner = detectPartner(p.url);

  return (
    <div style={{
      padding: 12,
      background: "var(--surface)",
      border: "1px solid " + (approved ? "var(--success)" : "var(--line)"),
      borderRadius: 12,
      display: "grid", gridTemplateColumns: "48px 1fr auto auto", gap: 14, alignItems: "center",
      boxShadow: approved ? "0 0 0 3px rgba(31,138,91,.08)" : "none",
    }}>
      {/* Partner logo block */}
      <div style={{ width: 48, height: 48, borderRadius: 10, background: partner?.color || "var(--brand)", color: "white", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 16 }}>
        {partner?.short || <Icon name="bed" size={20} />}
      </div>

      {/* Name + meta */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
          {approved && <Badge variant="success" icon="check">Одобрено</Badge>}
          {p.rating && <Badge variant="quiet" className="num">{p.rating}/10</Badge>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11.5, color: "var(--muted)", flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Icon name="external" size={11} />
            {partner?.label || "Сайт отеля"}
          </span>
          <span>·</span>
          <span>предложил <b style={{ color: "var(--ink-2)", fontWeight: 500 }}>{p.by}</b></span>
          {p.note && (<><span>·</span><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}>{p.note}</span></>)}
        </div>
        {/* Compact approver row */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
          <span className="muted" style={{ fontSize: 11, fontWeight: 500 }}>Голоса:</span>
          <div className="num" style={{ fontSize: 11.5, fontWeight: 600, color: approved ? "var(--success)" : yesCount > 0 ? "var(--brand)" : "var(--muted)" }}>
            {yesCount}/{total}
          </div>
          <div style={{ display: "flex", gap: 4, marginLeft: 4 }}>
            {p.approvers.map((a, i) => (
              <div key={i} title={`${a.name} — ${a.vote === "yes" ? "за" : a.vote === "no" ? "против" : "не голосовал"}`} style={{ position: "relative" }}>
                <Avatar name={a.name} size="sm" />
                <span style={{
                  position: "absolute", bottom: -2, right: -2,
                  width: 12, height: 12, borderRadius: "50%",
                  background: a.vote === "yes" ? "var(--success)" : a.vote === "no" ? "var(--danger)" : "var(--line)",
                  border: "2px solid var(--surface)",
                  display: "grid", placeItems: "center",
                }}>
                  {a.vote === "yes" && <Icon name="check" size={6} style={{ color: "white" }} />}
                  {a.vote === "no" && <Icon name="close" size={6} style={{ color: "white" }} />}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Price */}
      <div className="num" style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18, textAlign: "right" }}>
        {fmt(p.price, p.cur)}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
        {/* Vote buttons — always visible when this approver hasn't voted yet (using Misha as current user) */}
        {p.approvers.find(a => a.name === "Миша Петров")?.vote === "pending" ? (
          <>
            <Btn variant="primary" size="sm" icon="thumbUp">За</Btn>
            <Btn variant="quiet" size="sm" icon="thumbDown">Против</Btn>
          </>
        ) : (
          <Btn variant="ghost" size="sm" icon="refresh">Изменить голос</Btn>
        )}
        {p.by === "Анна Лебедева" && <Btn variant="quiet" size="sm" icon="trash">Отозвать</Btn>}
        {approved && <Btn variant="primary" size="sm" icon="flag">Выбрать</Btn>}
      </div>
    </div>
  );
}

// ---------- Final choice card ----------
function FinalCard({ final }) {
  const partner = detectPartner(final.url);
  return (
    <div style={{
      padding: 14, background: "var(--success-soft)",
      border: "1.5px solid var(--success)", borderRadius: 14,
      display: "grid", gridTemplateColumns: "48px 1fr auto auto", gap: 14, alignItems: "center",
    }}>
      <div style={{ width: 48, height: 48, borderRadius: 10, background: "var(--success)", color: "white", display: "grid", placeItems: "center" }}>
        <Icon name="check" size={22} />
      </div>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{final.name}</span>
          <Badge variant="success">Итоговый выбор</Badge>
        </div>
        <div className="muted" style={{ fontSize: 11.5, display: "flex", alignItems: "center", gap: 6 }}>
          <PartnerLogo url={final.url} size={14} />
          {partner?.label || "Бронирование"}
        </div>
      </div>
      <div className="num" style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 18 }}>{fmt(final.price, final.cur)}</div>
      <div style={{ display: "flex", gap: 4 }}>
        <Btn variant="ghost" size="sm" icon="bed">В проживание</Btn>
        <Btn variant="quiet" size="sm" icon="refresh" title="Отменить выбор" />
      </div>
    </div>
  );
}

// ---------- Losing proposal — compact card with reason ----------
function LostProposalCard({ p }) {
  const partner = detectPartner(p.url);
  return (
    <div style={{
      padding: "8px 12px",
      background: "var(--wash)", border: "1px solid var(--line-2)",
      borderRadius: 10, display: "flex", alignItems: "center", gap: 10,
      opacity: 0.7,
    }}>
      <div style={{ width: 32, height: 32, borderRadius: 7, background: (partner?.color || "var(--muted)") + "33", color: partner?.color || "var(--muted)", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700 }}>
        {partner?.short || <Icon name="bed" size={13} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ textDecoration: "line-through", color: "var(--muted)" }}>{p.name}</span>
          {p.rating && <Badge variant="quiet" className="num">{p.rating}/10</Badge>}
        </div>
        <div className="muted" style={{ fontSize: 11 }}>
          {p.by} · {p.reason === "withdrawn" ? "отозвано автором" : "не выбрано группой"}
        </div>
      </div>
      <div className="num muted" style={{ fontSize: 12.5, fontWeight: 500 }}>{fmt(p.price, "EUR")}</div>
      <Btn variant="quiet" size="sm" icon="eye" title="Посмотреть детали" />
    </div>
  );
}

function ScreenHotels() {
  const [expanded, setExpanded] = useState({ lis: true, por: true, bcn: true, arch_lis: false, arch_por: false });
  return (
    <>
      <TripIdentityStrip compact />

      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 20, padding: 16, background: "var(--brand-soft)", borderRadius: 14 }}>
        <Icon name="vote" size={20} style={{ color: "var(--brand)", marginTop: 2 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Совместный выбор отелей</div>
          <div className="muted" style={{ fontSize: 12.5 }}>
            Любой участник предлагает отель. Для одобрения нужны «за» всех аппруверов.
            <a href="#" onClick={() => window.__navigate?.("trip-settings")}> Управлять аппруверами →</a>
          </div>
        </div>
        <Btn variant="primary" icon="plus">Предложить отель</Btn>
      </div>

      {VOTING_CITIES.map(c => (
        <div key={c.id} style={{ marginBottom: 22 }}>
          <button onClick={() => setExpanded({ ...expanded, [c.id]: !expanded[c.id] })} style={{
            width: "100%", padding: "10px 0", display: "flex", alignItems: "center", gap: 10,
            background: "transparent", border: "none", textAlign: "left", cursor: "pointer",
            borderBottom: "1px solid var(--line-2)", marginBottom: 12,
          }}>
            <Icon name={expanded[c.id] ? "chevD" : "chev"} size={13} />
            <h3 style={{ flex: 1, marginBottom: 0 }}>{c.city}</h3>
            <span className="muted num" style={{ fontSize: 13 }}>{c.dateIn}</span>
            {c.final && <Badge variant="success" icon="flag">Выбран · {c.final.name}</Badge>}
            {!c.final && c.proposals.length > 0 && <Badge>{c.proposals.length} {c.proposals.length === 1 ? "предложение" : "предложений"}</Badge>}
            {!c.final && c.proposals.length === 0 && <Badge variant="quiet">Нет предложений</Badge>}
          </button>
          {expanded[c.id] && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {c.final ? (
                <FinalCard final={c.final} />
              ) : c.proposals.length === 0 ? (
                <div style={{ padding: 22, textAlign: "center", color: "var(--muted)", border: "1.5px dashed var(--line)", borderRadius: 12, fontSize: 13 }}>
                  Пока нет предложений. <a href="#">Предложить первый отель</a>
                </div>
              ) : (
                c.proposals.map(p => <ProposalCard key={p.id} p={p} />)
              )}

              {/* Lost proposals — collapsible */}
              {c.lost.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <button onClick={() => setExpanded({ ...expanded, [`arch_${c.id}`]: !expanded[`arch_${c.id}`] })}
                    style={{ background: "transparent", border: "none", display: "flex", alignItems: "center", gap: 6, color: "var(--muted)", cursor: "pointer", fontSize: 12, padding: "6px 0" }}>
                    <Icon name={expanded[`arch_${c.id}`] ? "chevD" : "chev"} size={11} />
                    {c.lost.length} {c.lost.length === 1 ? "проигравшее предложение" : "проигравших предложений"}
                  </button>
                  {expanded[`arch_${c.id}`] && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                      {c.lost.map(p => <LostProposalCard key={p.id} p={p} />)}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </>
  );
}

export default ScreenHotels;
