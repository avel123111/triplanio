import React, {
  useState,
  useEffect,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { useT, useI18n } from '@/lib/i18n/I18nContext';
import { Icon as BaseIcon } from '@/design/icons';
import { SiteHeader, SiteFooter, useLandingCss } from '@/components/site/SiteChrome';

/* =========================================================
   Landing page - ported from triplanio_landing static site.
   Marketing header/footer + the /landing.css lifecycle now live in
   the shared @/components/site/SiteChrome module (reused by the public
   shared-trip page). This file owns only the landing's own sections.
========================================================= */

const APP_URL = '/login';

/* ── i18n ── (translations live in src/lib/i18n/locales/{en,ru,es}/landing.js)
   All keys are prefixed with “landing.” in the central store.
   useT() and useI18n() are imported from the central I18nContext above.
*/

// Иконки лендинга идут через единый набор (@/design/icons → lucide + бренд).
// Тонкая обёртка сохраняет дефолтный размер 20 этого экрана.
const Icon = (props) => <BaseIcon size={20} {...props} />;

/* ── Hero ── */
function HeroMockup() {
  const t = useT();
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
  const t = useT();
  const nav = useNavigate();
  const { isAuthenticated } = useAuth();
  const ctaTarget = isAuthenticated ? '/trips' : APP_URL;
  return (
    <section className="hero" id="top">
      <div className="container">
        <div className="hero__grid">
          <div className="hero__copy reveal">
            <h1>{t('landing.hero.h1_a')}<span className="break"><span className="accent">{t('landing.hero.h1_b_accent')}</span> {t('landing.hero.h1_c')}</span></h1>
            <p className="hero__lede">{t('landing.hero.lede')}</p>
            <div className="hero__ctas">
              <button className="btn btn--primary btn--lg" onClick={() => nav(ctaTarget)}>{t('landing.hero.cta_primary')} <Icon name="arrowRight" size={16} className="chev"/></button>
              <a className="btn btn--ghost btn--lg" href="#how">{t('landing.hero.cta_secondary')}</a>
            </div>
            <div className="hero__trust">
              <span>{t('landing.hero.trust_free')}</span><span className="dot"/><span>{t('landing.hero.trust_no_card')}</span><span className="dot"/><span>{t('landing.hero.trust_languages')}</span>
            </div>
          </div>
          <div className="hero__visual reveal" style={{transitionDelay:'120ms'}}>
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

/* ── Problem ── */
function Problem() {
  const t = useT();
  return (
    <section className="section section--wash">
      <div className="container">
        <div className="problem reveal">
          <div>
            <span className="eyebrow">{t('landing.problem.eyebrow')}</span>
            <h2 style={{marginTop:16}}>{t('landing.problem.h2_a')}<br/>{t('landing.problem.h2_b')}</h2>
            <p className="lede" style={{marginTop:18}}>{t('landing.problem.lede')}</p>
          </div>
          <div className="collage" aria-hidden="true">
            <div className="collage__card collage__card--mail">
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
                <span style={{width:8,height:8,borderRadius:2,background:'#ea4335'}}/>
                <span style={{fontSize: 'var(--fs-micro)',fontWeight:700,color:'var(--muted)',letterSpacing:'.06em',textTransform:'uppercase'}}>{t('landing.problem.inbox')}</span>
              </div>
              {[['B',t('landing.problem.mail1_from'),t('landing.problem.mail1_subj')],['BA',t('landing.problem.mail2_from'),t('landing.problem.mail2_subj')],['CP',t('landing.problem.mail3_from'),t('landing.problem.mail3_subj')]].map(([av,from,subj]) => (
                <div className="mailrow" key={from}>
                  <span className="avatar">{av}</span>
                  <div className="lines"><div className="from">{from}</div><div className="subj">{subj}</div></div>
                </div>
              ))}
            </div>
            <div className="collage__card collage__card--notes">
              <div style={{fontWeight:700,marginBottom:8}}>{t('landing.problem.notes_title')}</div>
              <div style={{color:'#7c6b3a',lineHeight:1.6}} dangerouslySetInnerHTML={{__html:t('landing.problem.notes_body_html')}}/>
            </div>
            <div className="collage__card collage__card--tabs">
              <div className="tabstrip">
                {[t('landing.problem.tab1'),t('landing.problem.tab2'),t('landing.problem.tab3'),t('landing.problem.tab4')].map(tab => <span className="t" key={tab}>{tab}</span>)}
              </div>
              <div className="tabsbody">{t('landing.problem.tabs_body')}</div>
            </div>
          </div>
        </div>
        <p className="problem__handoff reveal">{t('landing.problem.handoff')}</p>
      </div>
    </section>
  );
}

/* ── Features ── */
function BudgetMini() {
  const t = useT();
  const rows = [
    {k:'landing.mini.hotels',pct:42,amt:'€2,025',ccy:'$2,190',color:'#2167e2'},
    {k:'landing.mini.flights',pct:28,amt:'€1,350',ccy:'$1,460',color:'#5b8fff'},
    {k:'landing.mini.activities',pct:18,amt:'€868',ccy:'$938',color:'#c9603a'},
    {k:'landing.mini.food',pct:12,amt:'€577',ccy:'$624',color:'#1f8a5b'},
  ];
  return (
    <div className="budget" style={{padding:0}}>
      <div className="budget__total" style={{marginBottom:12}}>
        <span className="big" style={{fontSize: 'var(--fs-h2)'}}>€4,820</span>
        <span className="delta">{t('landing.mini.under')}</span>
      </div>
      <div className="budget__bar" style={{marginBottom:12}}>
        {rows.map(r => <i key={r.k} style={{width:`${r.pct}%`,background:r.color}}/>)}
      </div>
      <div className="budget__rows">
        {rows.map(r => (
          <div className="budget__row" key={r.k}>
            <span className="sw" style={{background:r.color}}/><span>{t(r.k)}</span>
            <span className="amt">{r.amt}</span><span className="ccy">{r.ccy}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Features() {
  const t = useT();
  const FEATURES = [
    {icon:'timeline',titleKey:'landing.f.timeline.title',bodyKey:'landing.f.timeline.body'},
    {icon:'users',titleKey:'landing.f.together.title',bodyKey:'landing.f.together.body'},
    {icon:'sparkles',titleKey:'landing.f.ai.title',bodyKey:'landing.f.ai.body',warm:true},
    {icon:'telegram',titleKey:'landing.f.concierge.title',bodyKey:'landing.f.concierge.body'},
    {icon:'wallet',titleKey:'landing.f.budget.title',bodyKey:'landing.f.budget.body',wide:true},
  ];
  return (
    <section className="section" id="features">
      <div className="container">
        <div className="section__head reveal">
          <span className="eyebrow">{t('landing.features.eyebrow')}</span>
          <h2>{t('landing.features.h2')}</h2>
          <p className="lede" style={{margin:'14px auto 0'}}>{t('landing.features.lede')}</p>
        </div>
        <div className="features">
          {FEATURES.map(f => (
            <article className={`card reveal ${f.wide?'card--wide':''}`} key={f.titleKey}>
              <div>
                <span className={`card__icon ${f.warm?'card__icon--warm':''}`}><Icon name={f.icon} size={22}/></span>
                <h3>{t(f.titleKey)}</h3>
                <p>{t(f.bodyKey)}</p>
              </div>
              {f.wide && <div className="preview" aria-hidden="true"><BudgetMini/></div>}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── How It Works ── */
function StepThumb({ kind }) {
  const t = useT();
  if (kind === 'create') return (
    <div className="step__thumb" aria-hidden="true">
      <div style={{fontSize: 'var(--fs-micro)',color:'var(--muted)',fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',marginBottom:8}}>{t('landing.thumb.new_trip')}</div>
      <div style={{display:'grid',gap:8}}>
        <div style={{height:32,borderRadius:8,border:'1px solid var(--line)',display:'flex',alignItems:'center',padding:'0 10px',fontSize: 'var(--fs-meta)',color:'var(--ink)'}}>
          <span style={{color:'var(--muted)',marginRight:8}}>{t('landing.thumb.where')}</span>{t('landing.city.lisbon')} · {t('landing.city.porto')} · {t('landing.city.barcelona')}
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
          <div style={{height:32,borderRadius:8,border:'1px solid var(--line)',display:'flex',alignItems:'center',padding:'0 10px',fontSize: 'var(--fs-meta)'}}><span style={{color:'var(--muted)',marginRight:6}}>{t('landing.thumb.from')}</span>{t('landing.thumb.from_date')}</div>
          <div style={{height:32,borderRadius:8,border:'1px solid var(--line)',display:'flex',alignItems:'center',padding:'0 10px',fontSize: 'var(--fs-meta)'}}><span style={{color:'var(--muted)',marginRight:6}}>{t('landing.thumb.to')}</span>{t('landing.thumb.to_date')}</div>
        </div>
        <div style={{display:'flex',gap:6,fontSize: 'var(--fs-micro)'}}>
          <span style={{background:'rgba(33,103,226,.08)',color:'var(--brand)',padding:'3px 10px',borderRadius:999,fontWeight:600}}>{t('landing.thumb.organizer')}</span>
          <span style={{background:'var(--wash)',color:'var(--muted)',padding:'3px 10px',borderRadius:999,fontWeight:600}}>{t('landing.thumb.travelers')}</span>
        </div>
      </div>
    </div>
  );
  if (kind === 'ai') return (
    <div className="step__thumb" aria-hidden="true">
      <div style={{fontSize: 'var(--fs-micro)',color:'var(--muted)',fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',marginBottom:8}}>{t('landing.thumb.ai_planner')}</div>
      <div style={{background:'var(--wash)',borderRadius:8,padding:'10px 12px',fontSize: 'var(--fs-meta)',color:'var(--ink-2)',lineHeight:1.5}}>{t('landing.thumb.ai_prompt')}</div>
      <div style={{display:'grid',gap:6,marginTop:10}}>
        {['landing.thumb.ai_result_1','landing.thumb.ai_result_2','landing.thumb.ai_result_3'].map(k => (
          <div key={k} style={{fontSize: 'var(--fs-meta)',padding:'8px 10px',background:'#fff',border:'1px solid var(--line)',borderRadius:8,display:'flex',alignItems:'center',gap:8}}>
            <span style={{width:6,height:6,borderRadius:'50%',background:'var(--brand)'}}/>{t(k)}
          </div>
        ))}
      </div>
    </div>
  );
  return (
    <div className="step__thumb" aria-hidden="true">
      <div style={{fontSize: 'var(--fs-micro)',color:'var(--muted)',fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',marginBottom:8}}>{t('landing.thumb.day_of_travel')}</div>
      <div style={{display:'grid',gap:8}}>
        <div style={{display:'flex',alignItems:'center',gap:8,fontSize: 'var(--fs-meta)'}}>
          <span style={{width:22,height:22,borderRadius:'50%',background:'linear-gradient(135deg, var(--brand), #5b8fff)',color:'#fff',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize: 'var(--fs-micro)',fontWeight:700}}>AI</span>
          <div style={{background:'#eef2f9',padding:'8px 10px',borderRadius:10,borderBottomLeftRadius:4}}>{t('landing.thumb.cancel_msg')}</div>
        </div>
        <div style={{alignSelf:'flex-end',background:'var(--brand)',color:'#fff',padding:'8px 10px',borderRadius:10,borderBottomRightRadius:4,fontSize: 'var(--fs-meta)',maxWidth:'80%'}}>{t('landing.thumb.confirm')}</div>
        <div style={{display:'flex',alignItems:'center',gap:6,fontSize: 'var(--fs-micro)',color:'var(--muted)'}}>
          <span style={{width:6,height:6,borderRadius:50,background:'var(--success)'}}/>{t('landing.thumb.confirmed')}
        </div>
      </div>
    </div>
  );
}

function HowItWorks() {
  const t = useT();
  const steps = [
    {num:'1',kind:'create',titleKey:'landing.how.s1.title',bodyKey:'landing.how.s1.body'},
    {num:'2',kind:'ai',titleKey:'landing.how.s2.title',bodyKey:'landing.how.s2.body'},
    {num:'3',kind:'travel',titleKey:'landing.how.s3.title',bodyKey:'landing.how.s3.body'},
  ];
  return (
    <section className="section" id="how">
      <div className="container">
        <div className="section__head reveal" style={{marginBottom:64}}>
          <span className="eyebrow">{t('landing.how.eyebrow')}</span>
          <h2>{t('landing.how.h2')}</h2>
        </div>
        <div className="steps">
          {steps.map((s,i) => (
            <div className="step reveal" key={s.num} style={{transitionDelay:`${i*80}ms`}}>
              <span className="step__num">{s.num}</span>
              <h3>{t(s.titleKey)}</h3>
              <p>{t(s.bodyKey)}</p>
              <StepThumb kind={s.kind}/>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Deep Dives ── */
function ThreeViewsVisual() {
  const t = useT();
  const [view, setView] = useState('Map');
  const tabs = [{id:'Timeline',labelKey:'landing.mockup.tab_timeline'},{id:'Calendar',labelKey:'landing.mockup.tab_calendar'},{id:'Map',labelKey:'landing.mockup.tab_map'}];
  return (
    <div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'14px 16px',borderBottom:'1px solid var(--line-2)'}}>
        <div style={{fontSize: 'var(--fs-meta)',color:'var(--muted)',fontWeight:600,letterSpacing:'.05em',textTransform:'uppercase'}}>{t('landing.mockup.trip_title')}</div>
        <div className="app-tabs">
          {tabs.map(tab => (
            <button key={tab.id} type="button" className={`app-tab ${view===tab.id?'is-active':''}`}
              onClick={() => setView(tab.id)} style={{cursor:'pointer',border:0}}>{t(tab.labelKey)}</button>
          ))}
        </div>
      </div>
      {view === 'Map' && (
        <div className="mapviz">
          <svg viewBox="0 0 600 320" preserveAspectRatio="none">
            <defs><pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" fill="none" stroke="#dde3ee" strokeWidth="0.6"/></pattern></defs>
            <rect width="600" height="320" fill="url(#grid)"/>
            <path d="M40,240 Q90,200 130,210 T220,190 Q260,170 320,180 T440,160 Q500,150 560,170" fill="none" stroke="#cfd6e3" strokeWidth="1.5" strokeDasharray="4 4"/>
            <path d="M120,210 C200,180 240,200 290,170 C360,130 420,150 470,130" fill="none" stroke="#2167e2" strokeWidth="2.4" strokeLinecap="round" strokeDasharray="6 6">
              <animate attributeName="stroke-dashoffset" from="0" to="-12" dur="1.2s" repeatCount="indefinite"/>
            </path>
          </svg>
          <div className="pin" style={{left:'20%',top:'70%'}}><span className="pin__dot"/><span className="pin__lbl">{t('landing.city.lisbon')}</span></div>
          <div className="pin" style={{left:'48%',top:'55%'}}><span className="pin__dot" style={{background:'var(--warm)'}}/><span className="pin__lbl">{t('landing.city.porto')}</span></div>
          <div className="pin" style={{left:'78%',top:'44%'}}><span className="pin__dot" style={{background:'var(--success)'}}/><span className="pin__lbl">{t('landing.city.barcelona')}</span></div>
        </div>
      )}
      {view === 'Calendar' && (
        <div style={{padding:22}}>
          <div style={{display:'grid',gridTemplateColumns:'repeat(7, 1fr)',gap:6,fontSize: 'var(--fs-micro)'}}>
            {['M','T','W','T','F','S','S'].map((d,i) => <div key={i} style={{textAlign:'center',color:'var(--muted)',fontWeight:600,padding:'4px 0'}}>{d}</div>)}
            {Array.from({length:28}).map((_,i) => {
              const day=i+1, inTrip=day>=12&&day<=23;
              const city=day<16?'lis':day<18?'transfer':day<19?'por':'bcn';
              const bg=!inTrip?'transparent':city==='lis'?'rgba(33,103,226,.18)':city==='por'?'rgba(201,96,58,.18)':city==='transfer'?'repeating-linear-gradient(45deg, rgba(33,103,226,.15) 0 4px, rgba(201,96,58,.15) 4px 8px)':'rgba(31,138,91,.18)';
              return <div key={i} style={{height:38,background:bg,borderRadius:8,display:'flex',alignItems:'flex-start',justifyContent:'flex-start',padding:6,fontSize: 'var(--fs-micro)',fontWeight:600,color:inTrip?'var(--ink)':'var(--muted-2)',border:inTrip?0:'1px solid var(--line-2)'}}>{day}</div>;
            })}
          </div>
          <div style={{display:'flex',gap:14,marginTop:12,fontSize: 'var(--fs-micro)',color:'var(--muted)'}}>
            <span><i style={{display:'inline-block',width:10,height:10,background:'rgba(33,103,226,.5)',borderRadius:3,marginRight:6}}/>{t('landing.city.lisbon')}</span>
            <span><i style={{display:'inline-block',width:10,height:10,background:'rgba(201,96,58,.5)',borderRadius:3,marginRight:6}}/>{t('landing.city.porto')}</span>
            <span><i style={{display:'inline-block',width:10,height:10,background:'rgba(31,138,91,.5)',borderRadius:3,marginRight:6}}/>{t('landing.city.barcelona')}</span>
          </div>
        </div>
      )}
      {view === 'Timeline' && (
        <div style={{padding:22}}>
          <div style={{display:'grid',gap:8}}>
            {[
              {d:'Jul 12',title:`${t('landing.mockup.tag_flight')} LHR → LIS`,tagKey:'landing.mockup.tag_flight',color:'var(--brand)'},
              {d:'Jul 13',title:'Tram 28',tagKey:'landing.mockup.tag_activity',color:'var(--warm)'},
              {d:'Jul 16',title:`${t('landing.mockup.tag_transfer')} ${t('landing.city.lisbon')} → ${t('landing.city.porto')}`,tagKey:'landing.mockup.tag_transfer',color:'var(--brand)'},
              {d:'Jul 18',title:`${t('landing.mockup.tag_flight')} ${t('landing.city.porto')} → BCN`,tagKey:'landing.mockup.tag_flight',color:'var(--brand)'},
              {d:'Jul 21',title:'Sagrada Família',tagKey:'landing.mockup.tag_activity',color:'var(--warm)'},
            ].map((r,i) => (
              <div key={i} style={{display:'grid',gridTemplateColumns:'70px 1fr auto',alignItems:'center',gap:10,background:'#fff',border:'1px solid var(--line)',borderRadius:10,padding:'10px 12px',fontSize: 'var(--fs-base)'}}>
                <span style={{color:'var(--muted)',fontWeight:600,fontSize: 'var(--fs-micro)'}}>{r.d}</span>
                <span>{r.title}</span>
                <span style={{fontSize: 'var(--fs-micro)',padding:'2px 8px',borderRadius:999,background:'rgba(33,103,226,.08)',color:r.color,fontWeight:600}}>{t(r.tagKey)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PlannerVisual() {
  const t = useT();
  return (
    <div className="chat" aria-hidden="true">
      <div className="bubble bubble--user">{t('landing.planner.user_msg')}</div>
      <div className="bubble bubble--ai">{t('landing.planner.ai_msg')}<div style={{marginTop:6}}><span className="typing"><span/><span/><span/></span></div></div>
      <div style={{display:'grid',gap:8,marginTop:4}}>
        {[
          {icon:'bed',name:t('landing.planner.res_lisbon'),sub:t('landing.planner.res_lisbon_sub'),badge:t('landing.planner.badge_stay')},
          {icon:'train',name:t('landing.planner.res_train'),sub:t('landing.planner.res_train_sub'),badge:t('landing.planner.badge_transfer')},
          {icon:'bed',name:t('landing.planner.res_porto'),sub:t('landing.planner.res_porto_sub'),badge:t('landing.planner.badge_stay')},
          {icon:'plane',name:t('landing.planner.res_flight'),sub:t('landing.planner.res_flight_sub'),badge:t('landing.planner.badge_flight')},
        ].map((r,i) => (
          <div className="planresult" key={i}>
            <Icon name={r.icon}/><div><strong>{r.name}</strong><div style={{color:'var(--muted)',fontSize: 'var(--fs-micro)'}}>{r.sub}</div></div>
            <span className="badge">{r.badge}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConciergeVisual() {
  const t = useT();
  return (
    <div style={{background:'linear-gradient(180deg, #eef2f9, #f6f8fc)',padding:24}}>
      <div className="phone">
        <div className="phone__head">
          <span className="av">T</span>
          <div><div className="name">Triplanio</div><div className="sub">{t('landing.phone.via')}</div></div>
          <Icon name="telegram" size={16} color="#229ED9" style={{marginLeft:'auto'}}/>
        </div>
        <div className="phone__body">
          <div className="phone__time">{t('landing.phone.today')}</div>
          <div className="bubble bubble--ai">{t('landing.phone.b1')}</div>
          <div className="bubble bubble--user" style={{alignSelf:'flex-end'}}>{t('landing.phone.u1')}</div>
          <div className="bubble bubble--ai">{t('landing.phone.b2')}</div>
          <div className="bubble bubble--user" style={{alignSelf:'flex-end'}}>{t('landing.phone.u2')}</div>
          <div className="bubble bubble--ai">{t('landing.phone.b3')}</div>
        </div>
      </div>
    </div>
  );
}

function BudgetVisual() {
  const t = useT();
  const rows = [
    {k:'landing.mini.hotels',pct:42,amt:'€2,025',ccy:'$2,190',color:'#2167e2'},
    {k:'landing.mini.flights',pct:28,amt:'€1,350',ccy:'$1,460',color:'#5b8fff'},
    {k:'landing.mini.transfers',pct:9,amt:'€434',ccy:'$469',color:'#9bb6ff'},
    {k:'landing.mini.activities',pct:13,amt:'€627',ccy:'$678',color:'#c9603a'},
    {k:'landing.mini.food_misc',pct:8,amt:'€384',ccy:'$415',color:'#1f8a5b'},
  ];
  return (
    <div className="budget">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
        <span style={{fontSize: 'var(--fs-meta)',color:'var(--muted)',fontWeight:600,letterSpacing:'.05em',textTransform:'uppercase'}}>{t('landing.mini.total')}</span>
        <span style={{fontSize: 'var(--fs-micro)',color:'var(--muted)'}}>{t('landing.mini.home_ccy')}</span>
      </div>
      <div className="budget__total"><span className="big">€4,820</span><span className="delta">{t('landing.mini.under_plan')}</span></div>
      <div className="budget__bar">{rows.map(r => <i key={r.k} style={{width:`${r.pct}%`,background:r.color}}/>)}</div>
      <div className="budget__rows" style={{marginTop:8}}>
        {rows.map(r => <div className="budget__row" key={r.k}><span className="sw" style={{background:r.color}}/><span>{t(r.k)}</span><span className="amt">{r.amt}</span><span className="ccy">{r.ccy}</span></div>)}
      </div>
    </div>
  );
}

function DeepDive({ reverse, eyebrowKey, titleKey, bodyKey, highlightKeys, children }) {
  const t = useT();
  return (
    <div className={`deep ${reverse?'deep--reverse':''} reveal`}>
      <div className="deep__copy">
        <span className="tag-eyebrow"><span className="dot"/>{t(eyebrowKey)}</span>
        <h3>{t(titleKey)}</h3>
        <p>{t(bodyKey)}</p>
        <ul className="deep__highlights">
          {highlightKeys.map(k => (
            <li key={k}><span className="check"><Icon name="check" size={12} strokeWidth={2.4}/></span><span>{t(k)}</span></li>
          ))}
        </ul>
      </div>
      <div className="deep__visual">{children}</div>
    </div>
  );
}

function DeepDives() {
  const t = useT();
  return (
    <section className="section section--wash">
      <div className="container">
        <div className="section__head section__head--left reveal" style={{marginBottom:16}}>
          <span className="eyebrow">{t('landing.dd.eyebrow')}</span>
          <h2 style={{maxWidth:'18ch'}}>{t('landing.dd.h2')}</h2>
        </div>
        <DeepDive eyebrowKey="landing.dd.threeviews.eyebrow" titleKey="landing.dd.threeviews.title" bodyKey="landing.dd.threeviews.body" highlightKeys={['landing.dd.threeviews.h1','landing.dd.threeviews.h2','landing.dd.threeviews.h3']}><ThreeViewsVisual/></DeepDive>
        <DeepDive reverse eyebrowKey="landing.dd.planner.eyebrow" titleKey="landing.dd.planner.title" bodyKey="landing.dd.planner.body" highlightKeys={['landing.dd.planner.h1','landing.dd.planner.h2','landing.dd.planner.h3']}><PlannerVisual/></DeepDive>
        <DeepDive eyebrowKey="landing.dd.concierge.eyebrow" titleKey="landing.dd.concierge.title" bodyKey="landing.dd.concierge.body" highlightKeys={['landing.dd.concierge.h1','landing.dd.concierge.h2','landing.dd.concierge.h3']}><ConciergeVisual/></DeepDive>
        <DeepDive reverse eyebrowKey="landing.dd.budget.eyebrow" titleKey="landing.dd.budget.title" bodyKey="landing.dd.budget.body" highlightKeys={['landing.dd.budget.h1','landing.dd.budget.h2','landing.dd.budget.h3']}><BudgetVisual/></DeepDive>
      </div>
    </section>
  );
}

/* ── Trust ── */
function Trust() {
  const t = useT();
  const items = [{icon:'globe',key:'landing.trust.languages'},{icon:'devices',key:'landing.trust.devices'},{icon:'lock',key:'landing.trust.privacy'},{icon:'gift',key:'landing.trust.free'}];
  return (
    <section className="section section--tight">
      <div className="container">
        <div className="trust reveal" style={{border:'1px solid var(--line)',borderRadius:16}}>
          {items.map(it => (
            <div className="trust__item" key={it.key}>
              <span className="icon"><Icon name={it.icon} size={18}/></span><span>{t(it.key)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── FAQ ── */
const FAQ_KEYS = ['landing.faq.q1','landing.faq.q2','landing.faq.q3','landing.faq.q4','landing.faq.q5','landing.faq.q6','landing.faq.q7'].map((q,i) => ({q,a:`landing.faq.a${i+1}`}));

function FAQ() {
  const t = useT();
  const [open, setOpen] = useState(null);
  return (
    <section className="section" id="faq">
      <div className="container">
        <div className="faq">
          <div className="faq__intro reveal">
            <span className="eyebrow">{t('landing.faq.eyebrow')}</span>
            <h2>{t('landing.faq.h2')}</h2>
            <p>{t('landing.faq.lede')}</p>
          </div>
          <div className="faq__list reveal">
            {FAQ_KEYS.map((f,i) => {
              const isOpen = open === i;
              return (
                <div className={`faq__item ${isOpen?'is-open':''}`} key={f.q}>
                  <button className="faq__q" aria-expanded={isOpen} onClick={() => setOpen(isOpen?null:i)}>
                    <span>{t(f.q)}</span>
                    <span className="plus"><Icon name="plus" size={16} strokeWidth={2.2}/></span>
                  </button>
                  <div className="faq__a"><div className="faq__a-inner">{t(f.a)}</div></div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Final CTA ── */
function FinalCTA() {
  const t = useT();
  const nav = useNavigate();
  const { isAuthenticated } = useAuth();
  const ctaTarget = isAuthenticated ? '/trips' : APP_URL;
  return (
    <section className="banner">
      <div className="reveal" style={{position:'relative',zIndex:1}}>
        <h2>{t('landing.finalcta.h2')}</h2>
        <p>{t('landing.finalcta.lede')}</p>
        <button className="btn btn--white btn--lg" style={{marginTop:32}} onClick={() => nav(ctaTarget)}>
          {t('landing.finalcta.cta')} <Icon name="arrowRight" size={16} className="chev"/>
        </button>
      </div>
    </section>
  );
}

/* ── Scroll reveal ──
   Runs only AFTER cssReady - earlier we kicked the effect off at mount
   with [] deps, which meant LandingPage was still in its `return null`
   path: querySelectorAll('.reveal') found nothing, the IntersectionObserver
   was left observing zero elements, and below-the-fold sections never
   revealed. Gating on `ready` (passed from cssReady) guarantees the DOM
   already contains the .reveal nodes. */
function useScrollReveal(ready) {
  useEffect(() => {
    if (!ready) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (typeof IntersectionObserver === 'undefined') return;
    document.documentElement.classList.add('reveal--ready');
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      }
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.01 });
    document.querySelectorAll('.reveal:not(.is-in)').forEach(el => io.observe(el));
    // Safety net: force-show anything already in the viewport after
    // layout settles (fonts/images), in case IO misses a fast shift.
    const flush = () => {
      const vh = window.innerHeight;
      document.querySelectorAll('.reveal:not(.is-in)').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.top < vh && r.bottom > 0) el.classList.add('is-in');
      });
    };
    const timers = [setTimeout(flush, 50), setTimeout(flush, 300), setTimeout(flush, 1200)];
    return () => {
      timers.forEach(clearTimeout);
      io.disconnect();
      document.documentElement.classList.remove('reveal--ready');
    };
  }, [ready]);
}

/* ── Main LandingPage ── */
export default function LandingPage() {
  const { lang, setLang: setLangCentral } = useI18n();

  // Landing has only a light theme. A dark theme stored from the authed app sets
  // `.dark` / [data-theme=dark] on <html>, which leaked dark TEXT colors onto the
  // always-light landing. Force light here.
  useEffect(() => {
    const r = document.documentElement;
    r.classList.remove('dark');
    r.setAttribute('data-theme', 'light');
  }, []);

  // Update <html lang> attribute whenever central lang changes
  useEffect(() => {
    document.documentElement.setAttribute('lang', lang);
  }, [lang]);

  const setLang = (next) => {
    setLangCentral(next);
  };

  // Marketing CSS lifecycle (shared with the public shared-trip page).
  const cssReady = useLandingCss();

  useScrollReveal(cssReady);

  /* Don't render until landing CSS is loaded - prevents flash of unstyled content */
  if (!cssReady) return null;

  return (
    <>
      <SiteHeader lang={lang} setLang={setLang} />
      <main>
        <Hero />
        <Problem />
        <Features />
        <HowItWorks />
        <DeepDives />
        <Trust />
        <FAQ />
        <FinalCTA />
      </main>
      <SiteFooter lang={lang} setLang={setLang} />
    </>
  );
}
