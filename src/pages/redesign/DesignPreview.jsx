import React, { useState, useEffect } from 'react';
import '../../design/app.css';
import { Icon } from '../../design/icons';
import { ModalHost, Avatar, Badge, Btn } from '../../design/index';

// Screen imports
import ScreenCollection from './ScreenCollection';
import ScreenAccount from './ScreenAccount';
import ScreenInbox from './ScreenInbox';
import ScreenPro from './ScreenPro';
import ScreenSystem from './ScreenSystem';
import ScreenPublic from './ScreenPublic';
import ScreenAiPlanner from './ScreenAiPlanner';
import ScreenTimeline from './ScreenTimeline';
import ScreenBudget from './ScreenBudget';
import ScreenCalendar from './ScreenCalendar';
import ScreenChat from './ScreenChat';
import ScreenDocs from './ScreenDocs';
import ScreenHotels from './ScreenHotels';
import ScreenMap from './ScreenMap';
import ScreenMembers from './ScreenMembers';
import ScreenSettings from './ScreenSettings';
import ScreenAI from './ScreenAI';
import ScreenForms from './ScreenForms';

// =====================================================================
// Navigation registry
// =====================================================================
const SCREENS = [
  { group: 'Глобальная оболочка', items: [
    { id: 'collection', title: 'Коллекция трипов',    sub: 'Дашборд · §6',    inApp: false },
    { id: 'inbox',      title: 'Инбокс уведомлений', sub: '§27',              inApp: false },
    { id: 'account',    title: 'Настройки аккаунта', sub: '§30',              inApp: false },
    { id: 'pro',        title: 'Pro / выбор тарифа', sub: '§17',              inApp: false },
    { id: 'ai-planner', title: 'ИИ-планировщик',      sub: '§20',             inApp: false },
  ]},
  { group: 'Один трип — линзы', items: [
    { id: 'timeline', title: 'Хронология',     sub: '§7, §8', inApp: true, lens: 'timeline' },
    { id: 'map',      title: 'Карта',          sub: '§14',    inApp: true, lens: 'map'      },
    { id: 'calendar', title: 'Календарь',      sub: '§15',    inApp: true, lens: 'calendar' },
    { id: 'budget',   title: 'Бюджет',         sub: '§16',    inApp: true, lens: 'budget'   },
    { id: 'chat',     title: 'Групповой чат',  sub: '§24',    inApp: true, lens: 'chat'     },
    { id: 'ai',       title: 'ИИ-помощник',    sub: '§22',    inApp: true, lens: 'ai'       },
    { id: 'hotels',   title: 'Выбор отелей',   sub: '§26',    inApp: true, lens: 'hotels'   },
    { id: 'docs',     title: 'Документы',      sub: '§23',    inApp: true, lens: 'docs'     },
    { id: 'members',  title: 'Участники',      sub: '§25',    inApp: true, lens: 'members'  },
    { id: 'settings', title: 'Настройки трипа',sub: '§29',    inApp: true, lens: 'settings' },
  ]},
  { group: 'Создание и редактирование', items: [
    { id: 'forms', title: 'Формы добавления', sub: '§10–12', inApp: false },
  ]},
  { group: 'Внешние и системные', items: [
    { id: 'public',          title: 'Публичный трип',  sub: '§19', inApp: false },
    { id: 'system-404',      title: '404',             sub: '§33', inApp: false },
    { id: 'system-noaccess', title: 'Нет доступа',     sub: '§33', inApp: false },
    { id: 'system-expired',  title: 'Ссылка истекла',  sub: '§33', inApp: false },
  ]},
];

const FLAT_SCREENS = SCREENS.flatMap(g => g.items);
const SCREEN_BY_ID  = Object.fromEntries(FLAT_SCREENS.map(s => [s.id, s]));

const SCREEN_COMPONENTS = {
  collection:          <ScreenCollection />,
  inbox:               <ScreenInbox />,
  account:             <ScreenAccount />,
  pro:                 <ScreenPro />,
  'ai-planner':        <ScreenAiPlanner />,
  timeline:            <ScreenTimeline />,
  budget:              <ScreenBudget />,
  calendar:            <ScreenCalendar />,
  chat:                <ScreenChat />,
  docs:                <ScreenDocs />,
  hotels:              <ScreenHotels />,
  map:                 <ScreenMap />,
  members:             <ScreenMembers />,
  settings:            <ScreenSettings />,
  ai:                  <ScreenAI />,
  forms:               <ScreenForms />,
  public:              <ScreenPublic />,
  'system-404':        <ScreenSystem variant="404" />,
  'system-noaccess':   <ScreenSystem variant="no-access" />,
  'system-expired':    <ScreenSystem variant="expired" />,
};

