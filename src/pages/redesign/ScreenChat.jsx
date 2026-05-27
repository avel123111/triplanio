import React, { useState, useEffect, useRef } from 'react';
import { Icon } from '../../design/icons';
import { Avatar, AvatarStack, Badge, Btn, Card, Field, EmptyState, Skeleton, Toggle,
         fmt, TRIP, TRIPS, ModalHost, Dialog, PartnerLogo, PartnerPill, CityPhoto,
         WeatherChip, RoleBadge, DismissibleSeverity, BookingSuggestionCard,
         TripIdentityStrip } from '../../design/index';

// =====================================================================
// TRIP GROUP CHAT — §24
// =====================================================================

const MEMBERS_FOR_MENTION = [
{ name: "ИИ-помощник", kind: "ai", desc: "@assistant — отвечает всем" },
{ name: "Анна Лебедева", desc: "Владелец" },
{ name: "Игорь Мейзинский", desc: "Админ" },
{ name: "Лена Краснова", desc: "Зритель" },
{ name: "Миша Петров", desc: "Админ" }];


// Chat scenarios — surface different AI states for review
const CHAT_SCENARIOS = [
  { id: "default",    label: "Обычный" },
  { id: "activities", label: "Активности в городе" },
  { id: "edits",      label: "Правки в трип" },
  { id: "think-dots", label: "Думает · точки" },
  { id: "think-bar",  label: "Думает · полоса" },
  { id: "think-typing", label: "Печатает" },
  { id: "think-stream", label: "Стримит ответ" }];


