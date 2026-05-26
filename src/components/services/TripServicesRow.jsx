import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Sparkles, Smartphone, Car, ShieldCheck, ChevronDown, Plus, ExternalLink } from 'lucide-react';
import ServiceDialog from './ServiceDialog';
import { useI18nFormat } from '@/lib/i18n/I18nContext';

const KIND_IDS_ROW = ['esim', 'car_rental', 'insurance'];
const KIND_ICONS_ROW = { esim: Smartphone, car_rental: Car, insurance: ShieldCheck };

export default function TripServicesRow({ tripId, readOnly = false }) {
  const { t } = useI18nFormat();
  const KINDS = KIND_IDS_ROW.map((id) => ({ id, Icon: KIND_ICONS_ROW[id], label: t(`service.kind.${id}`) }));
  const [expanded, setExpanded] = useState(false);
  const [dialog, setDialog] = useState({ open: false, kind: null, service: null });

  const { data: services = [] } = useQuery({
    queryKey: ['trip-services', tripId],
    queryFn: () => base44.entities.TripService.filter({ trip_id: tripId }),
    enabled: !!tripId,
  });

  const byKind = KINDS.reduce((acc, k) => {
    acc[k.id] = services.filter(s => s.kind === k.id);
    return acc;
  }, {});

  const added = services.length;

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full px-4 py-3 min-h-[64px] flex items-center gap-3 hover:bg-secondary/40 transition text-left"
      >
        <div className="w-9 h-9 rounded-full bg-violet-100 dark:bg-violet-950/40 flex items-center justify-center shrink-0">
          <Sparkles className="w-4 h-4 text-violet-700 dark:text-violet-300" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold">{t('service.more')}</span>
            {added > 0 ? (
              <span className="text-xs text-muted-foreground">· {added}</span>
            ) : (
              <span className="text-xs text-muted-foreground">{t('service.row_summary')}</span>
            )}
          </div>

          {/* Added services preview */}
          {added > 0 && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {services.map(s => {
                const meta = KINDS.find(k => k.id === s.kind);
                const Icon = meta?.Icon || Sparkles;
                return (
                  <span
                    key={s.id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary text-[11px] font-medium"
                  >
                    <Icon className="w-3 h-3" />
                    {s.name}
                  </span>
                );
              })}
            </div>
          )}
        </div>
        <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="px-4 pb-3 pt-1 space-y-2 border-t bg-secondary/20">
          {KINDS.map(k => {
            const items = byKind[k.id] || [];
            return (
              <div key={k.id} className="rounded-lg bg-card border p-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-md bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 flex items-center justify-center shrink-0">
                    <k.Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0 text-sm font-medium">{k.label}</div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled
                      title={t('service.row_soon')}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-border bg-card text-xs font-medium opacity-50 cursor-not-allowed"
                    >
                      <ExternalLink className="w-3 h-3" />{t('service.row_register')}
                    </button>
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => setDialog({ open: true, kind: k.id, service: null })}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition"
                      >
                        <Plus className="w-3 h-3" />{t('common.add')}
                      </button>
                    )}
                  </div>
                </div>

                {items.length > 0 && (
                  <div className="mt-2 pl-10 space-y-1">
                    {items.map(s => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => !readOnly && setDialog({ open: true, kind: s.kind, service: s })}
                        className="w-full text-left px-2 py-1 rounded text-xs hover:bg-secondary/60 transition truncate"
                        disabled={readOnly}
                      >
                        {s.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ServiceDialog
        open={dialog.open}
        onOpenChange={(o) => setDialog(d => ({ ...d, open: o }))}
        tripId={tripId}
        kind={dialog.kind}
        service={dialog.service}
      />
    </div>
  );
}