// Lens tabs shown in the app-side for trip screens
const LENS_TABS = [
  { id: 'timeline', label: 'Хронология', icon: 'list'     },
  { id: 'map',      label: 'Карта',      icon: 'map'      },
  { id: 'calendar', label: 'Календарь',  icon: 'calendar' },
  { id: 'budget',   label: 'Бюджет',     icon: 'wallet'   },
  { id: 'hotels',   label: 'Отели',      icon: 'vote', count: 2 },
  { id: 'docs',     label: 'Документы',  icon: 'file'     },
];

// =====================================================================
// App Shell — the REAL app structure (header + optional side nav)
// =====================================================================
function AppShell({ screenId, navigate, theme, setTheme, children }) {
  const screen   = SCREEN_BY_ID[screenId] || SCREEN_BY_ID.collection;
  const isInApp  = screen.inApp;
  const [sideOpen, setSideOpen] = useState(false);

  return (
    <div className="app" style={{ height: '100%' }}>
      <div
        className={`app-side-backdrop ${sideOpen ? 'is-open' : ''}`}
        onClick={() => setSideOpen(false)}
      />

      {/* ── TOP HEADER ── */}
      <header className="app-header">
        {isInApp && (
          <button
            className="icon-btn"
            style={{ border: '1px solid var(--line)', background: 'var(--surface)', display: 'none' }}
            data-mobile-toggle
            onClick={() => setSideOpen(!sideOpen)}
          >
            <Icon name="list" size={17} />
          </button>
        )}
        {isInApp && (
          <button className="app-header__crumb-back" onClick={() => navigate('collection')}>
            <Icon name="back" size={14} />
          </button>
        )}
        <div className="app-header__brand" onClick={() => navigate('collection')}>
          <span className="app-header__brand-name">Triplanio</span>
        </div>
        {isInApp && (
          <div className="app-header__crumb">
            <div className="app-header__crumb-trip">
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>
                Иберия летом
              </span>
              <span className="app-header__crumb-dates num">12 → 23 июл · 2026</span>
            </div>
          </div>
        )}
        <div className="app-header__right">
          <button className="icon-btn" title="Сменить тему" onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}>
            <Icon name={theme === 'light' ? 'moon' : 'sun'} size={17} />
          </button>
          <button className="icon-btn" title="Инбокс" style={{ position: 'relative' }} onClick={() => navigate('inbox')}>
            <Icon name="bell" size={17} />
            <span className="dot" />
          </button>
          <button
            className="icon-btn"
            title="Аккаунт"
            onClick={() => navigate('account')}
            style={{ width: 'auto', padding: '0 4px 0 0', display: 'flex', gap: 6 }}
          >
            <Avatar name="Анна Лебедева" size="sm" />
            <Badge variant="warm" style={{ padding: '1px 6px', fontSize: 10.5 }}>Pro</Badge>
          </button>
        </div>
      </header>

      {/* ── BODY ── */}
      {isInApp ? (
        <div className="app-body">
          <aside className={`app-side ${sideOpen ? 'is-open' : ''}`}>
            <div className="app-side__group">
              <div className="app-side__group-label">Линзы трипа</div>
              {LENS_TABS.map(t => (
                <button
                  key={t.id}
                  className={`app-side__item ${screenId === t.id ? 'active' : ''}`}
                  onClick={() => { navigate(t.id); setSideOpen(false); }}
                >
                  <Icon name={t.icon} size={16} />
                  <span>{t.label}</span>
                  {t.count && <span className="app-side__item-badge">{t.count}</span>}
                </button>
              ))}
            </div>
            <div className="app-side__group">
              <div className="app-side__group-label">Управление</div>
              <button
                className={`app-side__item ${screenId === 'members' ? 'active' : ''}`}
                onClick={() => { navigate('members'); setSideOpen(false); }}
              >
                <Icon name="users" size={16} /><span>Участники</span>
              </button>
              <button
                className={`app-side__item ${screenId === 'settings' ? 'active' : ''}`}
                onClick={() => { navigate('settings'); setSideOpen(false); }}
              >
                <Icon name="settings" size={16} /><span>Настройки трипа</span>
              </button>
            </div>
          </aside>
          <main className="app-main">
            {children}
          </main>
        </div>
      ) : (
        <main className="app-main">
          {children}
        </main>
      )}
    </div>
  );
}

