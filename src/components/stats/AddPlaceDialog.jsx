import React, { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { writeRows } from '@/lib/trip-data';
import { useAuth } from '@/lib/AuthContext';
import { useI18n } from '@/lib/i18n/I18nContext';
import { Dialog, Btn, Field, useToast } from '@/design/index';
import CountryFlag from '@/components/common/CountryFlag';
import CitySearch from '@/components/cities/CitySearch';

// Add / edit / delete a manual visit (user_custom_visits) — the write side of the
// "My statistics" map. Backend (table + RLS by auth.uid() + the custom-point
// branch of get_user_travel_stats) already ships in migration 0042; this is the
// FE only. Reuses the canonical Dialog shell, the CitySearch autocomplete (which
// also renders the required LocationIQ attribution) and the shared toast.
//
// `editing` = a custom point from the stats payload (kind:'custom') with its
//   user_custom_visits id, or null to add. On success the travel-stats query is
//   invalidated so the new/edited pin + every aggregate refresh.

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function AddPlaceDialog({ open, onOpenChange, editing = null, onSaved }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isEdit = !!editing;

  const [city, setCity] = useState(null);   // { geonameid, name_i18n, city_name, country_code, latitude, longitude }
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [picking, setPicking] = useState(true);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  // (Re)initialise whenever the dialog opens (add vs edit).
  useEffect(() => {
    if (!open) return;
    setErr(''); setSaving(false);
    if (editing) {
      setCity({ geonameid: editing.geonameid ?? null, name_i18n: editing.name_i18n || null, city_name: editing.city_name, country_code: editing.country_code, latitude: editing.lat, longitude: editing.lng });
      setFrom(editing.start_date || todayISO());
      setTo(editing.end_date || editing.start_date || todayISO());
      setPicking(false);
    } else {
      setCity(null); setFrom(todayISO()); setTo(todayISO()); setPicking(true);
    }
  }, [open, editing]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['travel-stats', user?.id] });

  const submit = async () => {
    if (!city) { setErr(t('stats.err_pick_city')); return; }
    if (!from || !to) { setErr(t('stats.err_dates')); return; }
    if (from > to) { setErr(t('stats.err_date_order')); return; }
    if (!user?.id) { setErr(t('stats.err_dates')); return; }
    setSaving(true); setErr('');
    // user_id is set explicitly: the RLS insert/update policy requires it to equal
    // auth.uid() (a user can only write their own visits).
    // Identity + display follow the trip-city model (TRIP-65): geonameid dedups
    // cross-locale, name_i18n is the localized snapshot. Both come straight from
    // the CitySearch pick. The dropped city_name column is no longer written.
    const row = {
      user_id: user.id,
      geonameid: city.geonameid ?? null,
      name_i18n: city.name_i18n || null,
      country_code: city.country_code || null,
      lat: city.latitude ?? null,
      lng: city.longitude ?? null,
      start_date: from,
      end_date: to,
    };
    try {
      // writeRows: reads the result, so a silent 0-row RLS reject on update
      // (session expired / not your visit) no longer looks like success.
      await writeRows(isEdit
        ? supabase.from('user_custom_visits').update(row).eq('id', editing.id)
        : supabase.from('user_custom_visits').insert(row));
    } catch (e) {
      setSaving(false);
      console.error('user_custom_visits save failed:', e?.message);
      setErr(t('stats.err_save'));
      return;
    }
    setSaving(false);
    refresh();
    toast({ variant: 'success', title: isEdit ? t('stats.saved_toast') : t('stats.added_toast', { city: city.city_name }) });
    onSaved?.();
    onOpenChange(false);
  };

  const remove = async () => {
    if (!isEdit) return;
    setSaving(true); setErr('');
    try {
      await writeRows(supabase.from('user_custom_visits').delete().eq('id', editing.id), { expectRow: false });
    } catch (e) {
      setSaving(false);
      console.error('user_custom_visits delete failed:', e?.message);
      setErr(t('stats.err_delete'));
      return;
    }
    setSaving(false);
    refresh();
    toast({ variant: 'success', title: t('stats.deleted_toast') });
    onSaved?.();
    onOpenChange(false);
  };

  const foot = (
    <div style={{ display: 'flex', gap: 10, width: '100%', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end' }}>
      {isEdit && (
        <Btn variant="danger" size="sm" onClick={remove} disabled={saving} style={{ marginRight: 'auto' }}>
          {t('stats.delete_btn')}
        </Btn>
      )}
      <Btn variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>{t('common.cancel') || 'Cancel'}</Btn>
      <Btn variant="primary" size="sm" icon="check" onClick={submit} disabled={saving}>
        {isEdit ? t('stats.save_btn') : t('stats.add_btn')}
      </Btn>
    </div>
  );

  return (
    <Dialog
      title={isEdit ? t('stats.edit_place') : t('stats.add_place')}
      icon={isEdit ? 'edit' : 'plus'}
      size="sm"
      open={open}
      onOpenChange={onOpenChange}
      foot={foot}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {picking ? (
          <Field label={t('stats.field_city')} required>
            <CitySearch onSelect={(c) => { setCity(c); setPicking(false); setErr(''); }} />
          </Field>
        ) : (
          <Field label={t('stats.field_city')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid var(--line-strong)', borderRadius: 'var(--r-btn)', background: 'var(--surface)' }}>
              <span className="t-subheading" style={{ display: 'inline-flex', alignItems: 'center' }}><CountryFlag code={city?.country_code} /></span>
              <b className="t-ui" style={{ flex: 1, minWidth: 0, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{city?.city_name}</b>
              <button type="button" onClick={() => setPicking(true)} className="t-meta" style={{ border: 0, background: 'transparent', color: 'var(--primary)', cursor: 'pointer', padding: 0 }}>
                {t('stats.change_city')}
              </button>
            </div>
          </Field>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label={t('stats.field_from')}><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label={t('stats.field_to')}><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>

        {err && <div className="t-meta" style={{ color: 'var(--danger)' }}>{err}</div>}
      </div>
    </Dialog>
  );
}
