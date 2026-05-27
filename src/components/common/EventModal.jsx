import React, { useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { Icon } from '@/design/icons';
import { Btn, Badge, fmt } from '@/design/index';
import { parseNaive } from '@/lib/naive-time';
import { getEntityDocuments, getDetailsDocuments } from '@/lib/documents';

/**
 * EventModal — unified, new-design read view for a timeline event
 * (hotel, transfer/flight, activity, car rental). Self-contained controlled
 * overlay; no ModalHost dependency.
 *
 * Props:
 *   event    — { kind, entity, visit?, fromVisit?, toVisit?, tripId? }
 *              kind ∈ 'hotel' | 'transfer' | 'activity' | 'service'
 *   canEdit  — boolean (hide Edit/Delete for viewers)
 *   onClose  — () => void
 *   onEdit   — () => void
 *   onDelete — () => void   (parent owns the confirm + delete + refetch)
 */

const TABLE_BY_KIND = {
  hotel: 'hotel_stays',
  transfer: 'transfers',
  activity: 'activities',
  service: 'trip_services',
};

const TRANSPORT_ICONS = { plane: 'plane', train: 'train', bus: 'bus', car: 'car', ferry: 'ferry', walk: 'walk' };

function fmtDT(iso) {
  const d = parseNaive(iso);
  return d ? d.setLocale('ru').toFormat('d MMM, HH:mm') : '';
}

function eventTheme(event) {
  const { kind, entity } = event;
  if (kind === 'hotel') return { color: 'var(--ev-hotel)', soft: 'var(--ev-hotel-soft)', icon: 'bed', label: 'Проживание' };
  if (kind === 'activity') {
    const icon = entity?.category === 'food' ? 'cup' : entity?.category === 'sight' ? 'cam' : 'spark';
    return { color: 'var(--ev-activity)', soft: 'var(--ev-activity-soft)', icon, label: 'Активность' };
  }
  if (kind === 'service') return { color: 'var(--ev-car)', soft: 'var(--ev-car-soft)', icon: 'car', label: 'Аренда авто' };
  // transfer / flight
  const tt = entity?.transport_type;
  const isFlight = tt === 'plane';
  return {
    color: 'var(--ev-transfer)', soft: 'var(--ev-transfer-soft)',
    icon: TRANSPORT_ICONS[tt] || 'car', label: isFlight ? 'Перелёт' : 'Переезд',
  };
}

function Section({ icon, color, title, children }) {
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 14, background: 'var(--surface)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 13, marginBottom: 10 }}>
        {icon && <Icon name={icon} size={15} style={{ color }} />}{title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </div>
  );
}

function Row({ label, value, mono }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 10, fontSize: 13, alignItems: 'baseline' }}>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div className={mono ? 'mono' : ''} style={{ minWidth: 0, wordBreak: 'break-word', fontSize: mono ? 12.5 : 13 }}>{value}</div>
    </div>
  );
}

