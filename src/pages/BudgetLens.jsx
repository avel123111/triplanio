/**
 * BudgetLens — budget tab inside TripView.
 *
 * Props:
 *   tripId, budget, budgetCategories, budgetExpenses, members, isLoading, isPro, queryClient
 *
 * budget          — trip_budgets row (or null if not seeded)
 * budgetCategories — budget_categories rows
 * budgetExpenses   — budget_expenses rows (original_amount, original_currency)
 */
import React, { useState, useMemo } from 'react';
import { supabase } from '@/api/supabaseClient';
import { Icon } from '../design/icons';
import { Avatar, Badge, Btn, Card, Field, EmptyState, Skeleton, Severity, fmt } from '../design/index';

// ─── icon helpers ─────────────────────────────────────────────────────────────

const SYS_ICON = {
  accommodation: 'bed',
  transport:     'plane',
  activities:    'spark',
  services:      'esim',
  food:          'cup',
  shopping:      'spark',
  entertainment: 'spark',
  souvenirs:     'gift',
  other:         'wallet',
};

const SOURCE_ICON = {
  hotel_stay:   'bed',
  transfer:     'plane',
  activity:     'spark',
  trip_service: 'esim',
  manual:       'edit',
};

function catIcon(cat) {
  return SYS_ICON[cat.system_key] || SYS_ICON[cat.icon] || 'wallet';
}

// ─── AddExpenseDialog ─────────────────────────────────────────────────────────

function AddExpenseDialog({ tripId, categories, mainCurrency, onClose, onSaved }) {
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(mainCurrency || 'EUR');
  const [categoryId, setCategoryId] = useState(categories[0]?.id || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    if (!title.trim() || !amount || !categoryId) { setErr('Заполните все поля'); return; }
    setSaving(true);
    setErr('');
    const { error } = await supabase.from('budget_expenses').insert({
      trip_id: tripId,
      category_id: categoryId,
      title: title.trim(),
      original_amount: Number(amount),
      original_currency: currency,
      source_kind: 'manual',
      source_id: null,
      created_by: 'user',
    });
    setSaving(false);
    if (error) { setErr(error.message); return; }
    onSaved?.();
    onClose();
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
    }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 24, width: 380, boxShadow: 'var(--shadow-pop)' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ flex: 1, margin: 0 }}>Ручная трата</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 4, display: 'block' }}>Название</label>
            <input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Ужин в ресторане…" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
            <div>
              <label style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 4, display: 'block' }}>Сумма</label>
              <input className="input" type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" />
            </div>
            <div>
              <label style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 4, display: 'block' }}>Валюта</label>
              <input className="input" value={currency} onChange={e => setCurrency(e.target.value.toUpperCase().slice(0,3))} style={{ width: 70 }} />
            </div>
          </div>
          <div>
            <label style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 4, display: 'block' }}>Категория</label>
            <select className="select" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {err && <div style={{ color: 'var(--danger)', fontSize: 12.5 }}>{err}</div>}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
          <Btn variant="ghost" onClick={onClose}>Отмена</Btn>
          <Btn variant="primary" onClick={save} disabled={saving}>{saving ? 'Сохраняю…' : 'Добавить'}</Btn>
        </div>
      </div>
    </div>
  );
}

// ─── AddCategoryDialog ────────────────────────────────────────────────────────

const CAT_COLORS = ['#e2503a','#2167e2','#6a3ee2','#1f8a5b','#e08158','#c98a1a','#c9603a','#888'];

function AddCategoryDialog({ tripId, existing, onClose, onSaved }) {
  const [name, setName] = useState(existing?.name || '');
  const [color, setColor] = useState(existing?.color || CAT_COLORS[0]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    if (!name.trim()) { setErr('Введите название'); return; }
    setSaving(true);
    setErr('');
    let error;
    if (existing) {
      ({ error } = await supabase.from('budget_categories').update({ name: name.trim(), color }).eq('id', existing.id));
    } else {
      ({ error } = await supabase.from('budget_categories').insert({
        trip_id: tripId,
        kind: 'custom',
        name: name.trim(),
        system_key: null,
        icon: '💰',
        color,
        order_index: 99,
        created_by: 'user',
      }));
    }
    setSaving(false);
    if (error) { setErr(error.message); return; }
    onSaved?.();
    onClose();
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
    }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 24, width: 340, boxShadow: 'var(--shadow-pop)' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ flex: 1, margin: 0 }}>{existing ? 'Изменить категорию' : 'Новая категория'}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)' }}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 4, display: 'block' }}>Название</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Сувениры…" />
          </div>
          <div>
            <label style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 4, display: 'block' }}>Цвет</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {CAT_COLORS.map(c => (
                <button key={c} onClick={() => setColor(c)} style={{
                  width: 28, height: 28, borderRadius: '50%', background: c, border: color === c ? '2.5px solid var(--ink)' : '2px solid transparent', cursor: 'pointer'
                }} />
              ))}
            </div>
          </div>
          {err && <div style={{ color: 'var(--danger)', fontSize: 12.5 }}>{err}</div>}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
          <Btn variant="ghost" onClick={onClose}>Отмена</Btn>
          <Btn variant="primary" onClick={save} disabled={saving}>{saving ? 'Сохраняю…' : existing ? 'Сохранить' : 'Добавить'}</Btn>
        </div>
      </div>
    </div>
  );
}

