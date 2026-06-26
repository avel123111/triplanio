import React from 'react';
import { Icon } from '../../design/icons';
import { Btn } from '../../design/index';
import { useT } from '@/lib/i18n/I18nContext';

const AI = 'var(--ai)';

// Start/finish marker in the draft list - a flag-badged row with no nights
// (start/end cities are pure route anchors, the AI returns them without dates).
function AnchorMini({ label, city }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', background: 'var(--wash)', border: '1px solid var(--line-2)', borderRadius: 11 }}>
      <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--ink-2)', color: '#fff', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
        <Icon name="flag" size={12} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="eyebrow" style={{ fontSize: 'var(--fs-micro)', marginBottom: 1 }}>{label}</div>
        <div className="te-cityname">{city.city_name} <span className="muted" style={{ fontWeight: 500, fontSize: 'var(--fs-meta)' }}>{city.country}</span></div>
      </div>
    </div>
  );
}

// =====================================================================
// AI ENTRY PANEL — design-system A6 (AI Planner / PanelAi). White card with an
// ai-tinted border (NOT the .ai-blk booking-parser block). 3 states: prompt →
// generating → draft. The "generating" CTA is the canonical disabled .btn--ai
// with white .ai-dots ("Думаю …"). The Next button lives in the shared flow
// footer (ManualPlanner), not here.
//   ctx: { aiState, prompt, setPrompt, aiComment, home, returnCity, cities,
//          onGenerate(promptText) }
// =====================================================================
export default function PanelAi({ ctx }) {
  const t = useT();
  const { aiState, prompt, setPrompt, aiComment, home, returnCity, cities = [], onGenerate } = ctx;
  const canPrompt = prompt.trim().length > 0 && aiState !== 'generating';

  let statusText;
  if (aiState === 'generating') statusText = t('ai_plan.status_generating');
  else if (aiState === 'draft') statusText = aiComment || t('ai_plan.status_ready');
  else statusText = t('ai_plan.status_waiting');

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 18 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--ai-grad)', color: '#fff', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <Icon name="sparkles" size={22} />
        </div>
        <div>
          <h1 style={{ marginBottom: 6, letterSpacing: '-0.025em' }}>{t('ai_plan.title')}</h1>
          <div className="muted" style={{ fontSize: 'var(--fs-strong)', lineHeight: 1.5 }}>{t('ai_plan.page_subtitle')}</div>
        </div>
      </div>

      <div style={{ background: 'var(--surface)', border: `1.5px solid color-mix(in srgb, ${AI} 22%, var(--line))`, borderRadius: 14, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--ai-grad)', color: '#fff', display: 'grid', placeItems: 'center' }}><Icon name="sparkles" size={12} /></span>
          <div style={{ fontSize: 'var(--fs-base)', fontWeight: 700, color: 'var(--ai-ink)' }}>{t('ai_plan.assistant_hint')}</div>
        </div>
        <textarea
          className="textarea"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={aiState === 'generating'}
          placeholder={aiState === 'draft' ? t('ai_plan.prompt_placeholder_refine') : t('ai_plan.prompt_placeholder_initial')}
          style={{ minHeight: 110, border: 'none', padding: 0, background: 'transparent', lineHeight: 1.55, width: '100%', resize: 'none' }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12, alignItems: 'center', gap: 8 }}>
          {aiState === 'generating' ? (
            <Btn variant="ai" size="sm" disabled>
              {t('ai_plan.thinking')} <span className="ai-dots" style={{ marginLeft: 4 }}><span /><span /><span /></span>
            </Btn>
          ) : aiState === 'draft' ? (
            <Btn variant="ai" size="sm" icon="refresh" disabled={!canPrompt} onClick={() => onGenerate(prompt.trim())}>{t('ai_plan.regenerate')}</Btn>
          ) : (
            <Btn variant="ai" size="sm" icon="sparkles" disabled={!canPrompt} onClick={() => canPrompt && onGenerate(prompt.trim())}>{t('ai_plan.generate_draft')}</Btn>
          )}
        </div>
      </div>

      {/* assistant status reply */}
      <div style={{ marginTop: 14, padding: 14, background: `color-mix(in srgb, ${AI} 7%, transparent)`, borderRadius: 12, fontSize: 'var(--fs-base)', lineHeight: 1.55, color: 'var(--ink-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--ai-grad)', color: '#fff', display: 'grid', placeItems: 'center' }}><Icon name="sparkles" size={11} /></span>
          <b style={{ color: 'var(--ai-ink)', fontSize: 'var(--fs-meta)' }}>{t('ai_plan.assistant_label')}</b>
          {aiState === 'generating' && <span className="ai-dots" style={{ color: AI, marginLeft: 'auto' }}><span /><span /><span /></span>}
        </div>
        <span style={{ whiteSpace: 'pre-wrap' }}>{statusText}</span>
      </div>

      {/* draft city list */}
      {aiState === 'draft' && cities.length > 0 && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="eyebrow">{t('ai_plan.draft_label')}</div>
          {/* Origin point - shown only when the user named where they depart from. */}
          {home?.city_name && <AnchorMini label={t('ai_plan.start')} city={home} />}
          {cities.map((c, i) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 11 }}>
              <div style={{ width: 24, height: 24, borderRadius: '50%', background: AI, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 'var(--fs-micro)', fontWeight: 700, flexShrink: 0 }}>{i + 1}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="te-cityname">{c.city_name} <span className="muted" style={{ fontWeight: 500, fontSize: 'var(--fs-meta)' }}>{c.country}</span></div>
              </div>
              <span className="muted num" style={{ fontSize: 'var(--fs-meta)' }}>{c.nights} {t('ai_plan.unit_nights_short')}</span>
            </div>
          ))}
          {/* Return point - shown only when the user named where they come back to. */}
          {returnCity?.city_name && <AnchorMini label={t('ai_plan.end')} city={returnCity} />}
        </div>
      )}

      {/* prompt chips */}
      {aiState === 'prompt' && (
        <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {[t('ai_plan.chip_italy'), t('ai_plan.chip_japan'), t('ai_plan.chip_balkans')].map((p) => (
            <button key={p} onClick={() => setPrompt(p)} style={{ padding: '6px 12px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 999, fontSize: 'var(--fs-meta)', cursor: 'pointer', color: 'var(--ink-2)' }}>{p}</button>
          ))}
        </div>
      )}

    </div>
  );
}
