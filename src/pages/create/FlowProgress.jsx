import React from 'react';
import { useT } from '@/lib/i18n/I18nContext';

// =====================================================================
// FLOW PROGRESS - counter-style progress bar for the unified create flow.
//   steps:   [{ label }]
//   current: 0-based index of the active step
//   accent:  theme color (brand for manual, ai for AI entry)
//   onJump(i): optional - clickable segments (only past/current steps jump)
// =====================================================================
export default function FlowProgress({ steps, current = 0, accent = 'var(--brand)', onJump, nextLabel }) {
  const t = useT();
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span className="t-micro" style={{ color: accent }}>
          {t('planner.step_word')} {current + 1} <span style={{ color: 'var(--muted)' }}>{t('planner.of')} {steps.length}</span>
        </span>
        <span className="t-ui" style={{ color: 'var(--ink)' }}>{steps[current]?.label}</span>
        {current < steps.length - 1 && (
          <span className="t-meta" style={{ marginLeft: 'auto', color: 'var(--muted)' }}>
            {t('planner.next_label')}: {nextLabel || steps[current + 1]?.label}
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