// ─── ExpenseRow ───────────────────────────────────────────────────────────────

function ExpenseRow({ expense, catColor, catIcon: icon, showCategory, catName, onDelete }) {
  const src = expense.source_kind || 'manual';
  const isManual = src === 'manual';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '10px 12px',
      background: 'var(--surface)',
      border: '1px solid var(--line)',
      borderRadius: 9,
    }}>
      <div style={{ width: 26, height: 26, borderRadius: 6, background: catColor + '22', color: catColor, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
        <Icon name={icon || SOURCE_ICON[src] || 'wallet'} size={13} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {expense.title || '—'}
        </div>
        <div className="muted" style={{ fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 6 }}>
          {expense.notes && <span>{expense.notes}</span>}
          {showCategory && <Badge variant="quiet" style={{ fontSize: 10, padding: '1px 5px' }}>{catName}</Badge>}
          {!isManual && <Badge variant="quiet" icon="link" style={{ fontSize: 10 }}>авто</Badge>}
        </div>
      </div>
      {isManual && (
        <button onClick={() => onDelete?.(expense.id)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 4 }}>
          <Icon name="trash" size={13} />
        </button>
      )}
      <div className="num" style={{ fontWeight: 600, fontSize: 13.5, minWidth: 64, textAlign: 'right', flexShrink: 0 }}>
        {fmt(expense.original_amount || 0, expense.original_currency || 'EUR')}
      </div>
    </div>
  );
}

// ─── CategoryMaster ───────────────────────────────────────────────────────────

