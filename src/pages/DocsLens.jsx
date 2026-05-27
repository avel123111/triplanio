/**
 * DocsLens — documents tab inside TripView.
 *
 * Props:
 *   tripId     — string
 *   isLoading  — boolean (parent loading state, passed as fallback)
 *
 * Reads/writes trip_documents table directly via Supabase client.
 * visibility: 'shared' = all members see it; 'private' = only the creator.
 */
import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { Icon } from '../design/icons';
import { Avatar, Badge, Btn, Card, Dialog, Field, EmptyState, Skeleton } from '../design/index';

// ─── query key ────────────────────────────────────────────────────────────────

const DOCS_KEY = (tripId) => ['trip-docs', tripId];

// ─── AddDocDialog ─────────────────────────────────────────────────────────────

function AddDocDialog({ tripId, defaultVisibility = 'shared' }) {
  const [title,      setTitle]      = useState('');
  const [notes,      setNotes]      = useState('');
  const [linkUrl,    setLinkUrl]    = useState('');
  const [visibility, setVisibility] = useState(defaultVisibility);
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');
  const qc   = useQueryClient();
  const { user } = useAuth();

  async function save() {
    if (!title.trim()) { setErr('Введи название документа'); return; }
    setSaving(true); setErr('');
    const { error } = await supabase.from('trip_documents').insert({
      trip_id:    tripId,
      title:      title.trim(),
      notes:      notes.trim()   || null,
      link_url:   linkUrl.trim() || null,
      visibility,
      created_by: user?.id ?? null,
    });
    setSaving(false);
    if (error) { setErr(error.message); return; }
    qc.invalidateQueries({ queryKey: DOCS_KEY(tripId) });
    window.__closeModal?.();
  }

  return (
    <Dialog title="Новый документ" icon="file" size=""
      foot={<>
        <Btn variant="ghost" onClick={() => window.__closeModal?.()}>Отмена</Btn>
        <Btn variant="primary" loading={saving} onClick={save}>Сохранить</Btn>
      </>}>
      {err && <div style={{ color: 'var(--danger)', fontSize: 12.5, marginBottom: 10 }}>{err}</div>}
      <Field label="Название">
        <input className="input" autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="Паспорт, Страховка, Чеклист…" />
      </Field>
      <div style={{ marginTop: 14 }}>
        <Field label="Доступ">
          <select className="select" value={visibility} onChange={e => setVisibility(e.target.value)}>
            <option value="shared">Общий — виден всем участникам</option>
            <option value="private">Личный — виден только мне</option>
          </select>
        </Field>
      </div>
      <div style={{ marginTop: 14 }}>
        <Field label="Ссылка (опц.)">
          <input className="input" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://…" />
        </Field>
      </div>
      <div style={{ marginTop: 14 }}>
        <Field label="Заметки (опц.)">
          <textarea className="textarea" rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Покрытие, даты, номер подтверждения…" />
        </Field>
      </div>
    </Dialog>
  );
}

// ─── DocDetailDialog ──────────────────────────────────────────────────────────

