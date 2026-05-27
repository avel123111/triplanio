import React, { useState, useEffect, useRef } from 'react';
import { Icon } from '../../design/icons';
import { Avatar, AvatarStack, Badge, Btn, Card, Field, EmptyState, Skeleton, Toggle,
         fmt, TRIP, TRIPS, ModalHost, Dialog, PartnerLogo, PartnerPill, CityPhoto,
         WeatherChip, RoleBadge, DismissibleSeverity, BookingSuggestionCard } from '../../design/index';

// =====================================================================
// AI PLANNER from scratch (§20)
// Layout: prompt-first top bar + wide map hero + scalable city list below.
// Includes 3-city / 7-city demo toggle so reviewers can stress-test layout.
// =====================================================================

const SAMPLE_PROMPT = "Хочу 10–12 дней по Иберии в середине июля. Мы вчетвером, любим вино, архитектуру и хорошую еду. Не больше 3 городов. Финиш в Барселоне, чтобы вылететь оттуда.";

const CITIES_3 = [
  { city: "Лиссабон", country: "🇵🇹 Португалия", dates: "12 → 16 июл", n: 4, lat: 38.72, lng: -9.14,
    activities: [
      { day: "12 июл", time: "16:00", name: "Заселение в Memmo Alfama" },
      { day: "13 июл", time: "10:00", name: "Прогулка по Alfama + трамвай 28" },
      { day: "13 июл", time: "15:30", name: "Pastéis de Belém — pastry crawl" },
      { day: "14 июл", time: "10:30", name: "Sintra — Pena Palace" },
      { day: "14 июл", time: "16:00", name: "Дегустация вин в Quinta" },
      { day: "15 июл", time: "20:30", name: "Ужин и фаду в LX Factory" }] },
  { city: "Порту", country: "🇵🇹 Португалия", dates: "16 → 19 июл", n: 3, lat: 41.15, lng: -8.61,
    activities: [
      { day: "16 июл", time: "16:30", name: "Прогулка по Ribeira" },
      { day: "17 июл", time: "11:00", name: "Livraria Lello" },
      { day: "17 июл", time: "16:00", name: "Sandeman — портвейн" },
      { day: "18 июл", time: "10:00", name: "Долина Дору — винный тур" },
      { day: "18 июл", time: "20:00", name: "Ужин в Tapabento" }] },
  { city: "Барселона", country: "🇪🇸 Испания", dates: "19 → 23 июл", n: 4, lat: 41.39, lng: 2.17,
    activities: [
      { day: "19 июл", time: "18:00", name: "Заселение, El Born" },
      { day: "20 июл", time: "10:30", name: "Sagrada Família" },
      { day: "20 июл", time: "16:00", name: "Casa Batlló" },
      { day: "21 июл", time: "09:00", name: "Park Güell — утренний слот" },
      { day: "21 июл", time: "19:30", name: "Тапас-крол в El Born" },
      { day: "22 июл", time: "20:30", name: "Ужин в Disfrutar" }] }];