function CategoryMaster({ cats, active, onSelect }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {cats.map(c => (
        <button key={c.id} onClick={() => onSelect(c.id)} style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '11px 13px',
          background: active === c.id ? 'var(--brand-soft)' : 'var(--surface)',
          border: '1px solid ' + (active === c.id ? 'var(--brand-soft-12)' : 'var(--line)'),
          borderRadius: 10, cursor: 'pointer', textAlign: 'left', width: '100%',
        }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: c.color + '22', color: c.color, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Icon name={catIcon(c)} size={14} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 500, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
              {c.name}
              {c.kind === 'custom' && <Badge variant="quiet" style={{ fontSize: 10, padding: '1px 5px' }}>польз.</Badge>}
            </div>
            <div className="muted" style={{ fontSize: 11 }}>{c.itemCount} {c.itemCount === 1 ? 'трата' : 'трат'}</div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div className="num" style={{ fontWeight: 600, fontSize: 13 }}>{fmt(c.spent, c.mainCur)}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

// ─── CityGrouping ─────────────────────────────────────────────────────────────

function CityGrouping({ cityGroups, mainCurrency, onDelete }) {
  const [activeCity, setActiveCity] = useState(cityGroups[0]?.city || '');
  const cur = cityGroups.find(g => g.city === activeCity);
  if (!cur) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 18 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {cityGroups.map(g => {
          const isActive = g.city === activeCity;
          return (
            <button key={g.city} onClick={() => setActiveCity(g.city)} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '11px 13px',
              background: isActive ? 'var(--brand-soft)' : 'var(--surface)',
              border: '1px solid ' + (isActive ? 'var(--brand-soft-12)' : 'var(--line)'),
              borderRadius: 10, cursor: 'pointer', textAlign: 'left', width: '100%',
            }}>
              <div style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--brand-soft)', color: 'var(--brand)', display: 'grid', placeItems: 'center' }}>
                <Icon name="pin" size={14} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: 13 }}>{g.city || 'Без города'}</div>
                <div className="muted" style={{ fontSize: 11 }}>{g.items.length} {g.items.length === 1 ? 'трата' : 'трат'}</div>
              </div>
              <div className="num" style={{ fontWeight: 600, fontSize: 13 }}>{fmt(g.total, mainCurrency)}</div>
            </button>
          );
        })}
      </div>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10, gap: 8 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--brand-soft)', color: 'var(--brand)', display: 'grid', placeItems: 'center' }}>
            <Icon name="pin" size={15} />
          </div>
          <div style={{ flex: 1 }}>
            <h3 style={{ marginBottom: 2 }}>{cur.city || 'Без города'}</h3>
            <div className="muted num" style={{ fontSize: 12 }}>{cur.items.length} {cur.items.length === 1 ? 'трата' : 'трат'} · {fmt(cur.total, mainCurrency)}</div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {cur.items.map(it => (
            <ExpenseRow key={it.id} expense={it} catColor={it.catColor} catIcon={it.catIcon} catName={it.catName} showCategory onDelete={onDelete} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── BudgetLens ───────────────────────────────────────────────────────────────

export default function BudgetLens({ tripId, budget, budgetCategories = [], budgetExpenses = [], members = [], isLoading, isPro, queryClient }) {
  const [grouping, setGrouping] = useState('category');
  const [activeCatId, setActiveCatId] = useState(null);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [showAddCat, setShowAddCat] = useState(false);
  const [editCat, setEditCat] = useState(null);
  const [seeding, setSeeding] = useState(false);

  const mainCurrency = budget?.currency || 'EUR';

  // Seed budget if missing
  async function seedBudget() {
    setSeeding(true);
    await supabase.functions.invoke('seedTripBudget', { body: { tripId } });
    setSeeding(false);
    queryClient?.invalidateQueries({ queryKey: ['trip-content', tripId] });
  }

  // Delete manual expense
  async function deleteExpense(expenseId) {
    await supabase.from('budget_expenses').delete().eq('id', expenseId);
    queryClient?.invalidateQueries({ queryKey: ['trip-content', tripId] });
  }

  function refresh() {
    queryClient?.invalidateQueries({ queryKey: ['trip-content', tripId] });
  }

  // Build enriched categories
  const cats = useMemo(() => {
    const sorted = [...budgetCategories].sort((a, b) => (a.order_index ?? 99) - (b.order_index ?? 99));
    return sorted.map(cat => {
      const items = budgetExpenses.filter(e => e.category_id === cat.id);
      const spent = items.reduce((s, e) => s + Number(e.original_amount || 0), 0);
      return { ...cat, items, spent, itemCount: items.length, mainCur: mainCurrency };
    });
  }, [budgetCategories, budgetExpenses, mainCurrency]);

  const activeCat = cats.find(c => c.id === (activeCatId || cats[0]?.id)) || cats[0];

  // Summary totals
  const totalSpent = useMemo(() => cats.reduce((s, c) => s + c.spent, 0), [cats]);
  const memberCount = members.filter(m => m.status === 'active').length || 1;

  // City grouping — flatten all expenses with their category info
  const cityGroups = useMemo(() => {
    const cityMap = {};
    for (const cat of cats) {
      for (const exp of cat.items) {
        const city = exp.city_name || '—';
        if (!cityMap[city]) cityMap[city] = [];
        cityMap[city].push({ ...exp, catColor: cat.color, catIcon: catIcon(cat), catName: cat.name });
      }
    }
    return Object.entries(cityMap).map(([city, items]) => ({
      city,
      total: items.reduce((s, it) => s + Number(it.original_amount || 0), 0),
      items,
    }));
  }, [cats]);

  // Skeleton
  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 0' }}>
        {[1,2,3].map(i => <Skeleton key={i} style={{ height: 80, borderRadius: 12 }} />)}
      </div>
    );
  }

  // Not seeded yet
  if (!budget && budgetCategories.length === 0) {
    return (
      <EmptyState
        icon="wallet"
        title="Бюджет не создан"
        body="Создайте бюджет трипа — категории и расходы будут заполняться автоматически"
        action={<Btn variant="primary" icon="spark" onClick={seedBudget} disabled={seeding}>{seeding ? 'Создаю…' : 'Создать бюджет'}</Btn>}
      />
    );
  }

  return (
    <>
      {/* Top summary */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 22 }}>
        <Card>
          <div className="muted" style={{ fontSize: 12 }}>Всего потрачено</div>
          <div className="num" style={{ fontSize: 30, fontFamily: 'var(--font-display)', fontWeight: 600, marginTop: 4 }}>{fmt(totalSpent, mainCurrency)}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{budgetExpenses.length} {budgetExpenses.length === 1 ? 'трата' : 'трат'}</div>
          <div style={{ marginTop: 12, height: 6, borderRadius: 3, background: 'var(--wash)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: Math.min((totalSpent / Math.max(totalSpent, 1)) * 100, 100) + '%', background: 'var(--success)' }} />
          </div>
        </Card>
        <Card>
          <div className="muted" style={{ fontSize: 12 }}>На одного</div>
          <div className="num" style={{ fontSize: 30, fontFamily: 'var(--font-display)', fontWeight: 600, marginTop: 4 }}>{fmt(memberCount > 0 ? Math.round(totalSpent / memberCount) : totalSpent, mainCurrency)}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{memberCount} {memberCount === 1 ? 'участник' : 'участника'} · поровну</div>
        </Card>
        <Card>
          <div className="muted" style={{ fontSize: 12 }}>Основная валюта</div>
          <div className="num" style={{ fontSize: 30, fontFamily: 'var(--font-display)', fontWeight: 600, marginTop: 4 }}>{mainCurrency}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            {[...new Set(budgetExpenses.map(e => e.original_currency).filter(Boolean))].join(', ') || mainCurrency}
          </div>
        </Card>
      </div>

      {/* Grouping controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div className="tweaks__seg">
          <button className={grouping === 'category' ? 'active' : ''} onClick={() => setGrouping('category')}>По категориям</button>
          <button className={grouping === 'city' ? 'active' : ''} onClick={() => setGrouping('city')}>По городам</button>
        </div>
        <div style={{ flex: 1 }} />
        {grouping === 'category' && (
          <Btn variant="ghost" size="sm" icon="plus" onClick={() => { setEditCat(null); setShowAddCat(true); }}>Категория</Btn>
        )}
        <Btn variant="primary" size="sm" icon="plus" onClick={() => setShowAddExpense(true)}>Ручная трата</Btn>
      </div>

      {grouping === 'category' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 18 }}>
          {/* Left: categories */}
          <CategoryMaster cats={cats} active={activeCat?.id} onSelect={setActiveCatId} />

          {/* Right: drill-down */}
          {activeCat && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10, gap: 8 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: activeCat.color + '22', color: activeCat.color, display: 'grid', placeItems: 'center' }}>
                  <Icon name={catIcon(activeCat)} size={15} />
                </div>
                <div style={{ flex: 1 }}>
                  <h3 style={{ marginBottom: 2 }}>{activeCat.name}</h3>
                  <div className="muted num" style={{ fontSize: 12 }}>{fmt(activeCat.spent, mainCurrency)}</div>
                </div>
                {activeCat.kind === 'custom' && (
                  <Btn variant="ghost" size="sm" icon="edit" onClick={() => { setEditCat(activeCat); setShowAddCat(true); }}>Изменить</Btn>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {activeCat.items.length === 0 && (
                  <div style={{ padding: 22, textAlign: 'center', color: 'var(--muted)', border: '1.5px dashed var(--line)', borderRadius: 10 }}>
                    Пока пусто. <a href="#" onClick={e => { e.preventDefault(); setShowAddExpense(true); }}>Добавить трату</a>
                  </div>
                )}
                {activeCat.items.map(exp => (
                  <ExpenseRow
                    key={exp.id}
                    expense={exp}
                    catColor={activeCat.color}
                    catIcon={catIcon(activeCat)}
                    onDelete={deleteExpense}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        cityGroups.length === 0
          ? <EmptyState icon="pin" title="Нет данных о городах" body="Расходы появятся, когда вы добавите траты с привязкой к городу" />
          : <CityGrouping cityGroups={cityGroups} mainCurrency={mainCurrency} onDelete={deleteExpense} />
      )}

      {/* Dialogs */}
      {showAddExpense && (
        <AddExpenseDialog
          tripId={tripId}
          categories={cats}
          mainCurrency={mainCurrency}
          onClose={() => setShowAddExpense(false)}
          onSaved={refresh}
        />
      )}
      {showAddCat && (
        <AddCategoryDialog
          tripId={tripId}
          existing={editCat}
          onClose={() => { setShowAddCat(false); setEditCat(null); }}
          onSaved={refresh}
        />
      )}
    </>
  );
}
