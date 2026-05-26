import React from 'react';
import { Icon } from '../../design/icons';
import { Btn } from '../../design/index';

// =====================================================================
// SYSTEM / ERROR SCREENS
// =====================================================================

const STUBS = {
  "no-access": { icon: "lock", title: "У тебя нет доступа к этому трипу", body: "Возможно, приглашение было отозвано или ты никогда не приглашался. Попроси владельца трипа добавить тебя.", primary: { label: "К моим трипам" }, secondary: "Войти другим аккаунтом", tone: "warm" },
  "404": { icon: "search", title: "Такой страницы не существует", body: "Возможно, ссылка устарела или содержит ошибку.", primary: { label: "На главную" }, tone: "brand" },
  "expired": { icon: "link", title: "Эта публичная ссылка истекла", body: "Владелец отозвал доступ или ссылка превысила срок действия.", primary: { label: "Узнать о Triplanio" }, tone: "warning" },
  "unregistered": { icon: "user", title: "Этот аккаунт не зарегистрирован", body: "Аккаунт anna@example.com нет на этом инстансе Triplanio.", primary: { label: "Зарегистрироваться" }, secondary: "Войти другим аккаунтом", tone: "brand" },
};

const TONE_COLORS = {
  warm: { bg: "var(--warm-soft, #fff3e0)", icon: "var(--warm, #f59e0b)" },
  brand: { bg: "var(--brand-soft)", icon: "var(--brand)" },
  warning: { bg: "var(--warning-soft)", icon: "var(--warning)" },
};

function ScreenSystem({ variant = "no-access" }) {
  const stub = STUBS[variant] || STUBS["no-access"];
  const colors = TONE_COLORS[stub.tone] || TONE_COLORS.brand;

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "var(--wash)", padding: 24,
    }}>
      <div style={{
        maxWidth: 480, width: "100%", textAlign: "center",
        background: "var(--surface)", border: "1px solid var(--line)",
        borderRadius: 20, padding: "40px 32px",
        boxShadow: "var(--shadow-card)",
      }}>
        <div style={{
          width: 72, height: 72, borderRadius: 18,
          background: colors.bg,
          color: colors.icon,
          display: "grid", placeItems: "center",
          margin: "0 auto 22px",
        }}>
          <Icon name={stub.icon} size={32} />
        </div>

        <h2 style={{ marginBottom: 10, fontSize: 22, letterSpacing: "-0.015em" }}>
          {stub.title}
        </h2>
        <p className="muted" style={{ fontSize: 14.5, lineHeight: 1.6, marginBottom: 28 }}>
          {stub.body}
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Btn variant="primary" size="lg" block onClick={() => {}}>
            {stub.primary.label}
          </Btn>
          {stub.secondary && (
            <Btn variant="ghost" size="lg" block onClick={() => {}}>
              {stub.secondary}
            </Btn>
          )}
        </div>
      </div>
    </div>
  );
}

export default ScreenSystem;