const CITIES_7 = [
  { city: "Лиссабон", country: "🇵🇹 Португалия", dates: "10 → 13 июл", n: 3, lat: 38.72, lng: -9.14,
    activities: [
      { day: "10 июл", time: "16:00", name: "Заселение в Memmo Alfama" },
      { day: "11 июл", time: "10:00", name: "Alfama + трамвай 28" },
      { day: "12 июл", time: "10:30", name: "Sintra — Pena Palace" }] },
  { city: "Порту", country: "🇵🇹 Португалия", dates: "13 → 15 июл", n: 2, lat: 41.15, lng: -8.61,
    activities: [
      { day: "13 июл", time: "16:30", name: "Прогулка по Ribeira" },
      { day: "14 июл", time: "11:00", name: "Livraria Lello" },
      { day: "14 июл", time: "16:00", name: "Дегустация портвейна" }] },
  { city: "Мадрид", country: "🇪🇸 Испания", dates: "15 → 17 июл", n: 2, lat: 40.42, lng: -3.70,
    activities: [
      { day: "15 июл", time: "19:00", name: "Ужин в Botín" },
      { day: "16 июл", time: "10:00", name: "Прадо" }] },
  { city: "Барселона", country: "🇪🇸 Испания", dates: "17 → 20 июл", n: 3, lat: 41.39, lng: 2.17,
    activities: [
      { day: "17 июл", time: "18:00", name: "El Born прогулка" },
      { day: "18 июл", time: "10:30", name: "Sagrada Família" },
      { day: "19 июл", time: "09:00", name: "Park Güell" }] },
  { city: "Марсель", country: "🇫🇷 Франция", dates: "20 → 22 июл", n: 2, lat: 43.30, lng: 5.37,
    activities: [
      { day: "20 июл", time: "17:00", name: "Старый порт" },
      { day: "21 июл", time: "10:00", name: "Calanques de Marseille" }] },
  { city: "Ницца", country: "🇫🇷 Франция", dates: "22 → 24 июл", n: 2, lat: 43.71, lng: 7.26,
    activities: [
      { day: "22 июл", time: "18:00", name: "Promenade des Anglais" },
      { day: "23 июл", time: "10:30", name: "Старый город Ниццы" }] },
  { city: "Рим", country: "🇮🇹 Италия", dates: "24 → 26 июл", n: 2, lat: 41.90, lng: 12.49,
    activities: [
      { day: "25 июл", time: "10:00", name: "Колизей и форум" },
      { day: "25 июл", time: "19:30", name: "Ужин в Trastevere" }] }];


const LAYOUTS = [
  { id: "L1", label: "Top-bar + hero map" },
  { id: "L2", label: "Map-hero overlay" },
  { id: "L3", label: "Original 50/50" }];


function ScreenAiPlanner() {
  const [state, setState] = useState("draft");
  const [prompt, setPrompt] = useState(SAMPLE_PROMPT);
  const [layout, setLayout] = useState("L1");
  const [cityCount, setCityCount] = useState("3");
  const cities = cityCount === "7" ? CITIES_7 : CITIES_3;
  const totalNights = cities.reduce((s, c) => s + c.n, 0);
  const totalActivities = cities.reduce((s, c) => s + c.activities.length, 0);

  const showDraft = state === "draft" || state === "saving";

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 18, flexWrap: "wrap" }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: "linear-gradient(135deg, var(--ai), #c66ce2)", color: "white", display: "grid", placeItems: "center" }}>
          <Icon name="sparkles" size={22} />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h1 style={{ marginBottom: 6 }}>Спланировать с ИИ</h1>
          <div className="muted" style={{ fontSize: 15 }}>Опиши, какой трип хочешь — соберу черновик и доработаем вместе.</div>
        </div>
        <Btn variant="ghost" icon="refresh">Начать заново</Btn>
      </div>

      {/* State + layout + city-count switchers */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 18, flexWrap: "wrap" }}>
        <span className="eyebrow" style={{ marginRight: 4 }}>Состояние</span>
        <div className="tweaks__seg">
          {[["empty", "Пусто"], ["generating", "Генерация"], ["draft", "Черновик"], ["saving", "Сохранение"]].map(([k, l]) =>
            <button key={k} className={state === k ? "active" : ""} onClick={() => setState(k)}>{l}</button>
          )}
        </div>
        <span className="eyebrow" style={{ marginRight: 4, marginLeft: 14 }}>Layout</span>
        <div className="tweaks__seg" style={{ background: "var(--wash)" }}>
          {LAYOUTS.map(L =>
            <button key={L.id} className={layout === L.id ? "active" : ""} onClick={() => setLayout(L.id)}>{L.label}</button>
          )}
        </div>
        <span className="eyebrow" style={{ marginRight: 4, marginLeft: 14 }}>Демо</span>
        <div className="tweaks__seg" style={{ background: "var(--wash)" }}>
          {["3", "7"].map(c =>
            <button key={c} className={cityCount === c ? "active" : ""} onClick={() => setCityCount(c)}>{c} городов</button>
          )}
        </div>
      </div>

      {/* L3 has its own consistent shell for ALL states (Pavel feedback) */}
      {layout === "L3" ? (
        <LayoutOriginal
          prompt={prompt} setPrompt={setPrompt}
          cities={cities} totalNights={totalNights} totalActivities={totalActivities}
          state={state} setState={setState}
        />
      ) : (
        <>
          {state === "empty" && <EmptyPromptLayout prompt={prompt} setPrompt={setPrompt} onGenerate={() => setState("generating")} />}
          {state === "generating" && <GeneratingLayout prompt={prompt} />}
          {showDraft && layout === "L1" && (
            <LayoutTopBarHero prompt={prompt} setPrompt={setPrompt} cities={cities} totalNights={totalNights} totalActivities={totalActivities} state={state} setState={setState} />
          )}
          {showDraft && layout === "L2" && (
            <LayoutMapHero prompt={prompt} setPrompt={setPrompt} cities={cities} totalNights={totalNights} totalActivities={totalActivities} state={state} setState={setState} />
          )}
        </>
      )}
    </div>
  );
}