function DocDetailDialog({ doc, tripId }) {
  const [deleting, setDeleting] = useState(false);
  const qc = useQueryClient();

  async function handleDelete() {
    if (!window.confirm('Удалить документ «' + doc.title + '»?')) return;
    setDeleting(true);
    await supabase.from('trip_documents').delete().eq('id', doc.id);
    qc.invalidateQueries({ queryKey: DOCS_KEY(tripId) });
    window.__closeModal?.();
  }

  return (
    <Dialog title={doc.title} icon="file" size=""
      foot={<>
        <Btn variant="danger" loading={deleting} icon="trash" onClick={handleDelete}>Удалить</Btn>
        <div style={{ flex: 1 }} />
        <Btn variant="ghost" onClick={() => window.__closeModal?.()}>Закрыть</Btn>
      </>}>
      {doc.notes && (
        <div style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--ink-2)', marginBottom: 14 }}>{doc.notes}</div>
      )}
      {doc.link_url && (
        <div style={{ marginBottom: 12 }}>
          <a href={doc.link_url} target="_blank" rel="noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--brand)', fontSize: 13.5 }}>
            <Icon name="external" size={13} />
            {doc.link_url}
          </a>
        </div>
      )}
      {doc.documents?.length > 0 && (
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Файлы</div>
          {doc.documents.map((f, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid var(--line-2)' }}>
              <Icon name="file" size={14} style={{ color: 'var(--brand)', flexShrink: 0 }} />
              <a href={f.file_url} target="_blank" rel="noreferrer"
                style={{ fontSize: 13, color: 'var(--brand)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {f.file_name || f.file_url}
              </a>
            </div>
          ))}
        </div>
      )}
      {!doc.notes && !doc.link_url && !doc.documents?.length && (
        <div className="muted" style={{ fontSize: 13 }}>Нет содержимого. Добавь ссылку или файлы.</div>
      )}
    </Dialog>
  );
}

// ─── DocCard ──────────────────────────────────────────────────────────────────

function DocCard({ doc, tripId, scope }) {
  return (
    <button
      onClick={() => window.__openModal?.(<DocDetailDialog doc={doc} tripId={tripId} />)}
      style={{
        padding: 14, background: 'var(--surface)', border: '1px solid var(--line)',
        borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 8,
        cursor: 'pointer', textAlign: 'left',
        transition: 'border-color .15s, transform .1s',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = '#dbe1ec'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.transform = ''; }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 9,
          background: scope === 'personal' ? 'var(--warm-tint)' : 'var(--brand-soft)',
          color:      scope === 'personal' ? 'var(--warm)'     : 'var(--brand)',
          display: 'grid', placeItems: 'center',
        }}>
          <Icon name="file" size={17} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.title}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {(doc.documents?.length || 0)} {doc.documents?.length === 1 ? 'файл' : 'файла'}
            {doc.link_url && ' · ссылка'}
          </div>
        </div>
      </div>
      {doc.notes && (
        <div className="muted" style={{
          fontSize: 12.5, lineHeight: 1.5,
          overflow: 'hidden', textOverflow: 'ellipsis',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        }}>{doc.notes}</div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
        {doc.link_url && (
          <Badge variant="quiet" icon="external">
            {doc.link_url.replace(/^https?:\/\//, '').split('/')[0]}
          </Badge>
        )}
      </div>
    </button>
  );
}

// ─── DocEmpty ─────────────────────────────────────────────────────────────────

function DocEmpty({ scope, tripId }) {
  return (
    <div style={{ padding: '32px 24px', textAlign: 'center', border: '1.5px dashed var(--line)', borderRadius: 14, background: 'var(--wash)' }}>
      <div style={{
        width: 56, height: 56, margin: '0 auto 12px', borderRadius: 14,
        background: scope === 'personal' ? 'var(--warm-tint)' : 'var(--brand-soft)',
        color:      scope === 'personal' ? 'var(--warm)'     : 'var(--brand)',
        display: 'grid', placeItems: 'center',
      }}>
        <Icon name="file" size={26} />
      </div>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
        {scope === 'personal' ? 'Личных документов пока нет' : 'Общих документов пока нет'}
      </div>
      <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5, maxWidth: 360, margin: '0 auto 14px' }}>
        {scope === 'personal'
          ? 'Здесь храни паспорта, визы и страховки — другие участники их не видят.'
          : 'Чеклисты, общие брони из почты, шаблоны — всё, что нужно всем.'}
      </div>
      <Btn variant="ghost" icon="plus"
        onClick={() => window.__openModal?.(<AddDocDialog tripId={tripId} defaultVisibility={scope === 'personal' ? 'private' : 'shared'} />)}>
        Добавить {scope === 'personal' ? 'личный' : 'общий'} документ
      </Btn>
    </div>
  );
}

// ─── DocsGrid ─────────────────────────────────────────────────────────────────

function DocsGrid({ docs, scope, tripId }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
      {docs.map(d => (
        <DocCard key={d.id} doc={d} tripId={tripId} scope={scope} />
      ))}
      <button
        onClick={() => window.__openModal?.(<AddDocDialog tripId={tripId} defaultVisibility={scope === 'personal' ? 'private' : 'shared'} />)}
        style={{
          padding: 14, background: 'transparent', border: '1.5px dashed var(--line)',
          borderRadius: 12, color: 'var(--muted)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 130,
          transition: 'border-color .15s, color .15s',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.borderColor = scope === 'personal' ? 'var(--warm)' : 'var(--brand)';
          e.currentTarget.style.color       = scope === 'personal' ? 'var(--warm)' : 'var(--brand)';
        }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.color = 'var(--muted)'; }}>
        <Icon name="plus" size={18} />
        <span>Новый документ</span>
      </button>
    </div>
  );
}

// ─── DocsLens (main export) ───────────────────────────────────────────────────

export default function DocsLens({ tripId, isLoading: parentLoading }) {
  const { user } = useAuth();

  const { data: docs = [], isLoading, error } = useQuery({
    queryKey: DOCS_KEY(tripId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trip_documents')
        .select('*')
        .eq('trip_id', tripId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!tripId,
  });

  const sharedDocs   = docs.filter(d => d.visibility === 'shared');
  const personalDocs = docs.filter(d => d.visibility === 'private' && d.created_by === user?.id);

  if (isLoading || parentLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Skeleton w="100%" h={36} r={8} />
        <Skeleton w="100%" h={180} r={12} />
        <Skeleton w="100%" h={180} r={12} />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: 'var(--danger)' }}>
        <Icon name="error" size={32} style={{ marginBottom: 10 }} />
        <div>Ошибка загрузки документов: {error.message}</div>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <h2 style={{ flex: 1 }}>Документы трипа</h2>
        <Btn variant="primary" icon="plus"
          onClick={() => window.__openModal?.(<AddDocDialog tripId={tripId} />)}>
          Добавить документ
        </Btn>
      </div>

      {/* Shared section */}
      <section style={{ marginBottom: 30 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Icon name="users" size={14} style={{ color: 'var(--brand)' }} />
          <h3 style={{ marginBottom: 0 }}>Общие документы трипа</h3>
          <Badge variant="quiet">{sharedDocs.length}</Badge>
          <div style={{ flex: 1 }} />
          <div className="muted" style={{ fontSize: 11.5 }}>Видят все участники</div>
        </div>
        {sharedDocs.length === 0
          ? <DocEmpty scope="shared" tripId={tripId} />
          : <DocsGrid docs={sharedDocs} scope="shared" tripId={tripId} />}
      </section>

      {/* Personal section */}
      <section style={{ marginBottom: 30 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Icon name="user" size={14} style={{ color: 'var(--warm)' }} />
          <h3 style={{ marginBottom: 0 }}>Личные документы</h3>
          <Badge variant="quiet">{personalDocs.length}</Badge>
          <div style={{ flex: 1 }} />
          <div className="muted" style={{ fontSize: 11.5 }}>Только ты их видишь</div>
        </div>
        {personalDocs.length === 0
          ? <DocEmpty scope="personal" tripId={tripId} />
          : <DocsGrid docs={personalDocs} scope="personal" tripId={tripId} />}
      </section>
    </>
  );
}
