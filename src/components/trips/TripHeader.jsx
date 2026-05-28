import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Pencil, Trash2, Calendar, MapPin, StickyNote, MoreHorizontal } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import TripFormDialog from './TripFormDialog';
import ProBadge from '@/components/subscriptions/ProBadge';
import { countryFlag } from '@/lib/geo';
import ReactMarkdown from 'react-markdown';
import { formatTripRange } from '@/lib/trip-dates';
import { uniqueCityCount } from '@/lib/trip-cities';
import { useCityImageForVisits } from '@/lib/city-image';
import { getGradientById } from '@/lib/trip-gradients';
import { base44 } from '@/api/base44Client';
import { useI18nFormat } from '@/lib/i18n/I18nContext';

export default function TripHeader({ trip, visits = [] }) {
  const { t, plural } = useI18nFormat();
  const cities = visits;
  const events = visits;
  const qc = useQueryClient();
  const nav = useNavigate();
  const [editing, setEditing] = useState(false);
  const [showNotes, setShowNotes] = useState(false);

  const del = useMutation({
    mutationFn: () => base44.entities.Trip.delete(trip.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trips'] });
      nav('/');
    },
  });

  const uniqueCountries = [...new Set(cities.map(c => c.country_code).filter(Boolean))];
  const dateRange = formatTripRange(events, t('trip.no_dates'));
  const cityCount = uniqueCityCount(cities);

  // Cover priority: uploaded photo → preset gradient → Wikipedia city image →
  // globe emoji. The Wikipedia hook is always fired (rules of hooks), but the
  // value is only used when no photo and no gradient are set.
  const cityImg = useCityImageForVisits(visits);
  const gradient = getGradientById(trip.cover_gradient);
  const useGradient = !trip.cover_image_url && !!gradient;

  const handleDelete = () => {
    if (window.confirm(t('trip.delete_trip_confirm'))) del.mutate();
  };

  return (
    <div className="mb-6">
      <div className="rounded-2xl overflow-hidden border border-border bg-card">
        <div
          className="relative h-48 sm:h-56 bg-gradient-to-br from-primary/30 via-accent/20 to-primary/10"
          style={useGradient ? { background: gradient.css } : undefined}
        >
          {trip.cover_image_url ? (
            <img src={trip.cover_image_url} alt={trip.title} className="w-full h-full object-cover" />
          ) : !useGradient && cityImg ? (
            <img src={cityImg} alt={trip.title} className="w-full h-full object-cover" />
          ) : !useGradient ? (
            <div className="w-full h-full flex items-center justify-center text-7xl opacity-30">🌍</div>
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

          <div className="absolute top-3 right-3 z-10">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 bg-black/30 hover:bg-black/50 text-white border-0 rounded-full"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setEditing(true)}>
                  <Pencil className="w-4 h-4 mr-2" />
                  {t('trip.edit_metadata')}
                </DropdownMenuItem>
                <DropdownMenuItem className="text-destructive" onClick={handleDelete}>
                  <Trash2 className="w-4 h-4 mr-2" />
                  {t('trip.delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="absolute bottom-0 left-0 right-0 p-5 text-white">
            <div className="flex items-center gap-3">
              <h1 className="font-display font-bold text-3xl sm:text-4xl drop-shadow leading-tight">{trip.title}</h1>
              {trip.is_pro_trip && <ProBadge size="md" />}
            </div>
            {trip.description && <p className="text-sm mt-1 opacity-90 drop-shadow line-clamp-2">{trip.description}</p>}
          </div>
        </div>

        <div className="px-5 py-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm border-t border-border">
          <span className="inline-flex items-center gap-1.5"><Calendar className="w-4 h-4 text-muted-foreground" />{dateRange}</span>
          <span className="inline-flex items-center gap-1.5"><MapPin className="w-4 h-4 text-muted-foreground" />{cityCount} {plural(cityCount, 'trip.cities_count')}</span>
          {uniqueCountries.length > 0 && (
            <span className="inline-flex items-center gap-1 text-lg">{uniqueCountries.map(cc => <span key={cc}>{countryFlag(cc)}</span>)}</span>
          )}
          {trip.notes && (
            <button onClick={() => setShowNotes(s => !s)} className="ml-auto inline-flex items-center gap-1.5 text-primary hover:underline text-sm">
              <StickyNote className="w-4 h-4" />{showNotes ? t('trip.hide_notes') : t('trip.show_notes')}
            </button>
          )}
        </div>

        {showNotes && trip.notes && (
          <div className="px-5 py-4 border-t border-border bg-secondary/40">
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown>{trip.notes}</ReactMarkdown>
            </div>
          </div>
        )}
      </div>

      <TripFormDialog open={editing} onOpenChange={setEditing} trip={trip} visits={visits} />
    </div>
  );
}