function ScreenChat() {
  const [text, setText] = useState("");
  const [scenario, setScenario] = useState("default");
  const [showMention, setShowMention] = useState(false);

  const isThinking = scenario.startsWith("think");

  return (
    <>
      <TripIdentityStrip compact />

      {/* Scenario switcher for review */}
      <div style={{ marginBottom: 14, padding: 10, background: "var(--wash)", border: "1px solid var(--line-2)", borderRadius: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span className="eyebrow" style={{ marginRight: 4 }}>Сценарий</span>
        <div className="tweaks__seg" style={{ flexWrap: "wrap" }}>
          {CHAT_SCENARIOS.map(s => (
            <button key={s.id} className={scenario === s.id ? "active" : ""} onClick={() => setScenario(s.id)}>{s.label}</button>
          ))}
        </div>
      </div>

      <div style={{
        display: "grid", gridTemplateColumns: "1fr 280px", gap: 20,
        height: "calc(100vh - 300px)", minHeight: 500
      }}>
        {/* Chat area */}
        <div style={{
          background: "var(--surface)", border: "1px solid var(--line)",
          borderRadius: 16, display: "flex", flexDirection: "column", overflow: "hidden",
          position: "relative",
        }}>
          {/* Top thinking bar */}
          {scenario === "think-bar" && <ThinkingTopBar />}

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

            {/* Activities-in-city scenario */}
            {scenario === "activities" && (
              <>
                <Msg who="Лена Краснова" role="viewer" text="@assistant что делать в Порту за наши 3 дня? любим вино и виды." time="11:20" />
                <Msg who="ИИ-помощник" ai text="Собрал короткий список для Порту — по времени дня, чтобы пересечений с переездами не было:" time="11:21" />
                <div style={{ paddingLeft: 38 }}>
                  <ActivityListCard
                    city="Порту"
                    note="3 дня · 6 идей · можно перетащить любую в таймлайн"
                    items={[
                      { day: "Чт 16 июл", time: "16:30", name: "Прогулка по Ribeira", duration: "~1.5 ч", tag: "лёгкое" },
                      { day: "Чт 16 июл", time: "19:30", name: "Закат на мосту Луиша I", duration: "~45 мин", tag: "виды" },
                      { day: "Пт 17 июл", time: "11:30", name: "Livraria Lello — забронированный визит", duration: "~1 ч", tag: "must-see" },
                      { day: "Пт 17 июл", time: "16:00", name: "Дегустация портвейна в Taylor's", duration: "~1.5 ч", tag: "вино" },
                      { day: "Пт 17 июл", time: "20:00", name: "Ужин в Tapabento", duration: "~2 ч", tag: "еда" },
                      { day: "Сб 18 июл", time: "10:00", name: "Capela das Almas + Bolhão market", duration: "~2 ч", tag: "архитектура" },
                    ]}
                  />
                </div>
              </>
            )}

            {/* Trip-edits scenario */}
            {scenario === "edits" && (
              <>
                <Msg who="Анна Лебедева" role="owner" text="@assistant у нас Lisbon коротко получается. Подвинь, чтобы было +1 день в Lisbon и -1 в Барселоне." time="12:02" />
                <Msg who="ИИ-помощник" ai text="Готов внести три правки в трип. Посмотрите перед применением:" time="12:03" />
                <div style={{ paddingLeft: 38 }}>
                  <TripEditProposalCard />
                </div>
              </>
            )}

            {/* Thinking variants */}
            {scenario === "think-dots" && <ThinkingDots />}
            {scenario === "think-typing" && <ThinkingTyping />}
            {scenario === "think-stream" && <ThinkingStream />}
          </div>

          {/* Input with @mention dropdown */}
          <div style={{ borderTop: "1px solid var(--line-2)", padding: 12, position: "relative" }}>
            {/* Inline thinking strip — variant: live status above input */}
            {scenario === "think-typing" && <InlineTypingStrip />}

            {showMention &&
            <div style={{
              position: "absolute", bottom: "calc(100% + 4px)", left: 12,
              background: "var(--surface)", border: "1px solid var(--line)",
              borderRadius: 12, boxShadow: "var(--shadow-pop)", padding: 6,
              width: 280, zIndex: 5
            }}>
                <div className="eyebrow" style={{ padding: "6px 10px 8px" }}>Упомянуть</div>
                {MEMBERS_FOR_MENTION.map((m, i) =>
              <button key={i} onClick={() => {setText((t) => t.replace(/@$/, "@" + (m.kind === "ai" ? "assistant " : m.name.split(" ")[0] + " ")));setShowMention(false);}}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", width: "100%", border: "none", background: "transparent", borderRadius: 7, cursor: "pointer", textAlign: "left" }}
              onMouseEnter={(e) => e.currentTarget.style.background = "var(--wash)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                    <Avatar name={m.name} kind={m.kind} size="sm" />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: m.kind === "ai" ? "var(--ai)" : "var(--ink)" }}>{m.name}</div>
                      <div className="muted" style={{ fontSize: 11.5 }}>{m.desc}</div>
                    </div>
                  </button>
              )}
              </div>
            }
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <button className="icon-btn" title="Прикрепить"><Icon name="paperclip" size={17} /></button>
              <textarea
                className="textarea" placeholder="Напиши сообщение — @упоминание открывает выбор"
                value={text}
                disabled={isThinking}
                onChange={(e) => {
                  setText(e.target.value);
                  const last = e.target.value.slice(-1);
                  if (last === "@") setShowMention(true);else
                  if (last === " " || e.target.value === "") setShowMention(false);
                }}
                style={{ minHeight: 38, maxHeight: 120, flex: 1, padding: "8px 12px" }} />
              
              <Btn variant="primary" icon="send" onClick={() => setText("")} disabled={isThinking}>Отправить</Btn>
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
              <li>Предлагает отели, перелёты, активности</li>
              <li>Может править трип — с согласия владельца</li>
              <li>Личный диалог — <a href="#" onClick={() => window.__navigate?.("ai")}>ИИ-помощник</a></li>
            </ul>
          </Card>
        </aside>
      </div>
    </>);

}

function DateDivider({ date }) {
  return (
    <div style={{ textAlign: "center", margin: "12px 0", fontSize: 11, color: "var(--muted-2)", textTransform: "uppercase", letterSpacing: ".1em" }}>
      <span style={{ background: "var(--wash)", padding: "3px 10px", borderRadius: 999 }}>{date}</span>
    </div>);

}

function Msg({ who, role, ai, text, time, md, grouped }) {
  return (
    <div style={{ display: "flex", gap: 10, marginTop: grouped ? 2 : 0 }}>
      <div style={{ width: 30, flexShrink: 0 }}>
        {!grouped && <Avatar name={who} kind={ai ? "ai" : undefined} />}
      </div>
      <div style={{ flex: 1 }}>
        {!grouped &&
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 3 }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: ai ? "var(--ai)" : "var(--ink)" }}>{who}</span>
            <span className="muted" style={{ fontSize: 11 }}>{time}</span>
          </div>
        }
        <div style={{
          display: "inline-block",
          padding: "8px 12px",
          background: ai ? "var(--ai-soft)" : "var(--wash)",
          color: "var(--ink)",
          fontSize: 13.5,
          borderRadius: 10,
          maxWidth: "78%",
          lineHeight: 1.45
        }} dangerouslySetInnerHTML={{ __html: md ? text.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/@(\w+)/g, '<span style="color:var(--brand);font-weight:500">@$1</span>') : text.replace(/@(\w+)/g, '<span style="color:var(--brand);font-weight:500">@$1</span>') }} />
      </div>
    </div>);

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
    </div>);

}

