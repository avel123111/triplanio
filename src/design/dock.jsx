import React, { useState } from 'react';
import { Icon } from './icons';
import { Avatar, Btn, Badge, BookingSuggestionCard } from './index';

// =====================================================================
// DOCKED CHAT PANEL - floats on all trip screens
// Tabs: group chat + personal AI assistant
// =====================================================================

export function DockedChat({ open, setOpen, initialTab = "group" }) {
  const [tab, setTab] = useState(initialTab);
  const [text, setText] = useState("");

  if (!open) return null;
  return (
    <div className="dock-panel">
      <div className="dock-panel__tabs">
        <button className={`dock-panel__tab ${tab === "group" ? "active" : ""}`} onClick={() => setTab("group")}>
          <Icon name="chat" size={15} /> Чат группы
          <Badge variant="warm" style={{ marginLeft: 4 }}>3</Badge>
        </button>
        <button className={`dock-panel__tab ${tab === "ai" ? "active" : ""}`} onClick={() => setTab("ai")}>
          <Icon name="sparkles" size={15} style={{ color: tab === "ai" ? "var(--brand)" : "var(--ai)" }} />
          <span className={tab === "ai" ? "" : "ai-text"}>ИИ-помощник</span>
        </button>
        <button className="icon-btn" style={{ width: 32, height: 32 }} onClick={() => setOpen(false)}>
          <Icon name="close" size={14} />
        </button>
      </div>

      {tab === "group" && <GroupChatMini />}
      {tab === "ai" && <AiChatMini />}
    </div>
  );
}