// =====================================================================
// Main DesignPreview — prototype chrome wrapper
// =====================================================================
export default function DesignPreview() {
  const [screenId, setScreenId]     = useState('collection');
  const [theme, setTheme]           = useState('light');
  const [vibe, setVibe]             = useState('atlantic');
  const [protoNavOpen, setProtoNavOpen] = useState(false);

  const navigate = (id) => { setScreenId(id); setProtoNavOpen(false); };

  // Set theme / vibe on <html>
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-vibe', vibe);
    return () => {
      document.documentElement.removeAttribute('data-theme');
      document.documentElement.removeAttribute('data-vibe');
    };
  }, [theme, vibe]);

  // Expose navigate to screens that use window.__triplanioNavigate
  useEffect(() => {
    window.__triplanioNavigate = navigate;
    window.__navigate = navigate;
    return () => {
      delete window.__triplanioNavigate;
      delete window.__navigate;
    };
  });

  const screen  = SCREEN_BY_ID[screenId] || SCREEN_BY_ID.collection;
  const content = SCREEN_COMPONENTS[screenId] || (
    <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>
      Экран <code>{screenId}</code> не найден
    </div>
  );

  return (
    <div className="proto" data-theme={theme} data-vibe={vibe} style={{ height: '100vh' }}>

      {/* Prototype nav backdrop (mobile) */}
      <div
        className={`proto__nav-backdrop ${protoNavOpen ? 'is-open' : ''}`}
        onClick={() => setProtoNavOpen(false)}
      />

      {/* ── PROTOTYPE SIDEBAR ── (design navigator, not part of real app) */}
      <aside className={`proto__nav ${protoNavOpen ? 'is-open' : ''}`}>
        <div className="proto__nav-head">
          <div className="proto__nav-title">Triplanio</div>
          <div className="proto__nav-sub">Редизайн · {FLAT_SCREENS.length} экранов</div>
        </div>

        <div className="proto__nav-list scrollbar-thin">
          {SCREENS.map((g) => (
            <div key={g.group}>
              <div className="proto__group-label">{g.group}</div>
              {g.items.map(item => (
                <button
                  key={item.id}
                  className={`proto__nav-item ${screenId === item.id ? 'active' : ''}`}
                  onClick={() => navigate(item.id)}
                >
                  <span className="proto__nav-item-num">
                    {String(FLAT_SCREENS.indexOf(item) + 1).padStart(2, '0')}
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {item.title}
                    </span>
                    <span style={{ fontSize: 10.5, color: 'var(--muted-2)' }}>{item.sub}</span>
                  </div>
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="proto__nav-foot">
          <button className="icon-btn" onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')} title="Тема">
            <Icon name={theme === 'light' ? 'moon' : 'sun'} size={16} />
          </button>
          <div style={{ display: 'flex', gap: 3, marginLeft: 4 }}>
            {['atlantic', 'editorial', 'tech'].map(v => (
              <button
                key={v}
                onClick={() => setVibe(v)}
                style={{
                  padding: '3px 7px', fontSize: 10.5, borderRadius: 5, border: 'none', cursor: 'pointer',
                  background: vibe === v ? 'var(--brand-soft)' : 'transparent',
                  color: vibe === v ? 'var(--brand)' : 'var(--muted)',
                  fontWeight: vibe === v ? 600 : 400,
                }}
              >
                {v[0].toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
          <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted-2)' }}>v2</div>
        </div>
      </aside>

      {/* ── VIEWPORT (real app renders here) ── */}
      <div className="proto__viewport">
        {/* Viewport header */}
        <div className="proto__viewport-head">
          <button
            className="icon-btn proto__nav-toggle"
            onClick={() => setProtoNavOpen(!protoNavOpen)}
          >
            <Icon name="list" size={17} />
          </button>
          <div style={{ minWidth: 0 }}>
            <div className="proto__viewport-title">{screen.title}</div>
            <div className="proto__viewport-sub">{screen.sub}</div>
          </div>
          <div className="proto__viewport-spacer" />
          <a
            href="/trips"
            style={{ fontSize: 12, color: 'var(--brand)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}
          >
            <Icon name="external" size={13} /> Live app
          </a>
        </div>

        {/* Viewport body — AppShell wraps each screen */}
        <div className="proto__viewport-body">
          <AppShell screenId={screenId} navigate={navigate} theme={theme} setTheme={setTheme}>
            {content}
          </AppShell>
        </div>
      </div>

      <ModalHost />
    </div>
  );
}