// =====================================================================
// ACTIVITY LIST CARD — AI-suggested activities in a city
// =====================================================================
function ActivityListCard({ city, note, items }) {
  const [picked, setPicked] = useState(new Set([0, 2, 3]));
  const toggle = (i) => {
    setPicked(p => {
      const n = new Set(p);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });
  };
  return (
    <div style={{
      background: "var(--surface)",
      border: "1.5px solid var(--ai-soft-12)",
      borderRadius: 12,
      maxWidth: 460,
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        padding: "12px 14px",
        background: "var(--ai-soft)",
        borderBottom: "1px solid var(--ai-soft-12)",
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: "var(--ai)", color: "white", display: "grid", placeItems: "center" }}>
          <Icon name="cam" size={14} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ai)" }}>Активности · {city}</div>
          <div className="muted" style={{ fontSize: 11.5 }}>{note}</div>
        </div>
        <Badge variant="quiet">{picked.size}/{items.length}</Badge>
      </div>

      {/* List */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {items.map((a, i) => {
          const isPicked = picked.has(i);
          const prevDay = i > 0 ? items[i - 1].day : null;
          const showDay = a.day !== prevDay;
          return (
            <React.Fragment key={i}>
              {showDay && (
                <div className="eyebrow" style={{
                  padding: "8px 14px 4px", background: "var(--wash)",
                  borderTop: i > 0 ? "1px solid var(--line-2)" : "none",
                  fontSize: 10.5,
                }}>{a.day}</div>
              )}
              <button onClick={() => toggle(i)} style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "10px 14px",
                background: isPicked ? "var(--brand-soft)" : "transparent",
                border: "none", textAlign: "left", cursor: "pointer",
                borderBottom: i < items.length - 1 ? "1px solid var(--line-2)" : "none",
              }}>
                <div style={{
                  width: 22, height: 22, borderRadius: 6,
                  background: isPicked ? "var(--brand)" : "var(--surface)",
                  border: "1.5px solid " + (isPicked ? "var(--brand)" : "var(--line)"),
                  color: "white",
                  display: "grid", placeItems: "center", flexShrink: 0,
                }}>
                  {isPicked && <Icon name="check" size={12} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>{a.name}</div>
                  <div className="muted num" style={{ fontSize: 11, marginTop: 1, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <span>{a.time}</span>
                    <span style={{ color: "var(--muted-2)" }}>·</span>
                    <span>{a.duration}</span>
                    {a.tag && <>
                      <span style={{ color: "var(--muted-2)" }}>·</span>
                      <span style={{ color: "var(--warm)", fontWeight: 500 }}>{a.tag}</span>
                    </>}
                  </div>
                </div>
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {/* Footer actions */}
      <div style={{
        padding: 10,
        borderTop: "1px solid var(--line-2)",
        background: "var(--wash)",
        display: "flex", gap: 6, alignItems: "center",
      }}>
        <span className="muted" style={{ fontSize: 11.5, flex: 1 }}>
          Выбери, что добавить — остальное останется идеей в чате.
        </span>
        <Btn variant="ghost" size="sm">Свернуть</Btn>
        <Btn variant="ai" size="sm" icon="plus" disabled={picked.size === 0}>
          Добавить {picked.size} в трип
        </Btn>
      </div>
    </div>
  );
}

// =====================================================================
// TRIP EDIT PROPOSAL CARD — AI suggests trip edits in chat
// =====================================================================
function TripEditProposalCard() {
  const [edits, setEdits] = useState([
    { id: 1, op: "extend", what: "Лиссабон", detail: "3 → 4 ночи (продлить выезд)", icon: "bed", color: "var(--success)", approved: true },
    { id: 2, op: "shrink", what: "Барселона", detail: "4 → 3 ночи (раньше выезд)", icon: "bed", color: "var(--warning)", approved: true },
    { id: 3, op: "shift", what: "Переезд CP IC 521", detail: "16 → 17 июля, 14:25", icon: "train", color: "var(--brand)", approved: true },
  ]);
  const toggle = (id) => setEdits(es => es.map(e => e.id === id ? { ...e, approved: !e.approved } : e));
  const approvedCount = edits.filter(e => e.approved).length;

  return (
    <div style={{
      background: "var(--surface)",
      border: "1.5px solid var(--ai-soft-12)",
      borderRadius: 12,
      maxWidth: 460,
      overflow: "hidden",
    }}>
      <div style={{
        padding: "12px 14px",
        background: "var(--ai-soft)",
        borderBottom: "1px solid var(--ai-soft-12)",
        display: "flex", alignItems: "center", gap: 10,
      }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: "var(--ai)", color: "white", display: "grid", placeItems: "center" }}>
          <Icon name="sparkles" size={14} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ai)" }}>Предлагаемые правки в трип</div>
          <div className="muted" style={{ fontSize: 11.5 }}>Перенесёт даты выезда и переезд между Лиссабоном и Порту.</div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        {edits.map((e, i) => (
          <label key={e.id} style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "10px 14px",
            cursor: "pointer",
            borderBottom: i < edits.length - 1 ? "1px solid var(--line-2)" : "none",
            background: e.approved ? "transparent" : "var(--wash)",
          }}>
            <input type="checkbox" checked={e.approved} onChange={() => toggle(e.id)} style={{ flexShrink: 0 }} />
            <div style={{
              width: 28, height: 28, borderRadius: 7,
              background: e.color + "22", color: e.color,
              display: "grid", placeItems: "center", flexShrink: 0,
            }}>
              <Icon name={e.icon} size={13} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: e.approved ? "var(--ink)" : "var(--muted)" }}>{e.what}</div>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 1 }}>{e.detail}</div>
            </div>
            <Badge variant={e.op === "extend" ? "success" : e.op === "shrink" ? "warning" : "quiet"}>
              {e.op === "extend" ? "+1 ночь" : e.op === "shrink" ? "−1 ночь" : "сдвиг"}
            </Badge>
          </label>
        ))}
      </div>

      <div style={{
        padding: 10,
        borderTop: "1px solid var(--line-2)",
        background: "var(--wash)",
        display: "flex", gap: 6, alignItems: "center",
      }}>
        <span className="muted" style={{ fontSize: 11.5, flex: 1 }}>
          Применит выбранные {approvedCount} из {edits.length}.
        </span>
        <Btn variant="ghost" size="sm">Отклонить</Btn>
        <Btn variant="ai" size="sm" icon="check" disabled={approvedCount === 0}>
          Применить
        </Btn>
      </div>
    </div>
  );
}

