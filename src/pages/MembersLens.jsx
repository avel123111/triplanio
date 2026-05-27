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
import { Icon } from '../design/icons';
import { Avatar, Badge, Btn, EmptyState, Skeleton } from '../design/index';

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

function InviteDialog({ tripId, onClose, onSaved }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('viewer');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function invite() {
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
    onClose();
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 24, width: 380, boxShadow: 'var(--shadow-pop)' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ flex: 1, margin: 0 }}>Пригласить участника</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 4, display: 'block' }}>E-mail</label>
            <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="friend@example.com" />
          </div>
          <div>
            <label style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 4, display: 'block' }}>Роль</label>
            <select className="select" value={role} onChange={e => setRole(e.target.value)}>
              {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          {err && <div style={{ color: 'var(--danger)', fontSize: 12.5 }}>{err}</div>}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
          <Btn variant="ghost" onClick={onClose}>Отмена</Btn>
          <Btn variant="primary" onClick={invite} disabled={saving}>{saving ? 'Отправляю…' : 'Пригласить'}</Btn>
        </div>
      </div>
    </div>
  );
}

// ─── ChangeRoleDialog ─────────────────────────────────────────────────────────

function ChangeRoleDialog({ member, tripId, onClose, onSaved }) {
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
    onClose();
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 24, width: 340, boxShadow: 'var(--shadow-pop)' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ flex: 1, margin: 0 }}>Изменить роль</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <div style={{ marginBottom: 14, fontSize: 13, color: 'var(--muted)' }}>
          {member.user_full_name || member.user_email}
        </div>
        <select className="select" value={role} onChange={e => setRole(e.target.value)}>
          {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        {err && <div style={{ color: 'var(--danger)', fontSize: 12.5, marginTop: 10 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
          <Btn variant="ghost" onClick={onClose}>Отмена</Btn>
          <Btn variant="primary" onClick={save} disabled={saving}>{saving ? 'Сохраняю…' : 'Сохранить'}</Btn>
        </div>
      </div>
    </div>
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
  const [showInvite, setShowInvite] = useState(false);
  const [openMenu, setOpenMenu] = useState(null);
  const [changeRoleMember, setChangeRoleMember] = useState(null);
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
    queryClient?.invalidateQueries({ queryKey: ['trip-content', tripId] });
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
          <Btn variant="primary" icon="plus" onClick={() => setShowInvite(true)}>Пригласить</Btn>
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
                      <RowMenuItem icon="edit" onClick={() => { setOpenMenu(null); setChangeRoleMember(m); }}>Изменить роль</RowMenuItem>
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
          <Btn variant="primary" icon="plus" onClick={() => setShowInvite(true)}>Пригласить</Btn>
        </div>
      )}

      {/* Dialogs */}
      {showInvite && (
        <InviteDialog
          tripId={tripId}
          onClose={() => setShowInvite(false)}
          onSaved={refresh}
        />
      )}
      {changeRoleMember && (
        <ChangeRoleDialog
          member={changeRoleMember}
          tripId={tripId}
          onClose={() => setChangeRoleMember(null)}
          onSaved={refresh}
        />
      )}
    </>
  );
}
