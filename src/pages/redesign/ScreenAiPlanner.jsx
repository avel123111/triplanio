import React, { useState } from 'react';
import { Icon } from '../../design/icons';
import { Btn, Badge, Avatar, Card, Field, Skeleton, EmptyState, TRIP } from '../../design/index';

// =====================================================================
// AI PLANNER from scratch (§20)
// =====================================================================

const SAMPLE_PROMPT = "Хочу 10–12 дней по Иберии в середине июля. Мы вчетвером, любим вино, архитектуру и хорошую еду. Не больше 3 городов. Финиш в Барселоне, чтобы вылететь оттуда.";

function ScreenAiPlanner() {
  const [state, setState] = useState("draft"); // empty | generating | draft | saving | error
  const [prompt, setPrompt] = useState(SAMPLE_PROMPT);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 24 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: "linear-gradient(135deg, var(--ai), #c66ce2)", color: "white", display: "grid", placeItems: "center" }}>
          <Icon name="sparkles" size={22} />
        </div>
        <div style={{ flex: 1 }}>
          <h1 style={{ marginBottom: 6 }}>Спланировать с ИИ</h1>
          <div className="muted" style={{ fontSize: 15 }}>Опиши, какой трип хочешь — соберу черновик и доработаем вместе.</div>
        </div>
        <Btn variant="ghost" icon="refresh">Начать заново</Btn>
      </div>

      {/* State controls */}
      <div className="tweaks__seg" style={{ marginBottom: 18 }}>
        {[["empty", "Пусто"], ["generating", "Генерация"], ["draft", "Черновик"], ["saving", "Сохранение"]].map(([k, l]) => (
          <button key={k} className={state === k ? "active" : ""} onClick={() => setState(k)}>{l}</button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {/* Left: prompt + conversation */}
        <div>
          <div style={{
            background: "var(--surface)", border: "1.5px solid var(--ai-soft-12)", borderRadius: 14,
            padding: 16, marginBottom: 14,
          }}>
            <textarea
              className="textarea"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              style={{ minHeight: 120, border: "none", padding: 0, background: "transparent", fontSize: 15, lineHeight: 1.55 }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
              {state === "empty" ? (
                <Btn variant="primary" icon="sparkles" onClick={() => setState("generating")}>Сгенерировать черновик</Btn>
              ) : state === "generating" ? (
                <Btn variant="primary" disabled>ИИ думает <span className="ai-dots" style={{ marginLeft: 6, color: "white" }}><span /><span /><span /></span></Btn>
              ) : (
                <Btn variant="ai" icon="refresh">Перегенерировать с учётом</Btn>
              )}
            </div>
          </div>

          {state === "draft" && (
            <div style={{ padding: 14, background: "var(--ai-soft)", borderRadius: 12, fontSize: 13.5, color: "var(--ink)", lineHeight: 1.55 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <Avatar kind="ai" size="sm" /> <b>ИИ-помощник</b>
              </div>
              Собрал для вас черновик 11 дней по 3 городам Португалии и Испании. Финиш в Барселоне. Учёл винные паузы в Алентежу-стайл (Sintra) и северной Дору, и архитектурный день Гауди в Барсе. Если нужно — можно добавить день в Сан-Себастьян или поменять старт на Севилью.
            </div>
          )}

          {state === "saving" && (
            <div style={{ padding: 14, background: "var(--brand-soft)", borderRadius: 12, fontSize: 13, color: "var(--ink)" }}>
              <Icon name="refresh" size={14} style={{ verticalAlign: -2, marginRight: 6 }} /> Создаю реальный трип — это займёт пару секунд. Города, переезды и активности материализуются в редактируемый трип.
            </div>
          )}
        </div>

        {/* Right: draft preview */}
        <div>
          {state === "empty" && (
            <div style={{
              border: "1.5px dashed var(--line)", borderRadius: 14, padding: 32, textAlign: "center", color: "var(--muted)", minHeight: 320,
              display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 8,
            }}>
              <Icon name="sparkles" size={28} style={{ color: "var(--ai)" }} />
              <div>Черновик появится здесь после генерации</div>
              <div style={{ fontSize: 12, maxWidth: 280, marginTop: 4 }}>Можешь дать ИИ конкретику: даты, города, бюджет, темп, темы (еда / архитектура / природа).</div>
            </div>
          )}

          {state === "generating" && (
            <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="ai-dots" style={{ color: "var(--ai)", textAlign: "center", padding: "30px 0" }}><span /><span /><span /></div>
              {[0, 1, 2].map(i => (
                <div key={i} style={{ display: "flex", gap: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--wash)" }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ height: 12, borderRadius: 4, background: "var(--wash)", width: "60%", marginBottom: 5 }} />
                    <div style={{ height: 9, borderRadius: 4, background: "var(--wash)", width: "40%" }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {(state === "draft" || state === "saving") && (
            <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, padding: 18 }}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Черновик трипа · 11 дней</div>
              <h2 style={{ marginBottom: 14 }}>Иберия летом</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
                {[
                  { city: "Лиссабон", dates: "12 → 16 июл", n: 4, act: ["Pastéis de Belém", "Castelo São Jorge", "Sintra wine tour"] },
                  { city: "Порту", dates: "16 → 19 июл", n: 3, act: ["Sandeman дегустация", "Кафе Majestic"] },
                  { city: "Барселона", dates: "19 → 23 июл", n: 4, act: ["Sagrada Família", "Парк Гуэль", "El Born"] },
                ].map((c, i) => (
                  <div key={i} style={{ padding: 12, border: "1px solid var(--line-2)", borderRadius: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--brand)", color: "white", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 600 }}>{i + 1}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{c.city}</div>
                        <div className="muted num" style={{ fontSize: 12 }}>{c.dates} · {c.n} ночей</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, marginLeft: 32 }}>
                      {c.act.map((a, j) => <Badge key={j} variant="quiet">{a}</Badge>)}
                    </div>
                  </div>
                ))}
              </div>
              <Btn variant="primary" block icon="check" disabled={state === "saving"} onClick={() => setState("saving")}>
                {state === "saving" ? "Создаю трип…" : "Сохранить как реальный трип"}
              </Btn>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ScreenAiPlanner;
