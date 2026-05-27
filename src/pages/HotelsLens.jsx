/**
 * HotelsLens — hotel voting tab inside TripView.
 *
 * NOTE: This is a layout-only component — no real data queries yet.
 * Hotel voting (hotel_votes table) will be wired in a future iteration.
 * Props are accepted but only `visits` is used to build city sections.
 *
 * Props:
 *   tripId  — string
 *   visits  — array of cityVisit rows (used for real city names/dates)
 *   members — array of trip members
 *   myRole  — string ('owner'|'admin'|'viewer')
 */
import React, { useState } from 'react';
import { Icon } from '../design/icons';
import { Avatar, Badge, Btn, Card, detectPartner, fmt, fmtDate } from '../design/index';
import { naiveDayKey } from '@/lib/naive-time';

// ─── Mock proposals (shown when no real data yet) ──────────────────────────────

const MOCK_PROPOSALS = [
  {
    id: 'p1', name: 'Memmo Alfama', url: 'https://booking.com/h/memmo',
    rating: 9.0, price: 880, cur: 'EUR', by: 'Участник',
    note: 'В сердце Альфамы, бассейн.',
    approvers: [{ name: 'Участник 1', vote: 'yes' }, { name: 'Участник 2', vote: 'pending' }],
  },
  {
    id: 'p2', name: 'Hotel Britania', url: 'https://marriott.com/lisbon-britania',
    rating: 8.6, price: 1040, cur: 'EUR', by: 'Участник 2',
    note: 'Ар-деко классика.',
    approvers: [{ name: 'Участник 1', vote: 'no' }, { name: 'Участник 2', vote: 'yes' }],
  },
];

// ─── ProposalCard ─────────────────────────────────────────────────────────────