// =====================================================================
// AI THINKING — variant components
// =====================================================================
function ThinkingDots() {
  return (
    <div style={{ display: "flex", gap: 10 }}>
      <Avatar kind="ai" />
      <div style={{
        padding: "10px 14px", background: "var(--ai-soft)", borderRadius: 10,
        color: "var(--ai)", display: "flex", alignItems: "center", gap: 8, fontSize: 13,
        animation: "pulse 1.4s ease-in-out infinite",
      }}>
        <span>ИИ думает</span>
        <span className="ai-dots"><span /><span /><span /></span>
      </div>
    </div>
  );
}

function ThinkingTyping() {
  return (
    <div style={{ display: "flex", gap: 10 }}>
      <Avatar kind="ai" />
      <div style={{
        padding: "10px 14px", background: "var(--ai-soft)", borderRadius: 10,
        display: "inline-flex", alignItems: "center", gap: 3,
      }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--ai)", animation: "blinkdot 1.2s 0s infinite ease-in-out" }} />
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--ai)", animation: "blinkdot 1.2s .15s infinite ease-in-out" }} />
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--ai)", animation: "blinkdot 1.2s .3s infinite ease-in-out" }} />
      </div>
    </div>
  );
}

function ThinkingStream() {
  // Simulated streaming first-sentence preview
  return (
    <div style={{ display: "flex", gap: 10 }}>
      <Avatar kind="ai" />
      <div style={{ flex: 1, maxWidth: "78%" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 3 }}>
          <span style={{ fontWeight: 600, fontSize: 13, color: "var(--ai)" }}>ИИ-помощник</span>
          <span className="muted" style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--ai)", animation: "pulse 1s infinite" }} />
            пишет…
          </span>
        </div>
        <div style={{
          padding: "8px 12px",
          background: "var(--ai-soft)",
          color: "var(--ink)",
          fontSize: 13.5,
          borderRadius: 10,
          lineHeight: 1.45,
        }}>
          Собираю подборку отелей в Барселоне в твоём бюджете — рейтинг 8.5+, с завтраком<span style={{ animation: "pulse 1s infinite", marginLeft: 1, fontWeight: 700 }}>▍</span>
        </div>
      </div>
    </div>
  );
}

function ThinkingTopBar() {
  return (
    <div style={{
      position: "absolute", left: 0, right: 0, top: 0, height: 3,
      background: "linear-gradient(90deg, transparent, var(--ai) 50%, transparent)",
      backgroundSize: "200% 100%",
      animation: "shimmer 1.6s linear infinite",
      zIndex: 5,
    }} />
  );
}

function InlineTypingStrip() {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "6px 10px 8px",
      fontSize: 11.5, color: "var(--ai)",
    }}>
      <Avatar kind="ai" size="sm" />
      <span style={{ fontWeight: 500 }}>ИИ-помощник печатает</span>
      <span className="ai-dots"><span /><span /><span /></span>
    </div>
  );
}

export default ScreenChat;