// ======================================================================
// EMPTY — centered focused prompt
// ======================================================================
function EmptyPromptLayout({ prompt, setPrompt, onGenerate }) {
  return (
    <div style={{ maxWidth: 680, margin: "32px auto 0" }}>
      <div style={{
        background: "var(--surface)", border: "1.5px solid var(--ai-soft-12)", borderRadius: 16,
        padding: 20,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <Avatar kind="ai" size="sm" />
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ai)" }}>ИИ-помощник</div>
          <div className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>Опиши трип одним абзацем</div>
        </div>
        <textarea
          className="textarea"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Например: 10 дней по Италии в сентябре, любим вино и архитектуру, бюджет до €4000…"
          style={{ minHeight: 180, border: "none", padding: 0, background: "transparent", fontSize: 15.5, lineHeight: 1.55, width: "100%" }}
          autoFocus
        />
        <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 11.5, flex: 1 }}>Можно указать даты, города, бюджет, темп, темы (еда / архитектура / природа).</span>
          <Btn variant="primary" icon="sparkles" onClick={onGenerate}>Сгенерировать черновик</Btn>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Подсказки для начала</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {[
            "Италия, 10 дней, сентябрь, вино + еда",
            "Япония по сакуре, 14 дней",
            "Балканский круг на машине, 12 дней",
            "Города ЕС на поездах, август"].
          map(p =>
            <button key={p} onClick={() => setPrompt(p)} style={{
              padding: "6px 12px", background: "var(--surface)",
              border: "1px solid var(--line)", borderRadius: 999,
              fontSize: 12.5, cursor: "pointer", color: "var(--ink-2)",
            }}>{p}</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ======================================================================
// GENERATING — wide skeleton
// ======================================================================
function GeneratingLayout({ prompt }) {
  return (
    <div>
      <PromptBar prompt={prompt} disabled />
      <div style={{ marginTop: 14, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, height: 360, position: "relative", overflow: "hidden" }}>
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(90deg, transparent, var(--ai-soft) 50%, transparent)",
          backgroundSize: "200% 100%",
          animation: "shimmer 1.6s linear infinite",
        }} />
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", flexDirection: "column", color: "var(--ai)" }}>
          <Icon name="sparkles" size={28} />
          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 8 }}>ИИ собирает черновик…</div>
          <span className="ai-dots" style={{ color: "var(--ai)", marginTop: 6 }}><span /><span /><span /></span>
        </div>
      </div>
    </div>
  );
}