function ProposalCard({ p }) {
  const yesCount = p.approvers.filter(a => a.vote === 'yes').length;
  const total    = p.approvers.length;
  const approved = p.approvers.every(a => a.vote === 'yes');
  const partner  = detectPartner(p.url);

  return (
    <div style={{
      padding: 12, background: 'var(--surface)',
      border: '1px solid ' + (approved ? 'var(--success)' : 'var(--line)'),
      borderRadius: 12,
      display: 'grid', gridTemplateColumns: '48px 1fr auto auto', gap: 14, alignItems: 'center',
      boxShadow: approved ? '0 0 0 3px rgba(31,138,91,.08)' : 'none',
    }}>
      {/* Partner logo */}
      <div style={{
        width: 48, height: 48, borderRadius: 10,
        background: partner?.color || 'var(--brand)', color: 'white',
        display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 14,
      }}>
        {partner?.short || <Icon name="bed" size={20} />}
      </div>

      {/* Name + meta */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
          {approved && <Badge variant="success" icon="check">Одобрено</Badge>}
          {p.rating && <Badge variant="quiet" className="num">{p.rating}/10</Badge>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11.5, color: 'var(--muted)', flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon name="external" size={11} />
            {partner?.label || 'Сайт отеля'}
          </span>
          <span>·</span>
          <span>предложил <b style={{ color: 'var(--ink-2)', fontWeight: 500 }}>{p.by}</b></span>
          {p.note && (<><span>·</span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{p.note}</span></>)}
        </div>
        {/* Approver votes */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
          <span className="muted" style={{ fontSize: 11, fontWeight: 500 }}>Голоса:</span>
          <div className="num" style={{ fontSize: 11.5, fontWeight: 600, color: approved ? 'var(--success)' : yesCount > 0 ? 'var(--brand)' : 'var(--muted)' }}>
            {yesCount}/{total}
          </div>
          <div style={{ display: 'flex', gap: 4, marginLeft: 4 }}>
            {p.approvers.map((a, i) => (
              <div key={i} title={`${a.name} — ${a.vote === 'yes' ? 'за' : a.vote === 'no' ? 'против' : 'не голосовал'}`}
                style={{ position: 'relative' }}>
                <Avatar name={a.name} size="sm" />
                <span style={{
                  position: 'absolute', bottom: -2, right: -2,
                  width: 12, height: 12, borderRadius: '50%',
                  background: a.vote === 'yes' ? 'var(--success)' : a.vote === 'no' ? 'var(--danger)' : 'var(--line)',
                  border: '2px solid var(--surface)', display: 'grid', placeItems: 'center',
                }}>
                  {a.vote === 'yes' && <Icon name="check" size={6} style={{ color: 'white' }} />}
                  {a.vote === 'no'  && <Icon name="close" size={6} style={{ color: 'white' }} />}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Price */}
      <div className="num" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, textAlign: 'right' }}>
        {fmt(p.price, p.cur)}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
        <Btn variant="primary" size="sm" icon="thumbUp">За</Btn>
        <Btn variant="quiet"   size="sm" icon="thumbDown">Против</Btn>
        {approved && <Btn variant="primary" size="sm" icon="flag">Выбрать</Btn>}
      </div>
    </div>
  );
}

// ─── LostProposalCard ─────────────────────────────────────────────────────────

function LostProposalCard({ p }) {
  const partner = detectPartner(p.url);
  return (
    <div style={{
      padding: '8px 12px',
      background: 'var(--wash)', border: '1px solid var(--line-2)',
      borderRadius: 10, display: 'flex', alignItems: 'center', gap: 10, opacity: 0.7,
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 7,
        background: (partner?.color || 'var(--muted)') + '33',
        color: partner?.color || 'var(--muted)',
        display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700,
      }}>
        {partner?.short || <Icon name="bed" size={13} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ textDecoration: 'line-through', color: 'var(--muted)' }}>{p.name}</span>
          {p.rating && <Badge variant="quiet" className="num">{p.rating}/10</Badge>}
        </div>
        <div className="muted" style={{ fontSize: 11 }}>
          {p.by} · {p.reason === 'withdrawn' ? 'отозвано автором' : 'не выбрано группой'}
        </div>
      </div>
      {p.price && <div className="num muted" style={{ fontSize: 12.5, fontWeight: 500 }}>{fmt(p.price, 'EUR')}</div>}
      <Btn variant="quiet" size="sm" icon="eye" title="Посмотреть детали" />
    </div>
  );
}

// ─── CitySection ──────────────────────────────────────────────────────────────

function CitySection({ city, dateLabel, proposals = [], lost = [], final = null }) {
  const [open,    setOpen]    = useState(true);
  const [archOpen, setArchOpen] = useState(false);

  return (
    <div style={{ marginBottom: 22 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', padding: '10px 0', display: 'flex', alignItems: 'center', gap: 10,
          background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer',
          borderBottom: '1px solid var(--line-2)', marginBottom: 12,
        }}>
        <Icon name={open ? 'chevD' : 'chev'} size={13} />
        <h3 style={{ flex: 1, marginBottom: 0 }}>{city}</h3>
        <span className="muted num" style={{ fontSize: 13 }}>{dateLabel}</span>
        {final && <Badge variant="success" icon="flag">Выбран · {final.name}</Badge>}
        {!final && proposals.length > 0 && <Badge>{proposals.length} {proposals.length === 1 ? 'предложение' : 'предложений'}</Badge>}
        {!final && proposals.length === 0 && <Badge variant="quiet">Нет предложений</Badge>}
      </button>

      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {final ? (
            <div style={{
              padding: 14, background: 'var(--success-soft)',
              border: '1.5px solid var(--success)', borderRadius: 14,
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--success)', color: 'white', display: 'grid', placeItems: 'center' }}>
                <Icon name="check" size={20} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{final.name}</div>
                <Badge variant="success">Итоговый выбор</Badge>
              </div>
              <div className="num" style={{ fontWeight: 700, fontSize: 18 }}>{fmt(final.price, final.cur || 'EUR')}</div>
              <Btn variant="ghost" size="sm" icon="bed">В проживание</Btn>
            </div>
          ) : proposals.length === 0 ? (
            <div style={{ padding: 22, textAlign: 'center', color: 'var(--muted)', border: '1.5px dashed var(--line)', borderRadius: 12, fontSize: 13 }}>
              Пока нет предложений. <a href="#" onClick={e => e.preventDefault()}>Предложить первый отель</a>
            </div>
          ) : (
            proposals.map(p => <ProposalCard key={p.id} p={p} />)
          )}

          {/* Lost/withdrawn proposals — collapsible */}
          {lost.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <button
                onClick={() => setArchOpen(o => !o)}
                style={{ background: 'transparent', border: 'none', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--muted)', cursor: 'pointer', fontSize: 12, padding: '6px 0' }}>
                <Icon name={archOpen ? 'chevD' : 'chev'} size={11} />
                {lost.length} {lost.length === 1 ? 'проигравшее предложение' : 'проигравших предложений'}
              </button>
              {archOpen && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                  {lost.map(p => <LostProposalCard key={p.id} p={p} />)}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── HotelsLens (main export) ─────────────────────────────────────────────────

export default function HotelsLens({ tripId, visits = [], members = [], myRole }) {
  // Build city sections from real visits; populate with mock proposals for layout
  const sections = visits.length > 0
    ? visits.map((v, i) => {
        const dateLabel = v.start_datetime && v.end_datetime
          ? `${fmtDate(naiveDayKey(v.start_datetime))} → ${fmtDate(naiveDayKey(v.end_datetime))}`
          : '';
        return {
          id:        v.id,
          city:      v.city_name || `Город ${i + 1}`,
          dateLabel,
          proposals: i === 0 ? MOCK_PROPOSALS : [],
          lost:      [],
          final:     null,
        };
      })
    : [
        {
          id: 'demo-1', city: 'Город 1', dateLabel: '',
          proposals: MOCK_PROPOSALS, lost: [], final: null,
        },
      ];

  return (
    <>
      {/* Info banner */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 20, padding: 16, background: 'var(--brand-soft)', borderRadius: 14 }}>
        <Icon name="vote" size={20} style={{ color: 'var(--brand)', marginTop: 2 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Совместный выбор отелей</div>
          <div className="muted" style={{ fontSize: 12.5 }}>
            Любой участник предлагает отель. Для одобрения нужны «за» всех аппруверов.
            {' '}<a href="#" onClick={e => { e.preventDefault(); window.__navigate?.('settings'); }}> Управлять аппруверами →</a>
          </div>
          <div style={{ marginTop: 8, padding: '6px 10px', background: 'rgba(33,103,226,.08)', borderRadius: 8, fontSize: 12, color: 'var(--brand)', display: 'inline-block' }}>
            ⚙️ Функция в разработке — данные носят демонстрационный характер
          </div>
        </div>
        <Btn variant="primary" icon="plus">Предложить отель</Btn>
      </div>

      {sections.map(s => (
        <CitySection
          key={s.id}
          city={s.city}
          dateLabel={s.dateLabel}
          proposals={s.proposals}
          lost={s.lost}
          final={s.final}
        />
      ))}
    </>
  );
}
