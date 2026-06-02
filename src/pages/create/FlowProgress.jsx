import React from 'react';

// =====================================================================
// FLOW PROGRESS — counter-style progress bar for the unified create flow.
//   steps:   [{ label }]
//   current: 0-based index of the active step
//   accent:  theme color (brand for manual, ai for AI entry)
//   onJump(i): optional — clickable segments (only past/current steps jump)
// =====================================================================
export default function FlowProgress({ steps, current = 0, accent = 'var(--brand)', onJump, nextLabel }) {
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: accent }}>
          Шаг {current + 1} <span style={{ color: 'var(--muted-2)' }}>из {steps.length}</span>
        </span>
        <span style={{ fontSize: 14, fontWeight: 650, color: 'var(--ink)' }}>{steps[current]?.label}</span>
        {current < steps.length - 1 && (
          <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--muted)' }}>
            Далее: {nextLabel || steps[current + 1]?.label}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {steps.map((s, i) => {
          const canJump = onJump && i <= current;
          const cp = canJump ? {
            onClick: () => onJump(i),
            role: 'button',
            tabIndex: 0,
            onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onJump(i); } },
          } : {};
          return (
            <div
              key={i}
              {...cp}
              title={s.label}
              style={{
                flex: 1,
                height: 6,
                borderRadius: 3,
                cursor: canJump ? 'pointer' : 'default',
                background: i < current ? 'var(--success)' : i === current ? accent : 'var(--line)',
                transition: 'background .25s ease',
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
