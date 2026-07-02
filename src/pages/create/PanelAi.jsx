import React from 'react';
import { Icon } from '../../design/icons';
import { Btn } from '../../design/index';
import { useT } from '@/lib/i18n/I18nContext';
import { CityAnchorRow } from './anchors';

// =====================================================================
// AI ENTRY PANEL — design-system A6 (AI Planner / PanelAi). Vertical rhythm via
// one flex-gap column: title → prompt field → assistant status → draft. The
// prompt uses the design-system AI field (.field--ai .textarea) instead of the
// old inline border:none/padding:0 hack that cramped the text against the edge.
// 3 states: prompt → generating → draft. The Next button lives in the shared
// flow footer (ManualPlanner), not here.
//   ctx: { aiState, prompt, setPrompt, aiComment, home, setHome, returnCity,
//          cities, onGenerate(promptText) }
// =====================================================================
export default function PanelAi({ ctx }) {
  const t = useT();
  const { aiState, prompt, setPrompt, aiComment, home, setHome, returnCity, cities = [], onGenerate } = ctx;
  const canPrompt = prompt.trim().length > 0 && aiState !== 'generating';

  let statusText;
  if (aiState === 'generating') statusText = t('ai_plan.status_generating');
  else if (aiState === 'draft') statusText = aiComment || t('ai_plan.status_ready');
  else statusText = t('ai_plan.status_waiting');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Title */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--ai-grad)', color: '#fff', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <Icon name="sparkles" size={22} />
        </div>
        <div>
          <h1 style={{ marginBottom: 6, letterSpacing: '-0.025em' }}>{t('ai_plan.title')}</h1>
          <div className="muted t-ui">{t('ai_plan.page_subtitle')}</div>
        </div>
      </div>

      {/* Prompt field — plain design-system input (neutral surface, NOT the AI
          tint: the assistant reply block right below is already ai-purple, so a
          purple textarea stacked on it read as one muddy block). */}
      <div className="field" style={{ marginBottom: 0 }}>
        <label className="field__label">{t('ai_plan.assistant_hint')}</label>
        <textarea
          className="textarea"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={aiState === 'generating'}
          placeholder={aiState === 'draft' ? t('ai_plan.prompt_placeholder_refine') : t('ai_plan.prompt_placeholder_initial')}
          style={{ minHeight: 120 }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
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

      {/* Assistant status reply */}
      <div className="t-body" style={{ padding: 14, background: 'var(--ai-soft)', borderRadius: 12, color: 'var(--ink-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--ai-grad)', color: '#fff', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name="sparkles" size={11} /></span>
          <b className="t-meta" style={{ color: 'var(--ai-ink)' }}>{t('ai_plan.assistant_label')}</b>
          {aiState === 'generating' && <span className="ai-dots" style={{ color: 'var(--ai)', marginLeft: 'auto' }}><span /><span /><span /></span>}
        </div>
        <span style={{ whiteSpace: 'pre-wrap' }}>{statusText}</span>
      </div>

      {/* Draft city list */}
      {aiState === 'draft' && cities.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="eyebrow">{t('ai_plan.draft_label')}</div>
          {/* Origin — OPTIONAL. Editable so a departure the AI didn't recognise
              can be added right here or skipped (same add-start control as step 2). */}
          <CityAnchorRow label={t('ai_plan.start')} city={home} editable onPick={setHome} />
          {cities.map((c, i) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 11 }}>
              <div className="t-meta" style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--ai)', color: '#fff', display: 'grid', placeItems: 'center', flexShrink: 0 }}>{i + 1}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="te-cityname">{c.city_name} <span className="muted t-meta">{c.country}</span></div>
              </div>
              <span className="muted num t-meta">{c.nights} {t('ai_plan.unit_nights_short')}</span>
            </div>
          ))}
          {/* Return/finish — shown only for a round-trip (finish == origin). */}
          {returnCity?.city_name && <CityAnchorRow label={t('ai_plan.end')} city={returnCity} />}
        </div>
      )}

      {/* Prompt chips */}
      {aiState === 'prompt' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {[t('ai_plan.chip_italy'), t('ai_plan.chip_japan'), t('ai_plan.chip_balkans')].map((p) => (
            <button key={p} onClick={() => setPrompt(p)} className="t-meta" style={{ padding: '6px 12px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 999, cursor: 'pointer', color: 'var(--ink-2)' }}>{p}</button>
          ))}
        </div>
      )}
    </div>
  );
}
