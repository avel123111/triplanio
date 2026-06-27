// In-context Tolgee LAB (TRIP-127) — dev-only, throwaway.
//
// A self-contained copy of the landing Hero whose strings render through the
// Tolgee SDK (useTranslate) instead of the app's central t(). That is what lets
// the "Tolgee Tools" browser extension map each on-screen string to its Tolgee
// key and edit it in-context.
//
// Isolated on purpose: own TolgeeProvider (NOT the app root), own language
// state. Touches nothing in src/lib/i18n. Reached only at /tolgee-lab in DEV.
import React from 'react';
import { TolgeeProvider, useTranslate, useTolgee } from '@tolgee/react';
import { Icon as BaseIcon } from '@/design/icons';
import { useLandingCss } from '@/components/site/SiteChrome';
import { tolgee } from './tolgee';

const Icon = (props) => <BaseIcon size={20} {...props} />;

/* ── Hero mockup (verbatim from LandingPage, strings via Tolgee t) ── */
function HeroMockup() {
  const { t } = useTranslate();
  return (
    <div className="app-frame" role="img" aria-label={t('landing.mockup.trip_title')}>
      <div className="app-frame__bar">
        <span className="dot dot--r"/><span className="dot dot--y"/><span className="dot dot--g"/>
        <span className="url">triplanio.com / iberia-summer-26</span>
      </div>
      <div className="app-frame__body">
        <aside className="app-sidebar" aria-hidden="true">
          <div className="app-sidebar__group">{t('landing.mockup.trips')}</div>
          <div className="app-sidebar__item is-active"><span className="swatch swatch--lisbon"/>{t('landing.mockup.trip_title')}</div>
          <div className="app-sidebar__item"><span className="swatch" style={{background:'#8693a8'}}/>{t('landing.mockup.other_trip_1')}</div>
          <div className="app-sidebar__item"><span className="swatch" style={{background:'#8693a8'}}/>{t('landing.mockup.other_trip_2')}</div>
          <div className="app-sidebar__group">{t('landing.mockup.this_trip')}</div>
          <div className="app-sidebar__item"><span className="swatch swatch--lisbon"/>{t('landing.mockup.nights_4')}</div>
          <div className="app-sidebar__item"><span className="swatch swatch--porto"/>{t('landing.mockup.nights_2')}</div>
          <div className="app-sidebar__item"><span className="swatch swatch--bcn"/>{t('landing.mockup.nights_5')}</div>
        </aside>
        <div className="app-main">
          <div className="app-main__head">
            <div>
              <div className="app-main__title">{t('landing.mockup.trip_title')}</div>
              <div className="app-main__subtitle">{t('landing.mockup.subtitle')}</div>
            </div>
            <div className="app-tabs" aria-hidden="true">
              <span className="app-tab is-active">{t('landing.mockup.tab_timeline')}</span>
              <span className="app-tab">{t('landing.mockup.tab_calendar')}</span>
              <span className="app-tab">{t('landing.mockup.tab_map')}</span>
            </div>
          </div>
          <div className="tl">
            <div className="tl__day" data-day={t('landing.mockup.day1')}>
              <div className="tl-card"><span className="icon"><Icon name="plane"/></span><span><strong>LHR → LIS</strong> · British Airways 503</span><span className="tag">{t('landing.mockup.tag_flight')}</span><span className="meta">10:25</span></div>
              <div className="tl-card"><span className="icon"><Icon name="bed"/></span><span><strong>Memmo Alfama</strong> · {t('landing.mockup.checkin')}</span><span className="tag tag--green">{t('landing.mockup.tag_hotel')}</span><span className="meta">15:00</span></div>
            </div>
            <div className="tl__day tl__day--accent" data-day={t('landing.mockup.day2')}>
              <div className="tl-card"><span className="icon"><Icon name="ticket"/></span><span><strong>Tram 28</strong> · Alfama loop</span><span className="tag tag--warm">{t('landing.mockup.tag_activity')}</span><span className="meta">10:00</span></div>
              <div className="tl-card"><span className="icon"><Icon name="ticket"/></span><span><strong>Pastéis de Belém</strong> · pastry crawl</span><span className="tag tag--warm">{t('landing.mockup.tag_activity')}</span><span className="meta">15:30</span></div>
            </div>
            <div className="tl__day tl__day--green" data-day={t('landing.mockup.day3')}>
              <div className="tl-card"><span className="icon"><Icon name="train"/></span><span><strong>Lisbon → Porto</strong> · Alfa Pendular</span><span className="tag">{t('landing.mockup.tag_transfer')}</span><span className="meta">08:39</span></div>
              <div className="tl-card"><span className="icon"><Icon name="bed"/></span><span><strong>Torel Avantgarde</strong> · {t('landing.mockup.checkin')}</span><span className="tag tag--green">{t('landing.mockup.tag_hotel')}</span><span className="meta">14:00</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Hero() {
  const { t } = useTranslate();
  return (
    <section className="hero" id="top">
      <div className="container">
        <div className="hero__grid">
          <div className="hero__copy reveal is-in">
            <h1>{t('landing.hero.h1_a')}<span className="break"><span className="accent">{t('landing.hero.h1_b_accent')}</span> {t('landing.hero.h1_c')}</span></h1>
            <p className="hero__lede">{t('landing.hero.lede')}</p>
            <div className="hero__ctas">
              <button className="btn btn--primary btn--lg">{t('landing.hero.cta_primary')} <Icon name="arrowRight" size={16} className="chev"/></button>
              <a className="btn btn--ghost btn--lg" href="#top">{t('landing.hero.cta_secondary')}</a>
            </div>
            <div className="hero__trust">
              <span>{t('landing.hero.trust_free')}</span><span className="dot"/><span>{t('landing.hero.trust_no_card')}</span><span className="dot"/><span>{t('landing.hero.trust_languages')}</span>
            </div>
          </div>
          <div className="hero__visual reveal is-in" style={{transitionDelay:'120ms'}}>
            <HeroMockup/>
            <div className="float float--budget" aria-hidden="true">
              <div style={{fontSize: 'var(--fs-micro)',color:'var(--muted)',fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase'}}>{t('landing.float.trip_budget')}</div>
              <div style={{display:'flex',alignItems:'baseline',gap:8,marginTop:4}}>
                <strong style={{fontFamily:'var(--font-display)',fontSize: 'var(--fs-h2)',letterSpacing:'-0.02em',fontVariantNumeric:'tabular-nums'}}>€4,820</strong>
                <span style={{fontSize: 'var(--fs-micro)',color:'var(--muted)'}}>· $5,210 · ₽491k</span>
              </div>
            </div>
            <div className="float float--chat" aria-hidden="true">
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <span style={{width:22,height:22,borderRadius:'50%',background:'linear-gradient(135deg, var(--brand), #5b8fff)',color:'#fff',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize: 'var(--fs-micro)',fontWeight:700}}>AI</span>
                <div style={{fontSize: 'var(--fs-meta)',lineHeight:1.3}}>
                  <div style={{fontWeight:600}}>{t('landing.float.leave_at_title')}</div>
                  <div style={{color:'var(--muted)',fontSize: 'var(--fs-micro)'}}>{t('landing.float.leave_at_sub')}</div>
                </div>
              </div>
            </div>
            <div className="float float--pins" aria-hidden="true">
              <div style={{display:'flex',alignItems:'center',gap:6,fontSize: 'var(--fs-micro)',fontWeight:600}}>
                <span style={{width:6,height:6,borderRadius:'50%',background:'var(--brand)'}}/>{t('landing.city.lisbon')}
                <span style={{width:14,height:1,background:'var(--line)'}}/>
                <span style={{width:6,height:6,borderRadius:'50%',background:'var(--warm)'}}/>{t('landing.city.porto')}
                <span style={{width:14,height:1,background:'var(--line)'}}/>
                <span style={{width:6,height:6,borderRadius:'50%',background:'var(--success)'}}/>{t('landing.city.barcelona')}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* Tiny language switcher so you can watch translations flip live. */
function LangBar() {
  const tg = useTolgee(['language']);
  const cur = tg.getLanguage();
  const langs = [['en','EN'], ['es','ES'], ['ru','RU']];
  return (
    <div style={{position:'fixed',top:12,right:12,zIndex:50,display:'flex',gap:6,background:'#fff',border:'1px solid var(--line,#e5e7eb)',borderRadius:10,padding:6,boxShadow:'0 4px 16px rgba(0,0,0,.08)'}}>
      {langs.map(([code,label]) => (
        <button
          key={code}
          onClick={() => tg.changeLanguage(code)}
          style={{
            border:'none',borderRadius:6,padding:'4px 10px',cursor:'pointer',fontWeight:700,fontSize:13,
            background: cur === code ? 'var(--brand,#2f6bff)' : 'transparent',
            color: cur === code ? '#fff' : 'var(--ink,#0f172a)',
          }}
        >{label}</button>
      ))}
    </div>
  );
}

// DEV-only: surface any render error on screen instead of a blank white page.
class LabErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <pre style={{padding:24,whiteSpace:'pre-wrap',color:'#b91c1c',fontFamily:'monospace',fontSize:13}}>
          TOLGEE LAB crashed:{'\n\n'}{String(this.state.error?.stack || this.state.error)}
        </pre>
      );
    }
    return this.props.children;
  }
}

export default function LandingTolgeeLab() {
  useLandingCss();
  return (
    <div data-tolgee-lab>
      {/* Visible marker rendered OUTSIDE TolgeeProvider — if you see only this
          bar, the route works and the failure is inside Tolgee. */}
      <div style={{position:'fixed',bottom:0,left:0,zIndex:60,background:'#111',color:'#0f0',font:'12px monospace',padding:'4px 8px'}}>
        tolgee-lab mounted
      </div>
      <LabErrorBoundary>
        <TolgeeProvider tolgee={tolgee} fallback={<div style={{padding:40,fontFamily:'monospace'}}>Loading Tolgee…</div>}>
          <LangBar/>
          <main>
            <Hero/>
          </main>
        </TolgeeProvider>
      </LabErrorBoundary>
    </div>
  );
}