export default function EventModal({ event, canEdit = false, onClose, onEdit, onDelete }) {
  const { kind, entity, visit, fromVisit, toVisit } = event || {};
  const isService = kind === 'service';
  const details = isService ? (entity?.details || {}) : null;

  const [docs, setDocs] = useState(() =>
    isService ? getDetailsDocuments(details) : getEntityDocuments(entity));
  const [uploading, setUploading] = useState(false);

  if (!event || !entity) return null;
  const theme = eventTheme(event);
  const cur = (isService ? (entity.currency || details?.currency) : entity.currency) || 'EUR';
  const price = isService ? (entity.price ?? details?.price) : entity.price;

  const title = kind === 'hotel' ? entity.name
    : kind === 'activity' ? entity.title
    : kind === 'service' ? entity.name
    : (entity.carrier || theme.label);

  const subtitle = kind === 'hotel' ? entity.address
    : kind === 'activity' ? [entity.location_name, entity.location_address].filter(Boolean).join(' · ')
    : kind === 'transfer' ? `${fromVisit?.city_name || entity.from_address || '—'} → ${toVisit?.city_name || entity.to_address || '—'}`
    : (details?.pickup_address || '');

  const close = () => onClose?.();

  async function persistDocs(next) {
    const table = TABLE_BY_KIND[kind];
    if (!table || !entity.id) return;
    if (isService) {
      await supabase.from(table).update({ details: { ...details, documents: next } }).eq('id', entity.id);
    } else {
      await supabase.from(table).update({ documents: next }).eq('id', entity.id);
    }
  }

  async function uploadFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length || !canEdit) return;
    const tooBig = files.find(f => f.size > 10 * 1024 * 1024);
    if (tooBig) { alert('Файл слишком большой (макс. 10 МБ)'); return; }
    setUploading(true);
    try {
      const uploaded = [];
      for (const file of files) {
        const uid = (crypto?.randomUUID?.()) || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const path = `attachments/${uid}/${file.name}`;
        const { error: upErr } = await supabase.storage.from('documents').upload(path, file);
        if (upErr) { console.error('upload error', upErr); continue; }
        const { data: urlData } = await supabase.storage.from('documents').createSignedUrl(path, 315360000);
        uploaded.push({ file_url: urlData?.signedUrl || '', file_name: file.name, storage_path: path });
      }
      if (uploaded.length) {
        const next = [...docs, ...uploaded];
        setDocs(next);
        await persistDocs(next);
      }
    } finally {
      setUploading(false);
    }
  }

  const bookingUrl = isService ? details?.booking_url : entity.booking_url;
  const bookingRef = isService ? details?.booking_reference : entity.booking_reference;

  return (
    <div className="dlg-backdrop" style={{ zIndex: 260 }}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="dlg">
        {/* Header */}
        <div className="dlg__head">
          <div style={{ width: 40, height: 40, borderRadius: 11, background: theme.soft, color: theme.color, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Icon name={theme.icon} size={19} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ fontSize: 19, lineHeight: 1.2 }}>{title || theme.label}</h2>
            {subtitle && <div className="muted" style={{ fontSize: 12.5, marginTop: 2, wordBreak: 'break-word' }}>{subtitle}</div>}
          </div>
          <button className="icon-btn" onClick={close}><Icon name="close" size={16} /></button>
        </div>

        {/* Body */}
        <div className="dlg__body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Badge variant="" >{theme.label}</Badge>
            {price !== undefined && price !== null && price !== '' && (
              <span className="num" style={{ marginLeft: 'auto', fontWeight: 700, fontSize: 16 }}>{fmt(price, cur)}</span>
            )}
          </div>

          {/* Dates */}
          {kind === 'hotel' && (
            <Section icon="calendar" color={theme.color} title="Даты проживания">
              <Row label="Заезд" value={fmtDT(entity.check_in_datetime)} />
              <Row label="Выезд" value={fmtDT(entity.check_out_datetime)} />
            </Section>
          )}
          {(kind === 'transfer') && (
            <Section icon="calendar" color={theme.color} title="Время в пути">
              <Row label="Отправление" value={fmtDT(entity.start_datetime)} />
              <Row label="Прибытие" value={fmtDT(entity.end_datetime)} />
              <Row label="Перевозчик" value={entity.carrier} />
            </Section>
          )}
          {kind === 'activity' && (
            <Section icon="calendar" color={theme.color} title="Время">
              <Row label="Начало" value={fmtDT(entity.start_datetime)} />
              <Row label="Конец" value={fmtDT(entity.end_datetime)} />
            </Section>
          )}
          {isService && (
            <Section icon="calendar" color={theme.color} title="Аренда">
              <Row label="Получение" value={fmtDT(details?.pickup_at_local)} />
              <Row label="Возврат" value={fmtDT(details?.dropoff_at_local)} />
              <Row label="Где забрать" value={details?.pickup_address} />
              <Row label="Куда вернуть" value={details?.dropoff_address} />
            </Section>
          )}

          {/* Booking / payment */}
          {(bookingUrl || bookingRef || (kind === 'hotel' && entity.payment_status)) && (
            <Section icon="card" color={theme.color} title="Бронь и оплата">
              <Row label="Номер брони" value={bookingRef} mono />
              {kind === 'hotel' && <Row label="Оплата" value={entity.payment_status} />}
              {bookingUrl && (
                <a href={bookingUrl} target="_blank" rel="noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--brand)', fontSize: 13, fontWeight: 500 }}>
                  <Icon name="external" size={14} /> Открыть бронь
                </a>
              )}
            </Section>
          )}

          {/* Contacts (hotel) */}
          {kind === 'hotel' && (entity.phone || entity.email) && (
            <Section icon="user" color={theme.color} title="Контакты">
              <Row label="Телефон" value={entity.phone} />
              <Row label="Email" value={entity.email} />
            </Section>
          )}

          {/* Notes */}
          {(entity.notes || details?.notes) && (
            <Section icon="file" color={theme.color} title="Заметки">
              <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{entity.notes || details?.notes}</div>
            </Section>
          )}

          {/* Documents */}
          <Section icon="paperclip" color={theme.color} title={`Документы${docs.length ? ` · ${docs.length}` : ''}`}>
            {docs.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {docs.map((d, i) => (
                  <a key={`${d.file_url}-${i}`} href={d.file_url} target="_blank" rel="noreferrer"
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8, background: 'var(--wash)', fontSize: 12.5, color: 'var(--brand)' }}>
                    <Icon name="file" size={14} style={{ flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-all' }}>{d.file_name || 'Файл'}</span>
                    <Icon name="external" size={12} style={{ opacity: 0.7 }} />
                  </a>
                ))}
              </div>
            )}
            {canEdit && (
              <label
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); uploadFiles(e.dataTransfer.files); }}
                style={{ display: 'block', cursor: uploading ? 'default' : 'pointer', border: '1.5px dashed var(--line)', borderRadius: 10, padding: 14, textAlign: 'center', color: 'var(--muted)', fontSize: 12.5 }}>
                <input type="file" multiple accept=".pdf,image/*" style={{ display: 'none' }}
                  onChange={(e) => uploadFiles(e.target.files)} disabled={uploading} />
                {uploading
                  ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Icon name="refresh" size={14} /> Загрузка…</span>
                  : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Icon name="upload" size={14} /> Перетащи или выбери файлы (PDF / фото)</span>}
              </label>
            )}
            {!canEdit && docs.length === 0 && (
              <div className="muted" style={{ fontSize: 12.5 }}>Документов нет</div>
            )}
          </Section>

          {/* AI assistant */}
          <div style={{ border: '1px solid var(--ai-soft, var(--line))', borderRadius: 12, padding: 14, background: 'var(--ai-soft, var(--wash))' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--ai, var(--brand))', color: 'white', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <Icon name="ai" size={15} />
              </div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Спросить ассистента</div>
            </div>
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 10 }}>
              Нужна помощь по этой брони — что взять с собой, как добраться, что рядом? Спроси в чате трипа.
            </div>
            <Btn variant="ghost" size="sm" icon="chat" onClick={() => { close(); window.__navigate?.('chat'); }}>
              Открыть чат с ассистентом
            </Btn>
          </div>
        </div>

        {/* Footer */}
        <div className="dlg__foot" style={{ justifyContent: 'space-between' }}>
          <div>
            {canEdit && onDelete && (
              <Btn variant="danger" icon="trash" onClick={onDelete}>Удалить</Btn>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="ghost" onClick={close}>Закрыть</Btn>
            {canEdit && onEdit && (
              <Btn variant="primary" icon="edit" onClick={onEdit}>Редактировать</Btn>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
