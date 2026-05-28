import React from 'react';
import { Calendar, MapPin, Clock, Activity, Loader2 } from 'lucide-react';
import { useT } from '@/lib/i18n/I18nContext';

/**
 * Read-only preview of an AI-generated trip draft.
 * Shows cities, dates, and activities in a compact card format.
 */
export default function AiTripDraftPreview({ draft, loading }) {
  const t = useT();

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-3 mb-2">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
            <div className="font-semibold text-lg text-muted-foreground">Generating your trip...</div>
          </div>
          <div className="space-y-2">
            <div className="h-4 bg-muted rounded animate-pulse w-3/4"></div>
            <div className="h-3 bg-muted rounded animate-pulse w-1/2"></div>
          </div>
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border border-border bg-card/50 p-3.5 space-y-2">
              <div className="h-4 bg-muted rounded animate-pulse w-1/3"></div>
              <div className="h-3 bg-muted rounded animate-pulse w-1/4"></div>
              <div className="space-y-2 pt-2">
                <div className="h-3 bg-muted rounded animate-pulse w-2/3"></div>
                <div className="h-3 bg-muted rounded animate-pulse w-1/2"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!draft) return null;

  return (
    <div className="space-y-4">
      {/* Trip header */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="font-semibold text-lg mb-1">{draft.title || t('ai_plan.default_trip_title')}</h3>
        {draft.description && (
          <p className="text-sm text-muted-foreground">{draft.description}</p>
        )}
      </div>

      {/* Cities timeline */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider font-semibold text-muted-foreground">
          <MapPin className="w-3.5 h-3.5" />
          {t('ai_plan.cities')}
        </div>

        {draft.cities?.map((city, idx) => (
          <div key={idx} className="rounded-xl border border-border bg-card/50 p-3.5 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-foreground">{city.city_name}</div>
                <div className="text-xs text-muted-foreground">{city.country}</div>
              </div>
              <div className="text-xs text-muted-foreground whitespace-nowrap">
                {city.kind === 'start' ? t('ai_plan.start') : city.kind === 'end' ? t('ai_plan.end') : ''}
              </div>
            </div>

            {city.start_date && city.end_date && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-3 h-3" />
                  <span>{new Date(city.start_date).toLocaleDateString()} — {new Date(city.end_date).toLocaleDateString()}</span>
                </div>
              </div>
            )}

            {/* Activities */}
            {city.activities?.length > 0 && (
              <div className="border-t border-border pt-2 mt-2 space-y-1.5">
                {city.activities.map((activity, actIdx) => (
                  <div key={actIdx} className="flex items-start gap-2 text-sm">
                    <Activity className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-foreground truncate">{activity.title}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                        {activity.date && (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-2.5 h-2.5" />
                            {new Date(activity.date).toLocaleDateString()}
                          </span>
                        )}
                        {activity.start_time && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-2.5 h-2.5" />
                            {activity.start_time}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}