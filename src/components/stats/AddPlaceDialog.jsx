import React, { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { invokeFn } from '@/lib/invokeFn';
import { errorText } from '@/lib/errorText';
import { useAuth } from '@/lib/AuthContext';
import { useI18n } from '@/lib/i18n/I18nContext';
import { successToast } from '@/lib/successToast';
import { Dialog, Btn, Card, Field, useToast } from '@/design/index';
import CountryFlag from '@/components/common/CountryFlag';
import DateTimeInput from '@/components/common/DateTimeInput';
import CitySearch from '@/components/cities/CitySearch';
import { useConfirm } from '@/components/common/ConfirmProvider';

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
  const [deleting, setDeleting] = useState(false);

  // (Re)initialise whenever the dialog opens (add vs edit).
  useEffect(() => {
    if (!open) return;
    setErr(''); setSaving(false); setDeleting(false);
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
    // Запись идёт единой дверью (шов user-place/place), не прямым REST в таблицу.
    // user_id НЕ шлём — его ставит сам шов из актора JWT (scope.column='user_id'),
    // владение/IDOR закрыты по построению. Identity + display по модели trip-city
    // (TRIP-65): geonameid дедупит кросс-локально, name_i18n — снимок локали, оба
    // из выбора CitySearch. На правке шлём id строкой: шов адресует update по нему,
    // а user_custom_visits.id — bigint (в теле нужен string, иначе шов сочтёт это
    // вставкой).
    const body = {
      geonameid: city.geonameid ?? null,
      name_i18n: city.name_i18n || null,
      country_code: city.country_code || null,
      lat: city.latitude ?? null,
      lng: city.longitude ?? null,
      start_date: from,
      end_date: to,
      ...(isEdit ? { id: String(editing.id) } : {}),
    };
    // invokeFn не бросает: отказ приезжает машинным code в КОРНЕ. Пользователю —
    // локализованный errorText(t, code), НЕ серверная проза (контракт TRIP-400).
    const { error, code } = await invokeFn('user-place/place', { body });
    if (error || code) {
      setSaving(false);
      setErr(errorText(t, code));
      return;
    }
    setSaving(false);
    refresh();
    successToast(t, isEdit ? 'visit_updated' : 'visit_added', { city: city.city_name });
    onSaved?.();
    onOpenChange(false);
  };

  const confirm = useConfirm();
  // Место удалялось БЕЗ подтверждения — `danger`-кнопка била в шов напрямую.
  // Спиннер держит кнопка подтверждения (`onConfirm` возвращает промис `remove`),
  // поэтому у самой кнопки удаления своего `loading` больше нет. Локальный
  // `deleting` остаётся, но ровно за одним: обе кнопки футера мьютит `saving`, а
  // `deleting` отличает «идёт удаление» от «идёт сохранение», чтобы спиннер не
  // зажигался на «Сохранить» во время удаления (`loading={saving && !deleting}`).
  const askDelete = () => confirm({
    title: t('stats.delete_place_q', { name: editing?.city_name || '' }),
    description: t('stats.delete_place_desc'),
    confirmLabel: t('common.delete'),
    variant: 'destructive',
    onConfirm: remove,
  });

  const remove = async () => {
    if (!isEdit) return;
    setSaving(true); setDeleting(true); setErr('');
    // Удаление той же дверью (шов user-place/place/delete): match {id, user_id:actor}
    // ставит buildPlan — чужую строку не удалить. id строкой (см. submit).
    const { error, code } = await invokeFn('user-place/place/delete', { body: { id: String(editing.id) } });
    if (error || code) {
      setSaving(false); setDeleting(false);
      setErr(errorText(t, code));
      return;
    }
    setSaving(false); setDeleting(false);
    refresh();
    successToast(t, 'visit_deleted');
    onSaved?.();
    onOpenChange(false);
  };

  const foot = (
    <div style={{ display: 'flex', gap: 10, width: '100%', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end' }}>
      {isEdit && (
        <Btn variant="danger" onClick={askDelete} disabled={saving} style={{ marginRight: 'auto' }}>
          {t('stats.delete_btn')}
        </Btn>
      )}
      <Btn variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>{t('common.cancel') || 'Cancel'}</Btn>
      <Btn variant="primary" icon="check" onClick={submit} loading={saving && !deleting} disabled={saving}>
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
          /* Та же звёздочка, что и в ветке выбора: поле одно и то же, и город
             обязателен независимо от того, выбран он уже или ещё нет. Раньше
             `required` стоял только на одной ветке, и звёздочка на одном и том же
             поле то появлялась, то исчезала (TRIP-333). */
          <Field label={t('stats.field_city')} required>
            {/* TRIP-343 объект 2 (канал 3): скин поверхности снят с инлайна на Card;
                усиленная рамка (--line-strong) остаётся остаточным тинтом инлайном. */}
            <Card radius="md" pad="none" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderColor: 'var(--line-strong)' }}>
              <span className="t-subheading" style={{ display: 'inline-flex', alignItems: 'center' }}><CountryFlag code={city?.country_code} /></span>
              <b className="t-subheading" style={{ flex: 1, minWidth: 0, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{city?.city_name}</b>
              <Btn variant="link" onClick={() => setPicking(true)}>{t('stats.change_city')}</Btn>
            </Card>
          </Field>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {/* Не нативный `type="date"`: тот рисуется по локали ОС - см. DateTimeInput.jsx */}
          <Field label={t('stats.field_from')}><DateTimeInput withTime={false} value={from} onChange={setFrom} /></Field>
          <Field label={t('stats.field_to')}><DateTimeInput withTime={false} value={to} onChange={setTo} /></Field>
        </div>

        {err && <div className="t-meta" style={{ color: 'var(--danger)' }}>{err}</div>}
      </div>
    </Dialog>
  );
}
