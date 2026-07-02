/**
 * EventPanels — in-place editor LEFT-PANEL chrome (Lumo `.lp` shell) for the
 * event view/edit/delete panel.
 *
 * CHROME-ONLY (TRIP-176 unification): the per-kind view BODY is the canonical
 * `EventViewSections` (EventViewBody.jsx), shared with the dialog shell
 * (EventModal) — there is no duplicate per-kind body here anymore. This module
 * keeps only the tinted panel header/footer shell + the kind→icon map.
 *
 * Used by EventSourcePanel (view shell).
 */
import React from 'react';
import { X } from 'lucide-react';
import { useI18n } from '@/lib/i18n/I18nContext';
import { Icon } from '@/design/icons';

const EV = {
  hotel:    { color: 'var(--ev-hotel)',    soft: 'var(--ev-hotel-soft)',    ink: 'var(--ev-hotel-ink)' },
  transfer: { color: 'var(--ev-transfer)', soft: 'var(--ev-transfer-soft)', ink: 'var(--ev-transfer-ink)' },
  activity: { color: 'var(--ev-activity)', soft: 'var(--ev-activity-soft)', ink: 'var(--ev-activity-ink)' },
  service:  { color: 'var(--ev-car)',      soft: 'var(--ev-car-soft)',      ink: 'var(--ev-car-ink)' },
};
const TKIND = {
  plane: { icon: 'plane' }, train: { icon: 'train' }, bus: { icon: 'bus' },
  car: { icon: 'car' }, ferry: { icon: 'ferry' }, taxi: { icon: 'car' },
};

export function kindIcon(kind, entity) {
  if (kind === 'transfer') return (TKIND[entity?.transport_type] || TKIND.plane).icon;
  return kind === 'hotel' ? 'bed' : kind === 'activity' ? 'ticket' : 'car';
}

// ── panel shell (Lumo .lp, tinted per-kind header + close (×) button + footer) ─
export function PanelShell({ kind = 'hotel', icon, eyebrow, title, sub, onBack, foot, footClass = '', children }) {
  const { t } = useI18n();
  const ev = EV[kind] || EV.hotel;
  return (
    <div className="lp lp--wide" style={{ '--ev-color': ev.color, '--ev-soft': ev.soft, '--ev-ink': ev.ink }}>
      <div className="lp-h lp-h--ev">
        <span className="lp-ic" style={{ background: ev.color, color: '#fff' }}><Icon name={icon || kindIcon(kind)} size={17} /></span>
        <div className="lp-ti">
          {eyebrow && <div className="eyebrow" style={{ color: ev.color }}>{eyebrow}</div>}
          <div className="lp-tirow">
            <b className="t-title">{title}</b>
            {sub && <span className="t-meta">{sub}</span>}
          </div>
        </div>
        <button className="ev-dlg-close" onClick={onBack} title={t('common.back')} aria-label={t('common.back')}><X size={15} /></button>
      </div>
      <div className="lp-b scrollbar-thin">{children}</div>
      {foot && <div className={'lp-f' + (footClass ? ' ' + footClass : '')}>{foot}</div>}
    </div>
  );
}