// ======================================================================
// PromptBar — used above hero layouts
// ======================================================================
function PromptBar({ prompt, setPrompt, disabled, state }) {
  return (
    <div style={{
      background: "var(--surface)", border: "1.5px solid var(--ai-soft-12)",
      borderRadius: 14, padding: 14,
      display: "flex", gap: 12, alignItems: "flex-start",
    }}>
      <Avatar kind="ai" size="sm" />
      <textarea
        className="textarea"
        value={prompt}
        disabled={disabled}
        onChange={(e) => setPrompt?.(e.target.value)}
        style={{ flex: 1, minHeight: 64, maxHeight: 140, border: "none", padding: 0, background: "transparent", fontSize: 14, lineHeight: 1.5 }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", flexShrink: 0 }}>
        <Btn variant="ai" icon="refresh" disabled={state === "saving"}>Перегенерировать</Btn>
        <span className="muted" style={{ fontSize: 11 }}>Учтёт правки в чате</span>
      </div>
    </div>
  );
}

// ======================================================================
// LAYOUT L1 — Top-bar prompt + WIDE hero map + scalable city list
// ======================================================================
function LayoutTopBarHero({ prompt, setPrompt, cities, totalNights, totalActivities, state, setState }) {
  return (
    <div>
      <PromptBar prompt={prompt} setPrompt={setPrompt} state={state} />

      {state === "draft" && (
        <div style={{ marginTop: 12, padding: 14, background: "var(--ai-soft)", borderRadius: 12, fontSize: 13.5, color: "var(--ink)", lineHeight: 1.55, display: "flex", alignItems: "flex-start", gap: 10 }}>
          <Avatar kind="ai" size="sm" />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, color: "var(--ai)", marginBottom: 2 }}>ИИ-помощник</div>
            Собрал черновик {totalNights} ночей по {cities.length} {cities.length < 5 ? "городам" : "городам"}. Активности можно подвинуть или добавить свои — пересчитаю.
          </div>
        </div>
      )}

      {state === "saving" && (
        <div style={{ marginTop: 12, padding: 14, background: "var(--brand-soft)", borderRadius: 12, fontSize: 13, color: "var(--ink-2)", display: "flex", alignItems: "center", gap: 10 }}>
          <span className="ai-dots" style={{ color: "var(--brand)" }}><span /><span /><span /></span>
          Создаю реальный трип — города, переезды и активности материализуются.
        </div>
      )}

      <div style={{ marginTop: 14, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, overflow: "hidden" }}>
        <AiDraftMap cities={cities} height={400} />
        <div style={{ padding: "12px 18px", borderTop: "1px solid var(--line-2)", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div className="eyebrow">Черновик трипа</div>
            <h2 style={{ marginBottom: 0, fontSize: 22 }}>{cities.length === 7 ? "Средиземное лето" : "Иберия летом"}</h2>
          </div>
          <div style={{ display: "flex", gap: 14, fontSize: 13, color: "var(--muted)" }}>
            <span><span className="num" style={{ fontWeight: 600, color: "var(--ink)" }}>{totalNights}</span> ночей</span>
            <span><span className="num" style={{ fontWeight: 600, color: "var(--ink)" }}>{cities.length}</span> городов</span>
            <span><span className="num" style={{ fontWeight: 600, color: "var(--ink)" }}>{totalActivities}</span> активн.</span>
          </div>
          <Btn variant="primary" icon="check" disabled={state === "saving"} onClick={() => setState("saving")}>
            {state === "saving" ? "Создаю…" : "Сохранить как реальный трип"}
          </Btn>
        </div>
      </div>

      <CityScalableList cities={cities} />
    </div>
  );
}

// ======================================================================
// LAYOUT L2 — Map-hero with overlays
// ======================================================================
function LayoutMapHero({ prompt, setPrompt, cities, totalNights, totalActivities, state, setState }) {
  return (
    <div>
      <div style={{
        background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, overflow: "hidden", position: "relative",
      }}>
        <AiDraftMap cities={cities} height={560} />

        <div style={{
          position: "absolute", left: 16, right: 16, bottom: 16,
          background: "var(--surface)", border: "1px solid var(--ai-soft-12)", borderRadius: 14,
          padding: 14, boxShadow: "var(--shadow-pop)",
          display: "flex", gap: 10, alignItems: "flex-start",
        }}>
          <Avatar kind="ai" size="sm" />
          <textarea
            className="textarea"
            value={prompt}
            onChange={(e) => setPrompt?.(e.target.value)}
            style={{ flex: 1, minHeight: 48, maxHeight: 100, border: "none", padding: 0, background: "transparent", fontSize: 13.5, lineHeight: 1.5 }}
          />
          <Btn variant="ai" icon="refresh">Перегенерировать</Btn>
        </div>

        <div style={{
          position: "absolute", top: 16, right: 16,
          background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12,
          padding: "10px 14px", boxShadow: "var(--shadow-soft)",
        }}>
          <div className="eyebrow" style={{ marginBottom: 2 }}>Черновик</div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 16, letterSpacing: "-0.02em" }}>
            {cities.length === 7 ? "Средиземное лето" : "Иберия летом"}
          </div>
          <div className="muted num" style={{ fontSize: 11.5, marginTop: 2 }}>{totalNights} ночей · {cities.length} городов</div>
        </div>
      </div>

      <CityScalableList cities={cities} />

      <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
        <Btn variant="primary" icon="check" disabled={state === "saving"} onClick={() => setState("saving")}>
          {state === "saving" ? "Создаю…" : "Сохранить как реальный трип"}
        </Btn>
      </div>
    </div>
  );
}

