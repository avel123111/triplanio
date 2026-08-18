import React from 'react';
import { useT } from '@/lib/i18n/I18nContext';

// =====================================================================
// FLOW PROGRESS - counter-style progress bar for the unified create flow.
//   steps:   [{ label }]
//   current: 0-based index of the active step
//   accent:  theme color (brand for manual, ai for AI entry)
//   onJump(i): optional - clickable segments (only past/current steps jump)
//
// On the DS: layout is .row/.col primitives, the step accent arrives as the
// `--fp-accent` CUSTOM-PROPERTY CHANNEL (like a Tile's --hl tint), and the
// segment bar is `.flow-prog__seg` — an extension of the existing `flow-` family.
// =====================================================================
export default function FlowProgress({ steps, current = 0, accent = 'var(--brand)', onJump, nextLabel }) {
  const t = useT();
  return (
    <div className="col col--g4 flow-prog" style={{ '--fp-accent': accent }}>
      <div className="row row--a-baseline row--g4 row--wrap">
        <span className="t-micro flow-prog__word">
          {t('planner.step_word')} {current + 1} <span className="muted">{t('planner.of')} {steps.length}</span>
        </span>
        <span className="t-label flow-prog__label">{steps[current]?.label}</span>
        {current < steps.length - 1 && (
          <span className="t-meta flow-prog__next">
            {t('planner.next_label')}: {nextLabel || steps[current + 1]?.label}
          </span>
        )}
      </div>
      <div className="row row--g2">
        {steps.map((s, i) => {
          const canJump = onJump && i <= current;
          const state = i < current ? ' flow-prog__seg--done' : i === current ? ' flow-prog__seg--now' : '';
          const cp = canJump ? {
            onClick: () => onJump(i),
            role: 'button',
            tabIndex: 0,
            onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onJump(i); } },
          } : {};
          return <div key={i} {...cp} title={s.label} className={'flow-prog__seg' + state} />;
        })}
      </div>
    </div>
  );
}
