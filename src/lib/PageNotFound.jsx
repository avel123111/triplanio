import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { Icon } from '@/design/icons';
// Из своих модулей, не через баррель: 404 отдаётся и в неавторизованной зоне,
// то есть лежит в синхронном графе лендинга (TRIP-475).
import { Btn } from '@/design/Btn';
import { Tile } from '@/design/Tile';
import { useT } from '@/lib/i18n/I18nContext';

// Shared system-stub layout - one visual family with the no-access page
// (mirrors ScreenSystem.jsx §33): icon-in-circle + title + explanation + action.
export function SystemStub({ icon, tone = 'brand', title, body, primary, secondary = null }) {
  const colors = {
    brand:   ['var(--brand-soft)',   'var(--brand)'],
    warm:    ['var(--warm-soft, var(--brand-soft))', 'var(--warm)'],
    warning: ['var(--warning-soft)', 'var(--warning)'],
  };
  const [bg, fg] = colors[tone] || colors.brand;
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: 'calc(100vh - 120px)', padding: 32, textAlign: 'center',
    }}>
      <Tile as="div" style={{ '--tile': '96px', '--tile-r': 'var(--r-card)', '--tile-ic': '42px', '--hl-soft': bg, '--hl-ink': fg, marginBottom: 28 }}>
        <Icon name={icon} size={42} />
      </Tile>
      <h1 className="t-title" style={{ marginBottom: 12, maxWidth: 520 }}>{title}</h1>
      <div className="muted t-body" style={{ maxWidth: 480, marginBottom: 24 }}>{body}</div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
        {primary && <Btn variant="primary" onClick={primary.onClick}>{primary.label}</Btn>}
        {secondary && <Btn variant="secondary" onClick={secondary.onClick}>{secondary.label}</Btn>}
      </div>
    </div>
  );
}

/**
 * `noindex` на время жизни страницы (TRIP-497).
 *
 * Сервер на любой адрес отдаёт один `index.html` и статус 200 — «страницы нет»
 * из React заголовком не скажешь. Единственный носитель этого факта для
 * поисковика — мета-запрет в разметке той страницы, которую он в итоге увидит
 * после рендера.
 *
 * Ставится эффектом и снимается уборкой — идиома `canonical` из `SiteZone` и
 * `useJsonLd`: без уборки запрет пережил бы клиентский переход и запретил бы
 * индексацию СЛЕДУЮЩЕЙ страницы, а это ровно тот класс ошибки, который никто не
 * замечает месяцами.
 */
function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    document.head.appendChild(meta);
    return () => { meta.remove(); };
  }, []);
}

export default function PageNotFound() {
  const t = useT();
  const nav = useNavigate();
  const { user } = useAuth();
  useNoIndex();
  // Logged in → back to the trip collection; otherwise → public landing.
  const goHome = () => nav(user ? '/trips' : '/');
  return (
    <SystemStub
      icon="search"
      tone="brand"
      title={t('sys.not_found_title')}
      body={t('sys.not_found_body')}
      primary={{ label: user ? t('sys.to_my_trips') : t('sys.to_home'), onClick: goHome }}
    />
  );
}
