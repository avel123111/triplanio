import React from 'react';
import { Icon } from '../../design/icons';
import { Btn } from '../../design/index';
import { useT } from '@/lib/i18n/I18nContext';

const AI = 'var(--ai)';

function aiBtnStyle() {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 16px', borderRadius: 11, border: 'none',
    background: `linear-gradient(135deg, ${AI} 0%, #7a4ee2 50%, #c66ce2 100%)`, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
    boxShadow: `0 8px 20px -10px color-mix(in srgb, ${AI} 75%, transparent)`,
  };
}

// =====================================================================
// AI ENTRY PANEL - the method-specific entry for the unified create flow.
// Prompt → generating → draft. Once a draft is accepted, the remaining
// steps (skeleton / return / review) are the shared manual-planner ones.
//   ctx: { aiState, prompt, setPrompt, aiComment, cities, hasDraft,
//          onGenerate(promptText), goNext }
// =====================================================================
export default function PanelAi({ ctx }) {
  const t = useT();
  const { aiState, prompt, setPrompt, aiComment, cities = [], onGenerate, goNext } = ctx;
  const totalNights = cities.reduce((s, c) => s + (+c.nights || 0), 0);
  const canPrompt = prompt.trim().length > 0 && aiState !== 'generating';

  let statusText;
  if (aiState === 'generating') statusText = t('ai_plan.status_generating');
  else if (aiState === 'draft') statusText = aiComment || t('ai_plan.status_ready');
  else statusText = t('ai_plan.status_waiting');

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 18 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: `linear-gradient(135deg, ${AI}, #c66ce2)`, color: '#fff', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <Icon name="sparkles" size={22} />
        </div>
        <div>
          <h1 style={{ marginBottom: 6, letterSpacing: '-0.025em' }}>{t('ai_plan.title')}</h1>
          <div className="muted" style={{ fontSize: 15, lineHeight: 1.5 }}>{t('ai_plan.page_subtitle')}</div>
        </div>
      </div>

      <div style={{ background: 'var(--surface)', border: `1.5px solid color-mix(in srgb, ${AI} 22%, var(--line))`, borderRadius: 14, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ width: 24, height: 24, borderRadius: '50%', background: `linear-gradient(135deg, ${AI}, #c66ce2)`, color: '#fff', display: 'grid', placeItems: 'center' }}><Icon name="sparkles" size={12} /></span>
          <div style={{ fontSize: 13, fontWeight: 600, color: AI }}>{t('ai_plan.assistant_label')}</div>
          <span className="muted" style={{ fontSize: 11.5, marginLeft: 'auto' }}>{t('ai_plan.assistant_hint')}</span>
        </div>
        <textarea
          className="textarea"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canPrompt) { e.preventDefault(); onGenerate(prompt.trim()); } }}
          disabled={aiState === 'generating'}
          placeholder={aiState === 'draft' ? t('ai_plan.prompt_placeholder_refine') : t('ai_plan.prompt_placeholder_initial')}
          style={{ minHeight: 110, border: 'none', padding: 0, background: 'transparent', fontSize: 14.5, lineHeight: 1.55, width: '100%', resize: 'none' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, alignItems: 'center', gap: 8 }}>
          <span className="muted" style={{ fontSize: 11 }}>{t('ai_plan.shortcut_hint')}</span>
          {aiState === 'generating' ? (
            <button disabled style={{ ...aiBtnStyle(), opacity: 0.8, cursor: 'default' }}>
              {t('ai_plan.thinking')} <span className="ai-dots" style={{ marginLeft: 4 }}><span /><span /><span /></span>
            </button>
          ) : aiState === 'draft' ? (
            <Btn variant="ai" size="sm" icon="refresh" disabled={!canPrompt} onClick={() => onGenerate(prompt.trim())}>{t('ai_plan.regenerate')}</Btn>
          ) : (
            <button onClick={() => canPrompt && onGenerate(prompt.trim())} disabled={!canPrompt} style={{ ...aiBtnStyle(), opacity: canPrompt ? 1 : 0.5, cursor: canPrompt ? 'pointer' : 'not-allowed' }}>
              <Icon name="sparkles" size={15} /> {t('ai_plan.generate_draft')}
            </button>
          )}
        </div>
      </div>

      {/* assistant status reply */}
      <div style={{ marginTop: 14, padding: 14, background: `color-mix(in srgb, ${AI} 7%, transparent)`, borderRadius: 12, fontSize: 13.5, lineHeight: 1.55, color: 'var(--ink-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ width: 22, height: 22, borderRadius: '50%', background: `linear-gradient(135deg, ${AI}, #c66ce2)`, color: '#fff', display: 'grid', placeItems: 'center' }}><Icon name="sparkles" size={11} /></span>
          <b style={{ color: AI, fontSize: 12.5 }}>{t('ai_plan.assistant_label')}</b>
          {aiState === 'generating' && <span className="ai-dots" style={{ color: AI, marginLeft: 'auto' }}><span /><span /><span /></span>}
        </div>
        <span style={{ whiteSpace: 'pre-wrap' }}>{statusText}</span>
      </div>

      {/* draft city list */}
      {aiState === 'draft' && cities.length > 0 && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="eyebrow">{t('ai_plan.draft_label')}</div>
          {cities.map((c, i) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 11 }}>
              <div style={{ width: 24, height: 24, borderRadius: '50%', background: AI, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 11.5, fontWeight: 700, flexShrink: 0 }}>{i + 1}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{c.city_name} <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>{c.country}</span></div>
              </div>
              <span className="muted num" style={{ fontSize: 12 }}>{c.nights} ноч.</span>
            </div>
          ))}
        </div>
      )}

      {/* prompt chips */}
      {aiState === 'prompt' && (
        <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {[t('ai_plan.chip_italy'), t('ai_plan.chip_japan'), t('ai_plan.chip_balkans')].map((p) => (
            <button key={p} onClick={() => setPrompt(p)} style={{ padding: '6px 12px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 999, fontSize: 12.5, cursor: 'pointer', color: 'var(--ink-2)' }}>{p}</button>
          ))}
        </div>
      )}

      {/* footer - proceed to skeleton once a draft exists */}
      <div style={{ marginTop: 28, paddingTop: 18, borderTop: '1px solid var(--line-2)', display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ flex: 1 }} />
        <button onClick={goNext} disabled={aiState !== 'draft'} style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 18px', borderRadius: 11, border: 'none',
          background: aiState !== 'draft' ? 'var(--line)' : AI, color: aiState !== 'draft' ? 'var(--muted-2)' : '#fff',
          fontSize: 13.5, fontWeight: 600, cursor: aiState !== 'draft' ? 'not-allowed' : 'pointer',
        }}>
          К скелету <Icon name="arrowR" size={15} />
          <span className="num" style={{ marginLeft: 4, opacity: 0.85 }}>{cities.length ? `· ${cities.length} / ${totalNights}н` : ''}</span>
        </button>
      </div>
    </div>
  );
}