// ======================================================================
// LAYOUT L3 — Original 50/50 — same 2-column shell for ALL states
// (Pavel feedback: поля не должны скакать между состояниями)
// ======================================================================
function LayoutOriginal({ prompt, setPrompt, cities, totalNights, totalActivities, state, setState }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, alignItems: "start" }}>
      {/* LEFT — prompt + AI chat thread, identical layout in all states.
          Sticky so it stays in view while scrolling the draft preview. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14, position: "sticky", top: 72 }}>
        <div style={{
          background: "var(--surface)", border: "1.5px solid var(--ai-soft-12)", borderRadius: 14,
          padding: 16,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <Avatar kind="ai" size="sm" />
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ai)" }}>ИИ-помощник</div>
            <span className="muted" style={{ fontSize: 11.5, marginLeft: "auto" }}>опиши трип одним абзацем</span>
          </div>
          <textarea
            className="textarea"
            value={prompt}
            onChange={(e) => setPrompt?.(e.target.value)}
            disabled={state === "saving" || state === "generating"}
            style={{ minHeight: 130, border: "none", padding: 0, background: "transparent", fontSize: 14.5, lineHeight: 1.55 }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
            {state === "empty" && <Btn variant="primary" icon="sparkles" onClick={() => setState("generating")}>Сгенерировать черновик</Btn>}
            {state === "generating" && <Btn variant="primary" disabled>ИИ думает <span className="ai-dots" style={{ marginLeft: 6 }}><span /><span /><span /></span></Btn>}
            {(state === "draft" || state === "saving") && <Btn variant="ai" icon="refresh" disabled={state === "saving"}>Перегенерировать</Btn>}
          </div>
        </div>

        {/* AI chat reply / status — always present, just changes content per state */}
        <div style={{
          padding: 14,
          background: state === "saving" ? "var(--brand-soft)" : "var(--ai-soft)",
          borderRadius: 12, fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.55,
          minHeight: 100, display: "flex", flexDirection: "column", gap: 8,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Avatar kind="ai" size="sm" />
            <b style={{ color: state === "saving" ? "var(--brand)" : "var(--ai)" }}>ИИ-помощник</b>
            {state === "generating" && <span className="ai-dots" style={{ color: "var(--ai)", marginLeft: "auto" }}><span /><span /><span /></span>}
          </div>
          {state === "empty" && <span className="muted">Жду промпт. Опиши трип одним абзацем — соберу черновик и обсудим детали в этом чате.</span>}
          {state === "generating" && <span>Подбираю города и переезды… собираю активности по дням.</span>}
          {state === "draft" && <span>Собрал черновик {totalNights} ночей по {cities.length} городам. {totalActivities} активностей. Активности можно подвинуть или добавить свои — пересчитаю.</span>}
          {state === "saving" && <span>Создаю реальный трип — города, переезды и активности материализуются.</span>}
        </div>

        {/* Suggestion chips — only shown in empty/draft states, same vertical space reserved */}
        <div style={{ minHeight: 40, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {state === "empty" && [
            "Италия, 10 дней, сентябрь",
            "Япония, 14 дней",
            "Балканы на машине"
          ].map(p =>
            <button key={p} onClick={() => setPrompt(p)} style={{
              padding: "6px 12px", background: "var(--surface)",
              border: "1px solid var(--line)", borderRadius: 999,
              fontSize: 12.5, cursor: "pointer", color: "var(--ink-2)",
            }}>{p}</button>
          )}
          {state === "draft" && (
            <span className="muted" style={{ fontSize: 12 }}>
              <Icon name="info" size={12} style={{ verticalAlign: -1, marginRight: 4 }} />
              Можно попросить «+1 день в Лиссабоне» или «убрать Севилью».
            </span>
          )}
        </div>
      </div>

      {/* RIGHT — draft preview, identical shell in all states */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {/* Map area — empty placeholder when no draft yet */}
        {state === "empty" && (
          <div style={{
            height: 220, background: "var(--wash)",
            display: "grid", placeItems: "center",
            borderBottom: "1px solid var(--line-2)",
            color: "var(--muted-2)",
          }}>
            <div style={{ textAlign: "center", fontSize: 13 }}>
              <Icon name="map" size={28} style={{ marginBottom: 6 }} />
              <div>Карта появится здесь</div>
            </div>
          </div>
        )}
        {state === "generating" && (
          <div style={{ height: 220, position: "relative", overflow: "hidden", borderBottom: "1px solid var(--line-2)" }}>
            <div style={{
              position: "absolute", inset: 0, background: "#dceaf5",
            }} />
            <div style={{
              position: "absolute", inset: 0,
              background: "linear-gradient(90deg, transparent, var(--ai-soft) 50%, transparent)",
              backgroundSize: "200% 100%",
              animation: "shimmer 1.6s linear infinite",
            }} />
          </div>
        )}
        {(state === "draft" || state === "saving") && <AiDraftMap cities={cities} height={220} />}

        {/* Header — same height across states */}
        <div style={{ padding: "14px 18px 10px", borderBottom: "1px solid var(--line-2)", minHeight: 64 }}>
          <div className="eyebrow" style={{ marginBottom: 4 }}>Черновик</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <h2 style={{ marginBottom: 0, fontSize: 20 }}>
              {state === "empty" ? "—" : state === "generating" ? <SkeletonBar width={150} /> : (cities.length === 7 ? "Средиземное лето" : "Иберия летом")}
            </h2>
            {(state === "draft" || state === "saving") && (
              <span className="muted num" style={{ fontSize: 12.5 }}>{totalNights} ночей · {cities.length} городов · {totalActivities} активн.</span>
            )}
          </div>
        </div>

        {/* Body — list area */}
        <div style={{ flex: 1, padding: 14, overflow: "auto", minHeight: 320, maxHeight: 480 }} className="scrollbar-thin">
          {state === "empty" && (
            <div style={{ height: "100%", display: "grid", placeItems: "center", color: "var(--muted-2)", textAlign: "center" }}>
              <div>
                <Icon name="sparkles" size={28} style={{ color: "var(--ai)", marginBottom: 6 }} />
                <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--muted)" }}>Тут появится черновик</div>
                <div style={{ fontSize: 12, marginTop: 4, maxWidth: 260, marginLeft: "auto", marginRight: "auto" }}>Города, даты и активности — сгенерируем после промпта.</div>
              </div>
            </div>
          )}
          {state === "generating" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{ padding: 12, border: "1px solid var(--line-2)", borderRadius: 10, display: "flex", gap: 12, alignItems: "center" }}>
                  <div style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--wash)" }} />
                  <div style={{ flex: 1 }}>
                    <SkeletonBar width="60%" height={12} />
                    <div style={{ height: 4 }} />
                    <SkeletonBar width="40%" height={9} />
                  </div>
                </div>
              ))}
            </div>
          )}
          {(state === "draft" || state === "saving") && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {cities.map((c, i) => <AiDraftCityCard key={i} city={c} num={i + 1} startCollapsed={cities.length > 3} />)}
            </div>
          )}
        </div>

        {/* Footer — same height; CTA is enabled only in draft */}
        <div style={{ padding: "12px 18px", borderTop: "1px solid var(--line-2)" }}>
          <Btn variant="primary" block icon="check"
            disabled={state !== "draft"}
            onClick={() => setState("saving")}>
            {state === "saving" ? "Создаю трип…" : state === "draft" ? "Сохранить как реальный трип" : "Сначала сгенерируй черновик"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

function SkeletonBar({ width = "60%", height = 12 }) {
  return (
    <div style={{
      width, height, borderRadius: 4,
      background: "var(--wash)",
      backgroundImage: "linear-gradient(90deg, var(--wash), var(--line-2), var(--wash))",
      backgroundSize: "200% 100%",
      animation: "shimmer 1.6s linear infinite",
    }} />
  );
}

// ======================================================================
// SCALABLE CITY LIST — single column accordion that handles any count
// Cards start collapsed when count > 3 to keep the page manageable.
// ======================================================================
function CityScalableList({ cities }) {
  const startCollapsed = cities.length > 3;
  const [collapseAll, setCollapseAll] = useState(false);

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
        <span className="eyebrow" style={{ flex: 1 }}>Города и активности — {cities.length}</span>
        <button onClick={() => setCollapseAll(c => !c)} style={{
          background: "transparent", border: "none", color: "var(--brand)",
          fontSize: 12, fontWeight: 600, cursor: "pointer",
        }}>
          {collapseAll ? "Развернуть все" : "Свернуть все"}
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }} data-comment-anchor="ai-draft-cities-list">
        {cities.map((c, i) => (
          <AiDraftCityCard
            key={i}
            city={c}
            num={i + 1}
            startCollapsed={collapseAll || startCollapsed}
          />
        ))}
      </div>
    </div>
  );
}

