import React, { useState } from 'react';
import { Icon } from '../../design/icons';
import { BubbleMsg } from '../../design/dock';
import { Avatar, Card, Btn, BookingSuggestionCard, TRIP } from '../../design/index';

// =====================================================================
// TRIP GROUP CHAT — §24
// =====================================================================

const MEMBERS_FOR_MENTION = [
  { name: "ИИ-помощник", kind: "ai", desc: "@assistant — отвечает всем" },
  { name: "Анна Лебедева", desc: "Владелец" },
  { name: "Игорь Мейзинский", desc: "Админ" },
  { name: "Лена Краснова", desc: "Зритель" },
  { name: "Миша Петров", desc: "Админ" },
];

function ScreenChat() {
  const [text, setText] = useState("");
  const [aiThinking, setAiThinking] = useState(false);
  const [showMention, setShowMention] = useState(false);

  return (
    <>
      <div style={{marginBottom: 22, paddingBottom: 16, borderBottom: "1px solid var(--line-2)", display:"flex", alignItems:"center", gap:10}}>
        <h2 style={{flex:1}}>{TRIP.title}</h2>
        <span style={{fontSize:12, color:"var(--muted)"}}>12 июл → 23 июл · 2026</span>
      </div>

      <div style={{
        display: "grid", gridTemplateColumns: "1fr 280px", gap: 20,
        height: "calc(100vh - 240px)", minHeight: 500,
      }}>
        {/* Chat area */}
        <div style={{
          background: "var(--surface)", border: "1px solid var(--line)",
          borderRadius: 16, display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--line-2)", display: "flex", alignItems: "center", gap: 10 }}>
            <h3 style={{ flex: 1, marginBottom: 0 }}>Групповой чат</h3>
            <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--success)", fontSize: 12 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--success)" }} />
              4 в сети
            </div>
          </div>

          <div className="scrollbar-thin" style={{ flex: 1, overflow: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
            <DateDivider date="12 июня" />
            <Msg who="Анна Лебедева" role="owner" text="Закинула черновик плана — посмотрите города и даты, пожалуйста." time="14:22" />
            <Msg who="Анна Лебедева" role="owner" text="Можем растянуть Барселону на день, если хотите." time="14:22" grouped />
            <Msg who="Игорь Мейзинский" role="admin" text="Лиссабон выглядит коротко. **3 дня** маловато на Sintra + Belém + город." md time="15:08" />
            <Msg who="Лена Краснова" role="viewer" text="Я только за дольше в Лиссабоне. И Эшторил можно вписать." time="15:11" />

            <DateDivider date="13 июня" />
            <Msg who="Анна Лебедева" role="owner" text="@assistant найди нам хороший отель в Барселоне на 4 ночи, рейтинг 8.5+, с завтраком, до €350 в ночь." time="10:14" />
            <Msg who="ИИ-помощник" ai text="Вот три варианта рядом с твоим планом маршрута:" time="10:14" />
            {/* AI booking suggestions */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingLeft: 38 }}>
              <BookingSuggestionCard type="hotel" name="Cotton House Hotel" partner="Booking.com" url="https://booking.com/cotton-house"
                price={335} cur="EUR" rating="9.1" sub="Gran Via 670 · 4 ночи · завтрак" extras={["Бассейн", "Free cancel"]} />
              <BookingSuggestionCard type="hotel" name="Hotel Casa Fuster" partner="Booking.com" url="https://booking.com/casa-fuster"
                price={298} cur="EUR" rating="8.9" sub="Passeig de Gràcia 132 · 4 ночи · завтрак" extras={["Терраса"]} />
              <BookingSuggestionCard type="hotel" name="Yurbban Trafalgar" partner="Booking.com" url="https://booking.com/yurbban"
                price={245} cur="EUR" rating="8.6" sub="Trafalgar 30 · 4 ночи · завтрак" />
            </div>

            <Msg who="Игорь Мейзинский" role="admin" text="Cotton House — топ. За." time="10:30" />
            <Msg who="Миша Петров" role="admin" text="Поддерживаю. Я хотел поужинать в одном месте на Tejo — туда полдня уйдёт." time="10:42" />
            {aiThinking && (
              <div style={{ display: "flex", gap: 10 }}>
                <Avatar kind="ai" />
                <div style={{ padding: "10px 14px", background: "var(--ai-soft)", borderRadius: 10, color: "var(--ai)", display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                  <span>ИИ думает</span>
                  <span className="ai-dots"><span /><span /><span /></span>
                </div>
              </div>
            )}
          </div>

          {/* Input with @mention dropdown */}
          <div style={{ borderTop: "1px solid var(--line-2)", padding: 12, position: "relative" }}>
            {showMention && (
              <div style={{
                position: "absolute", bottom: "calc(100% + 4px)", left: 12,
                background: "var(--surface)", border: "1px solid var(--line)",
                borderRadius: 12, boxShadow: "var(--shadow-pop)", padding: 6,
                width: 280, zIndex: 5,
              }}>
                <div className="eyebrow" style={{ padding: "6px 10px 8px" }}>Упомянуть</div>
                {MEMBERS_FOR_MENTION.map((m, i) => (
                  <button key={i} onClick={() => { setText(t => t.replace(/@$/, "@" + (m.kind === "ai" ? "assistant " : m.name.split(" ")[0] + " "))); setShowMention(false); }}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", width: "100%", border: "none", background: "transparent", borderRadius: 7, cursor: "pointer", textAlign: "left" }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "var(--wash)"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                    <Avatar name={m.name} kind={m.kind} size="sm" />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: m.kind === "ai" ? "var(--ai)" : "var(--ink)" }}>{m.name}</div>
                      <div className="muted" style={{ fontSize: 11.5 }}>{m.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <button className="icon-btn" title="Прикрепить"><Icon name="paperclip" size={17} /></button>
              <textarea
                className="textarea" placeholder="Напиши сообщение — @упоминание открывает выбор"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  const last = e.target.value.slice(-1);
                  if (last === "@") setShowMention(true);
                  else if (last === " " || e.target.value === "") setShowMention(false);
                }}
                style={{ minHeight: 38, maxHeight: 120, flex: 1, padding: "8px 12px" }}
              />
              <Btn variant="primary" icon="send" onClick={() => {
                if (text.includes("@assistant")) { setAiThinking(true); setTimeout(() => setAiThinking(false), 1800); }
                setText("");
              }}>Отправить</Btn>
            </div>
          </div>
        </div>

        {/* Right sidebar — participants + hints */}
        <aside style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Card title="Участники чата">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <ChatMember name="Анна Лебедева" role="Владелец" online />
              <ChatMember name="Игорь Мейзинский" role="Админ" online />
              <ChatMember name="Лена Краснова" role="Зритель" online />
              <ChatMember name="Миша Петров" role="Админ" pending />
              <div style={{ borderTop: "1px solid var(--line-2)", paddingTop: 8, marginTop: 4 }}>
                <ChatMember name="ИИ-помощник" role="@assistant — общий" ai />
              </div>
            </div>
          </Card>
          <Card variant="soft" title="Что умеет @assistant">
            <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 12.5, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 6 }}>
              <li>Отвечает всем участникам</li>
              <li>Может предлагать отели, перелёты, рестораны</li>
              <li>Личный диалог — <a href="#" onClick={(e) => e.preventDefault()}>ИИ-помощник</a></li>
            </ul>
          </Card>
        </aside>
      </div>
    </>
  );
}

function DateDivider({ date }) {
  return (
    <div style={{ textAlign: "center", margin: "12px 0", fontSize: 11, color: "var(--muted-2)", textTransform: "uppercase", letterSpacing: ".1em" }}>
      <span style={{ background: "var(--wash)", padding: "3px 10px", borderRadius: 999 }}>{date}</span>
    </div>
  );
}

function Msg({ who, role, ai, text, time, md, grouped }) {
  return (
    <div style={{ display: "flex", gap: 10, marginTop: grouped ? 2 : 0 }}>
      <div style={{ width: 30, flexShrink: 0 }}>
        {!grouped && <Avatar name={who} kind={ai ? "ai" : undefined} />}
      </div>
      <div style={{ flex: 1 }}>
        {!grouped && (
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 3 }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: ai ? "var(--ai)" : "var(--ink)" }}>{who}</span>
            <span className="muted" style={{ fontSize: 11 }}>{time}</span>
          </div>
        )}
        <div style={{
          display: "inline-block",
          padding: "8px 12px",
          background: ai ? "var(--ai-soft)" : "var(--wash)",
          color: "var(--ink)",
          fontSize: 13.5,
          borderRadius: 10,
          maxWidth: "78%",
          lineHeight: 1.45,
        }} dangerouslySetInnerHTML={{ __html: md ? text.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/@(\w+)/g, '<span style="color:var(--brand);font-weight:500">@$1</span>') : text.replace(/@(\w+)/g, '<span style="color:var(--brand);font-weight:500">@$1</span>') }} />
      </div>
    </div>
  );
}

function ChatMember({ name, role, online, pending, ai }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ position: "relative" }}>
        <Avatar name={name} kind={ai ? "ai" : undefined} size="sm" />
        {online && <span style={{ position: "absolute", bottom: -1, right: -1, width: 8, height: 8, borderRadius: "50%", background: "var(--success)", border: "2px solid var(--surface)" }} />}
        {pending && <span style={{ position: "absolute", bottom: -1, right: -1, width: 8, height: 8, borderRadius: "50%", background: "var(--warning)", border: "2px solid var(--surface)" }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500 }}>{name}</div>
        <div className="muted" style={{ fontSize: 11 }}>{role}</div>
      </div>
    </div>
  );
}

export default ScreenChat;