// ----- Group chat mini -----
function GroupChatMini() {
  const [showMention, setShowMention] = useState(false);
  const [text, setText] = useState("");

  return (
    <>
      <div className="dock-panel__head">
        <div style={{ display: "flex", gap: -6 }}>
          <Avatar name="Анна Лебедева" size="sm" />
          <Avatar name="Игорь Мейзинский" size="sm" style={{ marginLeft: -8 }} />
          <Avatar name="Лена Краснова" size="sm" style={{ marginLeft: -8 }} />
          <Avatar name="Миша Петров" size="sm" style={{ marginLeft: -8 }} />
        </div>
        <div style={{ flex: 1, fontSize: 'var(--fs-meta)' }}>
          <b>Иберия летом</b> · 4 человека
        </div>
        <button className="icon-btn" style={{ width: 30, height: 30 }} onClick={() => {}}>
          <Icon name="external" size={14} />
        </button>
      </div>
      <div className="scrollbar-thin" style={{ flex: 1, overflow: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
        <BubbleMsg who="Анна Лебедева" time="14:22" text="Закинула черновик плана - посмотрите города и даты, пожалуйста." />
        <BubbleMsg who="Игорь Мейзинский" time="15:08" text="Лиссабон выглядит коротко. <b>3 дня</b> маловато на Sintra + Belém + город." md />
        <BubbleMsg who="Анна Лебедева" time="10:14" text="@assistant сколько ночей у нас сейчас в Лиссабоне?" />
        <BubbleMsg ai who="ИИ-помощник" time="10:14" text="Сейчас 4 ночи (12 → 16 июля)." />
        <BubbleMsg ai who="ИИ-помощник" time="10:15" text="Кстати, нашёл несколько отелей в Барселоне в твоём диапазоне дат:" />
        <BookingSuggestionCard
          type="hotel" name="Cotton House Hotel"
          partner="Booking.com" url="https://booking.com/hotel/cotton-house"
          price={1340} cur="EUR" rating="9.1"
          sub="Gran Via 670 · 4 ночи · завтрак включён"
          extras={["Бассейн", "Завтрак", "Free cancel"]}
        />
        <BubbleMsg who="Миша Петров" time="10:42" text="Выглядит топ. Голосую за." />
      </div>
      <div style={{ borderTop: "1px solid var(--line-2)", padding: 10, position: "relative" }}>
        {showMention && (
          <div style={{
            position: "absolute", bottom: "calc(100% + 4px)", left: 10,
            background: "var(--surface)", border: "1px solid var(--line)",
            borderRadius: 10, boxShadow: "var(--shadow-pop)", padding: 6,
            width: 240, zIndex: 5,
          }}>
            <div className="eyebrow" style={{ padding: "4px 8px 6px" }}>Упомянуть</div>
            {[
              { name: "ИИ-помощник", kind: "ai", desc: "@assistant" },
              { name: "Анна Лебедева", desc: "Владелец" },
              { name: "Игорь Мейзинский", desc: "Админ" },
              { name: "Лена Краснова", desc: "Зритель" },
              { name: "Миша Петров", desc: "Админ" },
            ].map((m, i) => (
              <button key={i} onClick={() => { setText(t => t + (m.kind === "ai" ? "assistant " : m.name.split(" ")[0] + " ")); setShowMention(false); }}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", width: "100%", border: "none", background: "transparent", borderRadius: 6, cursor: "pointer", textAlign: "left" }}>
                <Avatar name={m.name} kind={m.kind} size="sm" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 'var(--fs-meta)', fontWeight: 500 }}>{m.name}</div>
                  <div className="muted" style={{ fontSize: 'var(--fs-micro)' }}>{m.desc}</div>
                </div>
              </button>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
          <button className="icon-btn" style={{ width: 32, height: 32 }}><Icon name="paperclip" size={15} /></button>
          <textarea
            className="textarea" placeholder="Сообщение группе… (@упоминание)"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              const last = e.target.value.slice(-1);
              if (last === "@") setShowMention(true);
              else if (last === " " || e.target.value === "") setShowMention(false);
            }}
            style={{ minHeight: 34, maxHeight: 90, padding: "7px 10px", fontSize: 'var(--fs-base)' }}
          />
          <Btn variant="primary" size="sm" icon="send" onClick={() => setText("")} />
        </div>
      </div>
    </>
  );
}

// ----- AI chat mini -----
function AiChatMini() {
  const [text, setText] = useState("");
  return (
    <>
      <div className="dock-panel__head ai-card" style={{ background: "linear-gradient(135deg, var(--ai-soft) 0%, rgba(240,164,90,.08) 100%)" }}>
        <Avatar kind="ai" size="sm" />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 'var(--fs-base)' }} className="ai-text">ИИ-помощник</div>
          <div className="muted" style={{ fontSize: 'var(--fs-micro)' }}>Личный · только ты видишь</div>
        </div>
        <button className="icon-btn" style={{ width: 30, height: 30 }} onClick={() => {}}>
          <Icon name="external" size={14} />
        </button>
      </div>
      <div className="scrollbar-thin" style={{ flex: 1, overflow: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
        <BubbleMsg ai who="ИИ-помощник" time="10:14" text="Привет, Анна. Я знаю всё про это путешествие - спроси что угодно или попроси сделать." />
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {[
            "Какой самый загруженный день?",
            "Найди ужин в Лиссабоне",
            "Раздели перелёт с пересадкой",
          ].map((h, i) => (
            <button key={i} onClick={() => setText(h)} style={{
              padding: "5px 10px", fontSize: 'var(--fs-micro)', borderRadius: 999,
              border: "1px solid var(--ai-soft-12)", background: "var(--ai-soft)",
              color: "var(--ai)", cursor: "pointer",
            }}>{h}</button>
          ))}
        </div>
        <BubbleMsg me text="Найди ужин в Лиссабоне на 14 июля - рыба или морепродукты, средний чек ≤€60/чел." />
        <BubbleMsg ai who="ИИ-помощник" time="10:16" text="Вот что я нашёл рядом с твоим отелем в Альфаме:" />
        <BookingSuggestionCard
          type="activity" name="Cervejaria Ramiro"
          partner="TheFork" url="https://thefork.com/restaurant/ramiro"
          price={48} cur="EUR" rating="4.8"
          sub="Av. Almirante Reis 1 · морепродукты · 12 мин пешком"
          extras={["Brand pick", "Доступно 14.07 в 20:30"]}
        />
        <BookingSuggestionCard
          type="activity" name="A Cevicheria"
          partner="TheFork" url="https://thefork.com/restaurant/a-cevicheria"
          price={58} cur="EUR" rating="4.6"
          sub="Rua Dom Pedro V 129 · перуанская кухня · 18 мин"
        />
      </div>
      <div style={{ borderTop: "1px solid var(--line-2)", padding: 10 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
          <textarea
            className="textarea" placeholder="Спроси или попроси что-то изменить…"
            value={text} onChange={(e) => setText(e.target.value)}
            style={{ minHeight: 34, maxHeight: 90, padding: "7px 10px", fontSize: 'var(--fs-base)' }}
          />
          <Btn variant="ai" size="sm" icon="send" onClick={() => setText("")} />
        </div>
      </div>
    </>
  );
}

export function BubbleMsg({ who, time, text, md, ai, me }) {
  if (me) return (
    <div style={{ display: "flex", justifyContent: "flex-end" }}>
      <div style={{ padding: "7px 11px", background: "var(--brand)", color: "white", fontSize: 'var(--fs-meta)', borderRadius: 12, borderBottomRightRadius: 4, maxWidth: "85%" }}>{text}</div>
    </div>
  );
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <Avatar name={who} kind={ai ? "ai" : undefined} size="sm" />
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 2 }}>
          <span style={{ fontWeight: 600, fontSize: 'var(--fs-micro)', color: ai ? "var(--ai)" : "var(--ink)" }}>{who}</span>
          <span className="muted" style={{ fontSize: 'var(--fs-micro)' }}>{time}</span>
        </div>
        <div style={{
          display: "inline-block", padding: "7px 11px",
          background: ai ? "var(--ai-soft)" : "var(--wash)",
          fontSize: 'var(--fs-meta)', borderRadius: 12, borderBottomLeftRadius: 4, maxWidth: "85%", lineHeight: 1.4,
        }} dangerouslySetInnerHTML={{ __html: md ? text.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>") : text }} />
      </div>
    </div>
  );
}

export default DockedChat;