// ======================================================================
// AI draft city card — collapsible row
// ======================================================================
function AiDraftCityCard({ city, num, startCollapsed }) {
  const [expanded, setExpanded] = useState(!startCollapsed);
  useEffect(() => { setExpanded(!startCollapsed); }, [startCollapsed]);
  const byDay = {};
  city.activities.forEach(a => {
    if (!byDay[a.day]) byDay[a.day] = [];
    byDay[a.day].push(a);
  });
  const days = Object.keys(byDay);
  return (
    <div style={{ border: "1px solid var(--line-2)", borderRadius: 12, overflow: "hidden", background: "var(--surface)" }}>
      <button onClick={() => setExpanded(e => !e)} style={{
        display: "flex", alignItems: "center", gap: 12,
        width: "100%", padding: "12px 14px",
        background: expanded ? "var(--wash)" : "var(--surface)",
        border: "none", textAlign: "left", cursor: "pointer",
      }}>
        <div style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--brand)", color: "white", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{num}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{city.city} <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>· {city.country}</span></div>
          <div className="muted num" style={{ fontSize: 11.5, marginTop: 1 }}>{city.dates} · {city.n} ночей · {city.activities.length} активн.</div>
        </div>
        <Icon name="chevD" size={13} style={{ color: "var(--muted-2)", transform: expanded ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform .15s ease" }} />
      </button>
      {expanded && (
        <div style={{ padding: "8px 14px 12px" }}>
          {days.map(d => (
            <div key={d} style={{ marginTop: 8 }}>
              <div className="eyebrow" style={{ fontSize: 10.5, marginBottom: 6 }}>{d}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 0, position: "relative" }}>
                <div style={{ position: "absolute", left: 32, top: 8, bottom: 8, width: 2, background: "var(--line-2)" }} />
                {byDay[d].map((a, j) => (
                  <div key={j} style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "6px 0", position: "relative", zIndex: 1,
                  }}>
                    <div className="num" style={{ width: 44, fontSize: 12, fontWeight: 600, color: "var(--muted)", flexShrink: 0 }}>{a.time}</div>
                    <div style={{
                      width: 14, height: 14, borderRadius: "50%",
                      background: "var(--surface)",
                      border: "2px solid var(--ev-activity)",
                      flexShrink: 0,
                    }} />
                    <div style={{ flex: 1, fontSize: 13, lineHeight: 1.35 }}>{a.name}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ======================================================================
// AI draft route map — accepts custom height
// ======================================================================
function AiDraftMap({ cities, height = 200 }) {
  const lngMin = -15, lngMax = 60, latMin = 25, latMax = 65;
  const proj = (lat, lng) => {
    const x = 4 + ((lng - lngMin) / (lngMax - lngMin)) * 92;
    const y = 8 + (1 - (lat - latMin) / (latMax - latMin)) * 64;
    return { x, y };
  };
  const pts = cities.map((c, i) => ({ ...proj(c.lat, c.lng), name: c.city, num: i + 1 }));
  const pathD = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");

  return (
    <div style={{ background: "#dceaf5", height, position: "relative" }}>
      <svg viewBox="0 0 100 80" preserveAspectRatio="none" style={{ width: "100%", height: "100%", display: "block" }}>
        <defs>
          <pattern id="dots-ai2" width="2" height="2" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r=".15" fill="#bcd4e8" />
          </pattern>
        </defs>
        <rect width="100" height="80" fill="#dceaf5" />
        <rect width="100" height="80" fill="url(#dots-ai2)" />
        <path
          d="M3 24 Q 10 14 20 18 L 32 12 Q 45 8 60 14 Q 75 12 88 18 L 96 26 Q 94 38 84 42 L 70 44 Q 60 50 52 54 L 36 60 Q 22 60 14 52 L 6 42 Q 2 32 3 24 Z"
          fill="#f6f3ed" stroke="#dcd3c2" strokeWidth=".3" />
        <path d="M4 38 Q 5 44 8 50 L 14 56 Q 20 58 22 52 L 23 46 Q 22 40 18 38 L 10 38 Q 6 38 4 38 Z" fill="#ece5d4" stroke="#c9bd9f" strokeWidth=".4" />
        <path d={pathD} stroke="var(--ai)" strokeWidth=".5" fill="none" strokeDasharray="1.5 1" opacity=".85" />
        {pts.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="3.5" fill="var(--ai)" opacity=".22" />
            <circle cx={p.x} cy={p.y} r="2" fill="var(--ai)" />
            <text x={p.x} y={p.y + .8} fontSize="1.8" fontWeight="700" fill="white" textAnchor="middle">{p.num}</text>
            <text x={p.x + 2.5} y={p.y + 1.2} fontSize="2.2" fontWeight="600" fill="var(--ink)">{p.name}</text>
          </g>
        ))}
      </svg>
      <div style={{
        position: "absolute", top: 12, left: 14,
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "5px 11px",
        background: "var(--surface)", border: "1px solid var(--ai-soft-12)",
        borderRadius: 999, fontSize: 11, fontWeight: 600, color: "var(--ai)",
      }}>
        <Icon name="sparkles" size={11} /> Маршрут от ИИ
      </div>
    </div>
  );
}

export default ScreenAiPlanner;
