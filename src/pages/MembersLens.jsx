/**
 * MembersLens — members tab inside TripView.
 *
 * Props: tripId, members, trip, user, role, isLoading, queryClient
 *
 * members — trip_members rows from getTripDetails (include: ['content'])
 *   columns: id, trip_id, user_email, user_full_name, role, status, invite_token, ...
 */
import React, { useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { TRIP_SHELL_KEY, TRIP_CONTENT_KEY } from '@/lib/trip-data';
import { Icon } from '../design/icons';
import { Avatar, Badge, Btn, Dialog, EmptyState, Field, Skeleton } from '../design/index';

// ─── role helpers ─────────────────────────────────────────────────────────────

function RoleBadge({ role }) {
  if (role === 'owner') return <Badge variant="warm">Владелец</Badge>;
  if (role === 'admin') return <Badge>Админ</Badge>;
  if (role === 'editor') return <Badge variant="quiet">Редактор</Badge>;
  return <Badge variant="quiet" icon="eye">Зритель</Badge>;
}

function StatusDot({ status }) {
  if (status === 'active')  return <span style={{ color: 'var(--success)', fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)', display: 'inline-block' }} />Принял</span>;
  if (status === 'pending') return <span style={{ color: 'var(--warning)', fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--warning)', display: 'inline-block' }} />Ожидает</span>;
  return <span className="muted" style={{ fontSize: 12.5 }}>—</span>;
}

// ─── InviteDialog ─────────────────────────────────────────────────────────────

const ROLES = [
  { value: 'admin',  label: 'Админ — редактирование всего' },
  { value: 'editor', label: 'Редактор — добавляет события' },
  { value: 'viewer', label: 'Зритель — только чтение' },
];

function InviteDialog({ tripId, onSaved }) {
  const [tab, setTab] = useState('email');
  const [role, setRole] = useState('viewer');
  const [copied, setCopied] = useState(false);
  const [email, setEmail] = useState('');
  const [offlineName, setOfflineName] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function inviteByEmail() {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed.includes('@')) { setErr('Введите корректный e-mail'); return; }
    setSaving(true);
    setErr('');
    const { data, error } = await supabase.functions.invoke('inviteTripMember', {
      body: { tripId, email: trimmed, role },
    });
    setSaving(false);
    if (error || data?.error) { setErr((data?.error || error?.message) || 'Ошибка'); return; }
    onSaved?.();
    window.__closeModal?.();
  }

  async function addOffline() {
    const name = offlineName.trim();
    if (!name) { setErr('Введите имя'); return; }
    setSaving(true);
    setErr('');
    const { data, error } = await supabase.functions.invoke('addOfflineTripMember', {
      body: { tripId, name },
    });
    setSaving(false);
    if (error || data?.error) { setErr((data?.error || error?.message) || 'Ошибка'); return; }
    onSaved?.();
    window.__closeModal?.();
  }

  return (
    <Dialog title="Пригласить в трип" icon="users" size=""
      foot={<>
        <Btn variant="ghost" onClick={() => window.__closeModal?.()}>Закрыть</Btn>
        {tab === 'email' && <Btn variant="primary" icon="send" onClick={inviteByEmail} disabled={saving}>{saving ? 'Отправляю…' : 'Отправить приглашение'}</Btn>}
        {tab === 'offline' && <Btn variant="primary" icon="user" onClick={addOffline} disabled={saving}>{saving ? 'Добавляю…' : 'Добавить'}</Btn>}
      </>}>
      <div className="tweaks__seg" style={{ marginBottom: 14, display: 'flex' }}>
        <button className={tab === 'email' ? 'active' : ''} onClick={() => setTab('email')} style={{ flex: 1 }}>
          <Icon name="send" size={12} style={{ verticalAlign: -2, marginRight: 4 }} />По e-mail
        </button>
        <button className={tab === 'link' ? 'active' : ''} onClick={() => setTab('link')} style={{ flex: 1 }}>
          <Icon name="link" size={12} style={{ verticalAlign: -2, marginRight: 4 }} />Скопировать ссылку
        </button>
        <button className={tab === 'offline' ? 'active' : ''} onClick={() => setTab('offline')} style={{ flex: 1 }}>
          <Icon name="user" size={12} style={{ verticalAlign: -2, marginRight: 4 }} />Офлайн
        </button>
      </div>

      {tab !== 'offline' && (
        <Field label="Роль приглашаемого">
          <div className="tweaks__seg" style={{ display: 'flex' }}>
            {[['viewer', 'Зритель', 'Только смотрит'], ['admin', 'Админ', 'Редактирует трип']].map(([k, lab, sub]) =>
              <button key={k} className={role === k ? 'active' : ''} onClick={() => setRole(k)}
                style={{ flex: 1, flexDirection: 'column', gap: 0, padding: '8px 10px' }}>
                <div style={{ fontWeight: 500 }}>{lab}</div>
                <div className="muted" style={{ fontSize: 10.5 }}>{sub}</div>
              </button>
            )}
          </div>
        </Field>
      )}

      {tab !== 'offline' && <hr className="hr" style={{ margin: '16px 0' }} />}
      {tab === 'offline' && <div style={{ marginTop: 4 }} />}

      {tab === 'email' && <>
        <Field label="E-mail">
          <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" autoFocus />
        </Field>
        <Field label="Сообщение (опц.)" hint="свободный текст">
          <textarea className="textarea" value={message} onChange={e => setMessage(e.target.value)} placeholder="Поедешь со мной?" rows={3} />
        </Field>
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          Получатель примет приглашение из инбокса в Triplanio.
        </div>
      </>}

      {tab === 'link' && <>
        <Field label="Ссылка для приглашения · истекает через 7 дней">
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="input mono" value={`https://triplanio.com/join/4f6b-${role === 'viewer' ? 'v' : 'a'}-x29a`}
              readOnly style={{ flex: 1, fontSize: 12 }} />
            <Btn variant="primary" icon="copy" onClick={() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
              {copied ? 'Скопировано' : 'Копировать'}
            </Btn>
          </div>
        </Field>
        <div className="muted" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>
          Кто откроет ссылку — попадёт на страницу принятия с автоматически выбранной ролью.
        </div>
      </>}

      {tab === 'offline' && <>
        <Field label="Имя" hint="без аккаунта — только отображается в участниках">
          <input className="input" value={offlineName} onChange={e => setOfflineName(e.target.value)} placeholder="Серёжа, мама и т.д." autoFocus />
        </Field>
        <div className="muted" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>
          Офлайн-участник не получает уведомлений и не голосует.
        </div>
      </>}

      {err && <div style={{ color: 'var(--danger)', fontSize: 12.5, marginTop: 10 }}>{err}</div>}
    </Dialog>
  );
}

// ─── ChangeRoleDialog ─────────────────────────────────────────────────────────

function ChangeRoleDialog({ member, tripId, onSaved }) {
  const [role, setRole] = useState(member.role || 'viewer');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    setSaving(true);
    setErr('');
    const { data, error } = await supabase.functions.invoke('updateTripMemberRole', {
      body: { tripId, memberId: member.id, role },
    });
    setSaving(false);
    if (error || data?.error) { setErr((data?.error || error?.message) || 'Ошибка'); return; }
    onSaved?.();
    window.__closeModal?.();
  }

  return (
    <Dialog title="Изменить роль" icon="edit" size="sm"
      foot={<>
        <Btn variant="ghost" onClick={() => window.__closeModal?.()}>Отмена</Btn>
        <Btn variant="primary" onClick={save} disabled={saving}>{saving ? 'Сохраняю…' : 'Сохранить'}</Btn>
      </>}>
      <div style={{ marginBottom: 14, fontSize: 13, color: 'var(--muted)' }}>
        {member.user_full_name || member.user_email}
      </div>
      <Field label="Роль">
        <select className="select" value={role} onChange={e => setRole(e.target.value)}>
          {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </Field>
      {err && <div style={{ color: 'var(--danger)', fontSize: 12.5, marginTop: 10 }}>{err}</div>}
    </Dialog>
  );
}

// ─── RowMenu ──────────────────────────────────────────────────────────────────

function RowMenuItem({ icon, danger, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 10,
      width: '100%', padding: '8px 10px',
      background: 'transparent', border: 'none',
      borderRadius: 7, cursor: 'pointer', textAlign: 'left',
      fontSize: 13, color: danger ? 'var(--danger)' : 'var(--ink)',
    }}
    onMouseEnter={e => e.currentTarget.style.background = danger ? 'var(--danger-soft)' : 'var(--wash)'}
    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      <Icon name={icon} size={14} />
      {children}
    </button>
  );
}

// ─── MembersLens ──────────────────────────────────────────────────────────────

export default function MembersLens({ tripId, members = [], trip, user, role: myRole, isLoading, queryClient }) {
  const [openMenu, setOpenMenu] = useState(null);
  const [removing, setRemoving] = useState(null);

  const canManage = myRole === 'owner' || myRole === 'admin';

  // Close menu on outside click
  React.useEffect(() => {
    if (openMenu == null) return;
    const fn = e => { if (!e.target.closest?.('[data-row-menu]')) setOpenMenu(null); };
    setTimeout(() => document.addEventListener('click', fn), 0);
    return () => document.removeEventListener('click', fn);
  }, [openMenu]);

  function refresh() {
    // B5: invalidate both content (members list) and shell (header avatar row)
    queryClient?.invalidateQueries({ queryKey: TRIP_CONTENT_KEY(tripId) });
    queryClient?.invalidateQueries({ queryKey: TRIP_SHELL_KEY(tripId) });
  }

  async function resend(memberId) {
    setOpenMenu(null);
    await supabase.functions.invoke('resendTripInvite', { body: { tripId, memberId } });
  }

  async function removeMember(memberId) {
    if (!window.confirm('Убрать участника из трипа?')) return;
    setOpenMenu(null);
    setRemoving(memberId);
    await supabase.functions.invoke('removeTripMember', { body: { tripId, memberId } });
    setRemoving(null);
    refresh();
  }

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[1,2,3].map(i => <Skeleton key={i} style={{ height: 64, borderRadius: 12 }} />)}
      </div>
    );
  }

  // Add trip owner as first "member" if not already in list
  const ownerEmail = trip?.created_by || '';
  const allMembers = [...members];
  const hasOwner = allMembers.some(m => m.user_email === ownerEmail || m.role === 'owner');
  if (!hasOwner && ownerEmail) {
    allMembers.unshift({
      id: '__owner__',
      trip_id: tripId,
      user_email: ownerEmail,
      user_full_name: ownerEmail,
      role: 'owner',
      status: 'active',
    });
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <h2 style={{ flex: 1, marginBottom: 0 }}>Участники · {allMembers.length}</h2>
        {canManage && (
          <Btn variant="primary" icon="plus" onClick={() => window.__openModal?.(<InviteDialog tripId={tripId} onSaved={refresh} />)}>Пригласить</Btn>
        )}
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, overflow: 'visible' }}>
        {allMembers.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>Нет участников</div>
        )}
        {allMembers.map((m, i) => {
          const isOwner = m.role === 'owner';
          const showMenu = openMenu === i;
          const isRemoving = removing === m.id;
          const name = m.user_full_name || m.user_email || '—';

          return (
            <div key={m.id || i} style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr auto auto auto',
              alignItems: 'center', gap: 16,
              padding: '14px 18px',
              borderBottom: i < allMembers.length - 1 ? '1px solid var(--line-2)' : 'none',
              position: 'relative',
              opacity: isRemoving ? 0.5 : 1,
              transition: 'opacity 0.2s',
            }}>
              <Avatar name={name} size="lg" />
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {name}
                  {m.user_email === user?.email && <Badge variant="quiet" style={{ fontSize: 10 }}>Вы</Badge>}
                </div>
                <div className="muted" style={{ fontSize: 12.5 }}>{m.user_email}</div>
              </div>

              <div><RoleBadge role={m.role} /></div>
              <div><StatusDot status={m.status} /></div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 4, position: 'relative' }} data-row-menu>
                {!isOwner && m.user_email !== user?.email && canManage && (
                  <button
                    onClick={e => { e.stopPropagation(); setOpenMenu(showMenu ? null : i); }}
                    className="icon-btn"
                    style={{
                      width: 30, height: 30,
                      background: showMenu ? 'var(--brand-soft)' : 'transparent',
                      color: showMenu ? 'var(--brand)' : 'var(--muted)',
                      border: '1px solid ' + (showMenu ? 'var(--brand)' : 'transparent'),
                    }}
                    title="Действия"
                  >
                    <Icon name="more" size={15} />
                  </button>
                )}

                {showMenu && (
                  <div style={{
                    position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 20,
                    width: 220,
                    background: 'var(--surface)', border: '1px solid var(--line)',
                    borderRadius: 11, boxShadow: 'var(--shadow-pop)',
                    padding: 6,
                  }}>
                    {m.status === 'pending' && (
                      <RowMenuItem icon="send" onClick={() => resend(m.id)}>Отправить ещё раз</RowMenuItem>
                    )}
                    {m.status === 'active' && (
                      <RowMenuItem icon="edit" onClick={() => { setOpenMenu(null); window.__openModal?.(<ChangeRoleDialog member={m} tripId={tripId} onSaved={refresh} />); }}>Изменить роль</RowMenuItem>
                    )}
                    <RowMenuItem icon="trash" danger onClick={() => removeMember(m.id)}>
                      {m.status === 'pending' ? 'Отменить приглашение' : 'Убрать из трипа'}
                    </RowMenuItem>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Invite banner */}
      {canManage && (
        <div style={{ marginTop: 24, padding: 18, background: 'var(--brand-soft)', borderRadius: 14, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ width: 44, height: 44, borderRadius: 11, background: 'var(--brand)', color: 'white', display: 'grid', placeItems: 'center' }}>
            <Icon name="users" size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>Пригласить ещё участников</div>
            <div className="muted" style={{ fontSize: 12.5 }}>Отправьте приглашение по e-mail. Получатель увидит трип после регистрации.</div>
          </div>
          <Btn variant="primary" icon="plus" onClick={() => window.__openModal?.(<InviteDialog tripId={tripId} onSaved={refresh} />)}>Пригласить</Btn>
        </div>
      )}

    </>
  );
}
