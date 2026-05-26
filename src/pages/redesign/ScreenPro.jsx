import React, { useState } from 'react';
import { Icon } from '../../design/icons';
import { Btn, Badge, Skeleton, fmt } from '../../design/index';

// =====================================================================
// PRO / PRICING (§17) with multiple states
// =====================================================================

const PLANS = [
{ id: "trip", name: "Один трип", price: 12.99, period: "разово", caption: "Только этот трип. Никаких подписок.", features: ["Все Pro-фичи внутри трипа", "ИИ-планировщик с нуля", "Без срока действия — пока трип в активе"] },
{ id: "month", name: "Pro Monthly", price: 9.99, period: "в месяц", caption: "Безлимит трипов. Гибко.", popular: true, features: ["Безлимит активных трипов", "ИИ-планировщик и парсер бронирований", "Telegram-мост", "Персональный ИИ-помощник", "Отменишь в любой момент"] },
{ id: "year", name: "Pro Yearly", price: 79.99, period: "в год", caption: "Тот же набор. Экономия 33%.", save: "−33%", features: ["Всё из Monthly", "Эквивалент €6.67 в месяц", "Платишь раз в год"] }];


function ScreenPro() {
  const state = "normal";
  const [picked, setPicked] = useState("month");

  const plans = state === "two-plans" ? PLANS.filter((p) => p.id !== "trip") : PLANS;
  const isLoading = state === "loading";
  const isIframe = state === "iframe";

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto" }}>
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "8px 14px 8px 8px", background: "var(--brand-soft)", color: "var(--brand)", borderRadius: 999, fontSize: 13, fontWeight: 600, marginBottom: 18 }}>
          <span style={{ width: 18, height: 18, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13 }}>T</span>
          <span>Triplanio Pro</span>
        </div>
        <h1 style={{ fontSize: 44, marginBottom: 10, maxWidth: 720, margin: "0 auto 10px" }}>Больше трипов, меньше работы.</h1>
        <div className="muted" style={{ fontSize: 17, maxWidth: 560, margin: "0 auto" }}>
          ИИ-планировщик с нуля, парсинг бронирований, безлимит трипов и группового планирования.
        </div>
        {state === "two-plans" &&
        <div className="muted" style={{ fontSize: 13, marginTop: 14 }}>
            <Icon name="info" size={12} style={{ verticalAlign: -1, marginRight: 4 }} />
            Одноразовый апгрейд одного трипа доступен только когда ты внутри конкретного трипа.
          </div>
        }
      </div>

      {isIframe ?
      <div style={{ maxWidth: 600, margin: "0 auto", padding: 28, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, textAlign: "center" }}>
          <div style={{ width: 64, height: 64, margin: "0 auto 18px", borderRadius: 16, background: "var(--warning-soft)", color: "var(--warning)", display: "grid", placeItems: "center" }}>
            <Icon name="external" size={28} />
          </div>
          <h2 style={{ marginBottom: 8 }}>Открой в новой вкладке</h2>
          <div className="muted" style={{ fontSize: 14, marginBottom: 20, lineHeight: 1.55 }}>
            Triplanio запущен внутри встроенного контекста — оплата не сработает здесь. Открой продукт в отдельной вкладке, чтобы продолжить с Pro.
          </div>
          <Btn variant="primary" size="lg" icon="external">Открыть Triplanio</Btn>
        </div> :

      <div style={{ display: "grid", gridTemplateColumns: `repeat(${plans.length}, 1fr)`, gap: 14, maxWidth: state === "two-plans" ? 760 : "none", margin: "0 auto" }}>
          {isLoading ?
        Array.from({ length: plans.length }).map((_, i) =>
        <div key={i} style={{ padding: 24, borderRadius: 16, background: "var(--surface)", border: "1px solid var(--line)" }}>
                <Skeleton w="60%" h={22} />
                <div style={{ marginTop: 8 }}><Skeleton w="80%" h={12} /></div>
                <div style={{ marginTop: 18 }}><Skeleton w="50%" h={36} /></div>
                <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 8 }}>
                  {[0, 1, 2, 3].map((j) => <Skeleton key={j} w={`${90 - j * 8}%`} h={11} />)}
                </div>
                <div style={{ marginTop: 22 }}><Skeleton w="100%" h={40} r={10} /></div>
              </div>
        ) :
        plans.map((p) =>
        <div key={p.id} onClick={() => setPicked(p.id)} style={{
          padding: 24, borderRadius: 16, cursor: "pointer",
          background: picked === p.id ? "var(--brand-soft)" : "var(--surface)",
          border: "2px solid " + (picked === p.id ? "var(--brand)" : "var(--line)"),
          color: "var(--ink)",
          position: "relative",
          boxShadow: picked === p.id ? "0 0 0 4px var(--brand-soft)" : "none",
          transition: "all .15s ease",
        }}>
              {p.popular &&
          <div style={{ position: "absolute", top: -11, left: "50%", transform: "translateX(-50%)", background: "var(--brand)", color: "white", padding: "4px 12px", borderRadius: 999, fontSize: 11, fontWeight: 700, letterSpacing: ".04em", boxShadow: "0 4px 14px rgba(33,103,226,.3)" }}>
                  ⭐ САМЫЙ ПОПУЛЯРНЫЙ
                </div>
          }
              {p.save &&
          <div style={{ position: "absolute", top: 16, right: 16, background: "var(--success)", color: "white", padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700 }}>{p.save}</div>
          }
              {picked === p.id && (
                <div style={{ position: "absolute", top: 16, left: 16, width: 22, height: 22, borderRadius: "50%", background: "var(--brand)", color: "white", display: "grid", placeItems: "center", boxShadow: "0 2px 8px rgba(33,103,226,.4)" }}>
                  <Icon name="check" size={13} />
                </div>
              )}
              <div style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 600, letterSpacing: "-0.015em", marginBottom: 6, marginTop: picked === p.id ? 22 : 0 }}>{p.name}</div>
              <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 18 }}>{p.caption}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 4 }}>
                <span className="num" style={{ fontFamily: "var(--font-display)", fontSize: 40, fontWeight: 600, letterSpacing: "-0.03em" }}>€{p.price}</span>
                <span style={{ fontSize: 13, opacity: 0.7 }}>{p.period}</span>
              </div>
              <hr style={{ border: "none", borderTop: "1px solid var(--line-2)", margin: "18px 0" }} />
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
                {p.features.map((f, i) =>
            <li key={i} style={{ display: "flex", gap: 8, fontSize: 13, lineHeight: 1.4 }}>
                    <Icon name="checkSm" size={14} style={{ flexShrink: 0, marginTop: 2, color: "var(--success)" }} />
                    <span>{f}</span>
                  </li>
            )}
              </ul>
              <button style={{
            marginTop: 22, width: "100%", padding: "11px 14px",
            background: picked === p.id ? "var(--brand)" : "var(--surface)",
            color: picked === p.id ? "white" : "var(--ink)",
            border: "1px solid " + (picked === p.id ? "var(--brand)" : "var(--line)"),
            borderRadius: 10, fontWeight: 600, fontSize: 14, cursor: "pointer",
          }}>{picked === p.id ? "✓ Выбран" : "Выбрать"}</button>
            </div>
        )}
        </div>
      }

      {!isLoading && !isIframe &&
      <div style={{ marginTop: 30, padding: 18, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <Icon name="lock" size={20} style={{ color: "var(--muted)" }} />
          <div style={{ flex: 1, minWidth: 220, fontSize: 13.5 }}>
            <b>Безопасный чекаут</b> · Stripe · отменишь в любой момент · Apple Pay / Google Pay / карты
          </div>
          <Btn variant="primary" size="lg" iconRight="arrow">Перейти к оплате</Btn>
        </div>
      }

      {isLoading &&
      <div style={{ marginTop: 30, padding: 14, background: "var(--brand-soft)", borderRadius: 12, fontSize: 13, color: "var(--ink-2)", textAlign: "center" }}>
          <span className="ai-dots" style={{ color: "var(--brand)", marginRight: 8 }}><span /><span /><span /></span>
          Тяну цены с сервера…
        </div>
      }
    </div>
  );
}

export default ScreenPro;
