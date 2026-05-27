import React, { useState, useEffect, useRef } from 'react';
import { Icon } from '../../design/icons';
import { Avatar, AvatarStack, Badge, Btn, Card, Field, EmptyState, Skeleton, Toggle,
         fmt, TRIP, TRIPS, ModalHost, Dialog, PartnerLogo, PartnerPill, CityPhoto,
         WeatherChip, RoleBadge, DismissibleSeverity, BookingSuggestionCard,
         TripIdentityStrip } from '../../design/index';

// =====================================================================
// TRIP DOCUMENTS (§23) — personal + shared lists, empty states, dialogs
// =====================================================================

const SHARED_DOCS = [
  { title: "Виза в Испанию · общая папка", files: 2, note: "Сделали в феврале, готова до 30.06.2027.", link: null, by: "Анна Лебедева" },
  { title: "Страховка ВТБ", files: 1, note: "Покрытие на 100к €, COVID включён.", link: "vtb.com", by: "Игорь Мейзинский" },
  { title: "Чеклист сборов", files: 0, note: "Адаптер, eSIM, наушники, переходник…", link: null, by: "Анна Лебедева" },
];

const PERSONAL_DOCS = [
  { title: "Мой паспорт", files: 2, note: "Сканы первой страницы и шенгенской визы.", link: null },
  { title: "Бронь из почты", files: 4, note: "Подтверждения отелей и перелётов.", link: null },
];

function ScreenDocs() {
  return (
    <>
      <TripIdentityStrip compact />

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
        <h2 style={{ flex: 1 }}>Документы трипа</h2>
        <Btn variant="primary" icon="plus" onClick={() => window.__openModal?.(<AddDocDialog />)}>Добавить документ</Btn>
      </div>

      {/* SHARED */}
      <section style={{ marginBottom: 30 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <Icon name="users" size={14} style={{ color: "var(--brand)" }} />
          <h3 style={{ marginBottom: 0 }}>Общие документы трипа</h3>
          <Badge variant="quiet">{SHARED_DOCS.length}</Badge>
          <div style={{ flex: 1 }} />
          <div className="muted" style={{ fontSize: 11.5 }}>Видят все участники</div>
        </div>
        {SHARED_DOCS.length === 0 ? (
          <DocEmpty scope="shared" />
        ) : (
          <DocsGrid docs={SHARED_DOCS} scope="shared" />
        )}
      </section>

      {/* PERSONAL */}
      <section style={{ marginBottom: 30 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <Icon name="user" size={14} style={{ color: "var(--warm)" }} />
          <h3 style={{ marginBottom: 0 }}>Личные документы</h3>
          <Badge variant="quiet">{PERSONAL_DOCS.length}</Badge>
          <div style={{ flex: 1 }} />
          <div className="muted" style={{ fontSize: 11.5 }}>Только ты их видишь</div>
        </div>
        {PERSONAL_DOCS.length === 0 ? (
          <DocEmpty scope="personal" />
        ) : (
          <DocsGrid docs={PERSONAL_DOCS} scope="personal" />
        )}
      </section>
    </>
  );
}

function DocsGrid({ docs, scope }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
      {docs.map((d, i) => (
        <button key={i} onClick={() => window.__openModal?.(<DocDetailDialog doc={{ ...d, scope }} />)} style={{
          padding: 14, background: "var(--surface)", border: "1px solid var(--line)",
          borderRadius: 12, display: "flex", flexDirection: "column", gap: 8,
          cursor: "pointer", textAlign: "left",
        }} onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#dbe1ec"; e.currentTarget.style.transform = "translateY(-1px)"; }}
           onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--line)"; e.currentTarget.style.transform = ""; }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 9,
              background: scope === "personal" ? "var(--warm-tint)" : "var(--brand-soft)",
              color: scope === "personal" ? "var(--warm)" : "var(--brand)",
              display: "grid", placeItems: "center",
            }}>
              <Icon name="file" size={17} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{d.title}</div>
              <div className="muted" style={{ fontSize: 12 }}>{d.files} {d.files === 1 ? "файл" : "файла"}{d.link && " · ссылка"}</div>
            </div>
          </div>
          <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{d.note}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
            {d.link && <Badge variant="quiet" icon="external">{d.link}</Badge>}
            {scope === "shared" && d.by && <span className="muted" style={{ fontSize: 11 }}>· {d.by}</span>}
          </div>
        </button>
      ))}

      <button onClick={() => window.__openModal?.(<AddDocDialog />)} style={{
        padding: 14, background: "transparent", border: "1.5px dashed var(--line)",
        borderRadius: 12, color: "var(--muted)", cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 130,
      }} onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--brand)"; e.currentTarget.style.color = "var(--brand)"; }}
         onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--line)"; e.currentTarget.style.color = "var(--muted)"; }}>
        <Icon name="plus" size={18} />
        <span>Новый документ</span>
      </button>
    </div>
  );
}

function DocEmpty({ scope }) {
  return (
    <div style={{
      padding: "32px 24px", textAlign: "center",
      border: "1.5px dashed var(--line)", borderRadius: 14,
      background: "var(--wash)",
    }}>
      <div style={{
        width: 56, height: 56, margin: "0 auto 12px", borderRadius: 14,
        background: scope === "personal" ? "var(--warm-tint)" : "var(--brand-soft)",
        color: scope === "personal" ? "var(--warm)" : "var(--brand)",
        display: "grid", placeItems: "center",
      }}>
        <Icon name="file" size={26} />
      </div>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
        {scope === "personal" ? "Личных документов пока нет" : "Общих документов пока нет"}
      </div>
      <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5, maxWidth: 360, margin: "0 auto 14px" }}>
        {scope === "personal"
          ? "Здесь храни паспорта, визы и страховки — другие участники их не видят."
          : "Чеклисты, общие брони из почты, шаблоны — всё, что нужно всем."}
      </div>
      <Btn variant="ghost" icon="plus" onClick={() => window.__openModal?.(<AddDocDialog />)}>
        Добавить {scope === "personal" ? "личный" : "общий"} документ
      </Btn>
    </div>
  );
}

export default ScreenDocs;
