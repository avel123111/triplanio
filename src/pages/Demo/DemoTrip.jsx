import React, { useEffect } from 'react';
import { zoneHome } from '@/components/site/zoneCta';
import { useI18n, useT } from '@/lib/i18n/I18nContext';
import {
  SiteHeader, SiteFooter, useSiteCss, useDocumentMeta,
} from '@/components/site/SiteChrome';
import { SiteSummary, SiteCta } from '@/components/site/SiteTrip';
import { useReveal } from '@/components/site/useReveal';
import MapView from '@/components/views/MapView';
import { Icon } from '@/design/icons';
import {
  DEMO_VISITS, DEMO_TRANSFERS, DEMO_PEOPLE, DEMO_STATS, DEMO_TIMELINE, DEMO_BUDGET,
  DEMO_CAL, DEMO_CAL_LEGEND, DEMO_DOCS, DEMO_SVC, DEMO_STAT_TILES, DEMO_STAT_LINES,
  DEMO_MEMBERS, DEMO_ROLE_NOTES, DEMO_CHAT, DEMO_TG_MSGS, DEMO_TG_POINTS,
  DEMO_NAV,
} from './demoTrip';

// The demo cover. A repo asset (no external hotlink — zone rule); replace the
// file to reshoot the hero. Full-bleed background behind the dark gradient.
const COVER = '/covers/demo-spain.webp';

// Адрес главной с меткой кампании визита — общий на всю зону (`zoneCta.js`);
// три страницы держали три одинаковые константы.
const SITE = zoneHome();

// floor-exempt: inline +16 — демо-трип (out-of-scope витрина, как LandingPage/PublicTrip):
// оставшиеся инлайны — ТОЛЬКО динамические цвета/CSS-вары фиктивного трипа из данных
// (аватары, тинты событий, донат-градиент, цвета календаря/легенды/категорий), которые
// классами не выразить; статические инлайны сведены в site.css. Апрув Pavel 26.08.2026.
// Icons come from the app design system (@/design/icons — the ONE allowed off
// check-ds-boundary), NOT the prototype sprite, so the demo matches the product.
// This maps the prototype's sprite ids (kept in the data) to app icon names.
const APP_ICON = {
  'i-globe2': 'globe', 'i-pin2': 'pin', 'i-swap': 'arrowSwap', 'i-cal2': 'calendar', 'i-route': 'route',
  'i-clock': 'clock', 'i-ticket': 'ticket', 'i-food': 'food', 'i-bed': 'bed', 'i-train': 'train',
  'i-pin': 'pin', 'i-plane': 'plane', 'i-car': 'car', 'i-warning': 'warning', 'i-flag': 'flag',
  'i-wallet': 'wallet', 'i-crown': 'crown', 'i-ticks': 'checkcheck', 'i-info': 'info', 'i-doc': 'file',
  'i-spark': 'spark', 'i-plus': 'plus', 'i-users': 'users', 'i-card-sim': 'card-sim', 'i-shield': 'shield',
  'i-mail': 'mail', 'i-chat': 'chat', 'i-send': 'send', 'i-lock': 'lock', 'i-tg': 'telegram', 'i-bell': 'bell',
};
// size prop honoured; per-container CSS in site.css still overrides via `svg{width}`.
const Ic = ({ id, size = 18 }) => <Icon name={APP_ICON[id] || 'info'} size={size} />;

// Document badge colour keyed by FORMAT, not per-file: one scheme so the same
// format always reads the same colour — pdf red · doc blue · xls green · jpg
// purple. Tokens live in the demo palette (site.css, `--dc-doc-*`).
const FT_COLOR = {
  PDF: 'var(--dc-doc-pdf)', DOC: 'var(--dc-doc-doc)',
  XLS: 'var(--dc-doc-xls)', JPG: 'var(--dc-doc-jpg)',
};

// Tinted event icon — the {soft-bg, ink} pair comes from data, so the CSS vars
// are inline (one place, marked) instead of repeated at every call site.
const Tic = ({ icon, tint }) => (
  <span className="ic" style={{ '--s': tint.s, '--k': tint.k }}>{/* inline-style-exempt: тинт события из данных демо */}
    <Ic id={icon} />
  </span>
);

// Calendar day bar — one colour, or two on a day of travel. Colours from data.
const CalBar = ({ day }) => (day.bar2
  ? (
    <span className="cal-bar">
      <i style={{ background: day.bar2[0] }} />{/* inline-style-exempt: цвет города из данных демо */}
      <i style={{ background: day.bar2[1] }} />{/* inline-style-exempt: цвет города из данных демо */}
    </span>
  )
  : <span className="cal-bar" style={{ background: day.c }} />/* inline-style-exempt: цвет города из данных демо */
);

export default function DemoTrip() {
  const { lang, setLang } = useI18n();
  const t = useT();
  const cssReady = useSiteCss();

  useDocumentMeta(t('landing.demo.meta.title'), t('landing.demo.meta.desc'));

  // Prototype toggles a page background class; ported like PublicTrip's pt-open.
  useEffect(() => {
    document.body.classList.add('demo-open');
    return () => document.body.classList.remove('demo-open');
  }, []);

  // Reveal .rv blocks once the CSS is live — the SAME hook the landing/public
  // trip use (one copy). Without it .rv stays opacity:0.
  useReveal(cssReady);

  if (!cssReady) return null;

  const stats = DEMO_STATS.map((s) => ({
    icon: s.icon, n: s.n, unit: s.unit ? t(s.unit) : undefined, k: t(s.k),
  }));

  return (
    <>
      <SiteHeader lang={lang} setLang={setLang} variant="full" themed brandHref={SITE} navItems={DEMO_NAV} />

      <main className="demo">
        {/* ── Hero ─────────────────────────────────────────────── */}
        <section className="dm-hero" id="top" data-hdr="dark">
          <div className="dm-hero-bg" aria-hidden="true">
            {/* `.map-img` — общий класс «картинка во всю площадь блока»;
                у демо было своё правило `.demo .dm-hero-bg img` слово в слово. */}
            <img className="map-img" src={COVER} alt="" />
          </div>
          <div className="wrap">
            <h1>{t('landing.demo.hero.title')}</h1>
            {/* `.pt-dates` — тот же ряд дат, что у публичной поездки; правило
                `.demo .hero-dates` было его побайтовой копией под другим именем. */}
            <div className="pt-dates">{t('landing.demo.hero.dates')}</div>
            <p className="dm-hero-sub">{t('landing.demo.hero.sub')}</p>
            <div className="hero-people">
              <span className="dm-avs">
                {DEMO_PEOPLE.map((p) => (
                  <span className="dm-av" key={p.ini} style={{ background: p.color }} title={p.name}>{p.ini}{/* inline-style-exempt: цвет/вар из данных демо */}</span>
                ))}
                <span className="more">+1</span>
              </span>
              <span className="dm-txt" dangerouslySetInnerHTML={{ __html: t('landing.demo.hero.people') }} />
            </div>
          </div>
        </section>

        {/* ── Summary stat strip (shared SiteSummary) ──────────── */}
        <SiteSummary stats={stats} people={[]} />

        {/* ── Route map ────────────────────────────────────────── */}
        <section className="route-sec section-pad" id="route">
          <div className="wrap">
            <div className="section-head rv">
              <span className="brow">{t('landing.demo.route.eyebrow')}</span>
              <h2>{t('landing.demo.route.h2a')} <span className="accent">{t('landing.demo.route.h2b')}</span></h2>
              <p>{t('landing.demo.route.p')}</p>
            </div>
            <div className="mapcard rv">
              <MapView
                visits={DEMO_VISITS}
                transfers={DEMO_TRANSFERS}
                colorScheme="LIGHT"
                initialProjection="mercator"
                showStartEnd
                active
              />
            </div>
            <div className="maplegend rv">
              <span><i className="ln" />{t('landing.demo.route.leg_added')}</span>
              <span><i className="ln ln--d" />{t('landing.demo.route.leg_none')}</span>
              <span><Ic id="i-flag" />{t('landing.demo.route.startend')}</span>
            </div>
          </div>
        </section>

        {/* ── Timeline ─────────────────────────────────────────── */}
        <section className="tl-sec sheet-pane section-pad" id="timeline">
          <div className="wrap">
            <div className="section-head centered rv">
              <span className="brow">{t('landing.demo.tl.eyebrow')}</span>
              <h2>{t('landing.demo.tl.h2a')} <span className="accent">{t('landing.demo.tl.h2b')}</span></h2>
              <p>{t('landing.demo.tl.p')}</p>
            </div>
            <div className="tl-wrap rv">
              {DEMO_TIMELINE.map((day, di) => (
                <div className="tl-day" key={di}>
                  <div className="tl-dh">
                    <span className="dm-dot" style={{ borderColor: day.dot }}>{/* inline-style-exempt: цвет/вар из данных демо */}</span>
                    <b>{t(day.dhKey)}</b>
                    <span className="dm-city"><Ic id="i-pin" />{t(day.cityKey)}</span>
                  </div>
                  <div className="tl-list">
                    {day.events.map((ev, ei) => (ev.kind === 'trn' ? (
                      <div className="tlev trn" key={ei}>
                        <div className="trn-row">
                          <span className="t num">{ev.from.time}</span>
                          <Tic icon={ev.from.icon} tint={ev.tint} />
                          <span className="dm-pt">{t(ev.from.ptKey)}<small>{t(ev.from.stationKey)}</small></span>
                          <span className="pr num pr--push">{ev.from.price}</span>
                        </div>
                        <div className="trn-mid"><span className="dm-m"><Ic id={ev.mid.icon} />{t(ev.mid.mKey)}<em> {t(ev.mid.emKey)}</em></span></div>
                        <div className="trn-row">
                          <span className="t num">{ev.to.time}</span>
                          <Tic icon={ev.to.icon} tint={ev.tint} />
                          <span className="dm-pt">{t(ev.to.ptKey)}<small>{t(ev.to.stationKey)}</small></span>
                        </div>
                      </div>
                    ) : (
                      <div className={`tlev${ev.mod ? ` ${ev.mod}` : ''}`} key={ei}>
                        <span className="t num">{ev.time}</span>
                        <Tic icon={ev.icon} tint={ev.tint} />
                        <span className="b"><b>{t(ev.tKey)}</b><span>{t(ev.sKey)}</span></span>
                        {ev.pill && <span className={`dm-pill ${ev.pill.cls}`}>{t(ev.pill.key)}</span>}
                        {ev.price && <span className="pr num">{ev.price}</span>}
                      </div>
                    )))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Budget ───────────────────────────────────────────── */}
        <section className="bud-sec section-pad" id="budget">
          <div className="wrap">
            <div className="section-head rv">
              <span className="brow">{t('landing.demo.bud.eyebrow')}</span>
              <h2>{t('landing.demo.bud.h2a')} <span className="accent">{t('landing.demo.bud.h2b')}</span></h2>
              <p>{t('landing.demo.bud.p')}</p>
            </div>
            <div className="bud-grid">
              <div className="bcard rv">
                <div className="dm-card-h"><span className="dm-bic dm-warm"><Ic id="i-wallet" /></span><h3>{t('landing.demo.bud.card1')}</h3></div>
                <div className="donutbox">
                  <div className="dm-donut" style={{ '--g': DEMO_BUDGET.donutGradient }}>{/* inline-style-exempt: цвет/вар из данных демо */}</div>
                  <span className="donut-c"><b className="num">{DEMO_BUDGET.total}</b><span>{t('landing.demo.bud.total')}</span></span>
                </div>
                <div className="cats">
                  {DEMO_BUDGET.cats.map((c, i) => (
                    <div className="cat" key={i} style={{ '--c': c.c }}>{/* inline-style-exempt: цвет/вар из данных демо */}
                      <i className="dm-d" />
                      <span className="dm-nm"><span className="t">{t(c.tKey)}</span><span className={`dm-pill ${c.pill.cls}`}>{t(c.pill.key)}</span></span>
                      <span className="dm-v num">{c.v}</span>
                      <span className="dm-track"><i style={{ '--w': c.w }} />{/* inline-style-exempt: цвет/вар из данных демо */}</span>
                    </div>
                  ))}
                </div>
                <div className="perone"><Ic id="i-users" />{t('landing.demo.bud.perone')}<b className="num">{DEMO_BUDGET.perone}</b></div>
              </div>
              <div className="bcard rv">
                <div className="dm-card-h"><span className="dm-bic"><Ic id="i-ticks" /></span><h3>{t('landing.demo.bud.card2')}</h3><span className="dm-pill hand">{t('landing.demo.bud.card2_n')}</span></div>
                <div className="exp">
                  {DEMO_BUDGET.expenses.map((e, i) => (
                    <div className="e" key={i} style={{ '--s': e.tint.s, '--k': e.tint.k }}>{/* inline-style-exempt: цвет/вар из данных демо */}
                      <span className="ic"><Ic id={e.icon} /></span>
                      <span className="dm-nm"><b>{t(e.tKey)}</b><span>{t(e.sKey)}</span></span>
                      <span className={`dm-pill ${e.pill.cls}`}>{t(e.pill.key)}</span>
                      <span className="dm-v num">{e.v}</span>
                    </div>
                  ))}
                </div>
                <div className="perone"><Ic id="i-info" />{t('landing.demo.bud.fx')}</div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Bento: calendar / docs / services / stats ────────── */}
        <section className="more-sec sheet-pane section-pad" id="more">
          <div className="wrap">
            <div className="section-head centered rv">
              <span className="brow">{t('landing.demo.more.eyebrow')}</span>
              <h2>{t('landing.demo.more.h2a')} <span className="accent">{t('landing.demo.more.h2b')}</span></h2>
              <p>{t('landing.demo.more.p')}</p>
            </div>
            <div className="bento" data-stagger>
              {/* Calendar */}
              <article className="bcard b-cal rv">
                <span className="dm-bic"><Ic id="i-cal2" /></span>
                <h3>{t('landing.demo.more.cal.t')}</h3>
                <p>{t('landing.demo.more.cal.p')}</p>
                <div className="cal">
                  <div className="cal-top"><b>{t('landing.demo.more.cal.month')}</b><span>{t('landing.demo.more.cal.range')}</span></div>
                  <div className="cal-wd">{t('landing.demo.more.cal.wd').split(' ').map((d, i) => <span key={i}>{d}</span>)}</div>
                  <div className="cal-g">
                    {DEMO_CAL.map((d, i) => (d.n == null ? (
                      <div className="cal-d" key={i} />
                    ) : d.c == null ? (
                      <div className="cal-d" key={i}><span className="dm-n">{d.n}</span></div>
                    ) : (
                      <div className="cal-d trip" key={i} style={{ '--c': d.c }}>{/* inline-style-exempt: цвет/вар из данных демо */}
                        <span className="dm-n">{d.n}</span>
                        <span className="cal-dots">{Array.from({ length: d.dots || 0 }).map((_, k) => <i key={k} />)}</span>
                        <CalBar day={d} />
                      </div>
                    )))}
                  </div>
                  <div className="cal-legend">
                    {DEMO_CAL_LEGEND.map((l, i) => <span key={i}><i style={{ background: l.c }} />{/* inline-style-exempt: цвет/вар из данных демо */}{t(l.key)}</span>)}
                  </div>
                </div>
              </article>
              {/* Documents */}
              <article className="bcard dm-b-docs rv">
                <span className="dm-bic vio"><Ic id="i-doc" /></span>
                <h3>{t('landing.demo.more.docs.t')}</h3>
                <p>{t('landing.demo.more.docs.p')}</p>
                <div className="doc-list">
                  {DEMO_DOCS.map((d, i) => (
                    <div className="dm-doc-row" key={i}>
                      <span className="ft" style={{ '--c': FT_COLOR[d.ft] }}>{d.ft}{/* inline-style-exempt: цвет бейджа по формату (карта FT_COLOR) */}</span>
                      <span className="tx"><b>{t(d.tKey)}</b><span>{t(d.sKey)}</span></span>
                    </div>
                  ))}
                </div>
              </article>
              {/* Services */}
              <article className="bcard b-svc rv">
                <span className="dm-bic dm-mint"><Ic id="i-spark" /></span>
                <h3>{t('landing.demo.more.svc.t')}</h3>
                <p>{t('landing.demo.more.svc.p')}</p>
                <div className="svc-list">
                  {DEMO_SVC.map((s, i) => (
                    <div className={`svc${s.add ? ' add' : ''}`} key={i}>
                      <span className={`dm-bic sm${s.mint ? ' mint' : ''}`}><Ic id={s.icon} /></span>
                      <span className="tx"><b>{t(s.tKey)}</b><span>{t(s.sKey)}</span></span>
                      {s.done && <span className="dm-pill done">{t('landing.demo.more.svc.done')}</span>}
                      {s.add && <Ic id="i-plus" />}
                    </div>
                  ))}
                </div>
              </article>
              {/* Stats */}
              <article className="bcard b-stats rv">
                <span className="dm-bic rose"><Ic id="i-spark" /></span>
                <h3>{t('landing.demo.more.stat.t')}</h3>
                <p>{t('landing.demo.more.stat.p')}</p>
                <div className="stats-grid">
                  {DEMO_STAT_TILES.map((s, i) => <div className="stat-t" key={i}><b className="num">{s.n}</b><span>{t(s.key)}</span></div>)}
                </div>
                <div className="stat-lines">
                  {DEMO_STAT_LINES.map((s, i) => (
                    <div className="stat-line" key={i}>
                      <span className={`dm-bic sm${s.mint ? ' mint' : ''}${s.vio ? ' vio' : ''}`}><Ic id={s.icon} /></span>
                      {t(s.tKey)}<em className={s.emNum ? 'num' : undefined}>{s.emKey ? t(s.emKey) : s.em}</em>
                    </div>
                  ))}
                </div>
              </article>
            </div>
          </div>
        </section>

        {/* ── Team: members + chat ─────────────────────────────── */}
        <section className="team-sec section-pad" id="team">
          <div className="wrap">
            <div className="section-head rv">
              <span className="brow">{t('landing.demo.team.eyebrow')}</span>
              <h2>{t('landing.demo.team.h2a')} <span className="accent">{t('landing.demo.team.h2b')}</span></h2>
              <p dangerouslySetInnerHTML={{ __html: t('landing.demo.team.p') }} />
            </div>
            <div className="team-grid">
              <div className="bcard rv">
                <div className="dm-card-h"><span className="dm-bic"><Ic id="i-users" /></span><h3>{t('landing.demo.team.card')}</h3></div>
                {DEMO_MEMBERS.map((m, i) => (
                  <div className={`mem${m.pending ? ' pending' : ''}`} key={i}>
                    <span className="dm-av" style={m.color ? { background: m.color } : undefined}>{m.icon ? <Ic id={m.icon} /> : m.ini}</span>
                    <span className="dm-nm"><b>{m.name}</b><span>{t(m.subKey)}</span></span>
                    <span className={`dm-pill ${m.pill.cls}`}>{t(m.pill.key)}</span>
                  </div>
                ))}
                <div className="role-note">
                  {DEMO_ROLE_NOTES.map((k, i) => <span key={i} dangerouslySetInnerHTML={{ __html: t(k) }} />)}
                </div>
              </div>
              <div className="chat rv">
                <div className="chat-h">
                  <span className="dm-bic"><Ic id="i-chat" /></span>
                  <div><b>{t('landing.demo.chat.title')}</b><small>{t('landing.demo.chat.sub')}</small></div>
                  <span className="dm-avs avs--push">
                    {DEMO_PEOPLE.slice(0, 3).map((p) => (
                      <span className="dm-av av--xs" key={p.ini} style={{ background: p.color }}>{p.ini}{/* inline-style-exempt: цвет/вар из данных демо */}</span>
                    ))}
                  </span>
                </div>
                <div className="chat-b">
                  {DEMO_CHAT.map((m, i) => (
                    <div className={`msg${m.me ? ' dm-me' : ''}${m.ai ? ' ai' : ''}`} key={i}>
                      <span className="dm-av av--sm" style={m.ai ? undefined : { background: m.color }}>
                        {m.ai ? <Ic id={m.ini} /> : m.ini}
                      </span>
                      <div className="bub">
                        <div className="who"><b>{m.who}</b>{m.pill && <span className="dm-pill ai">{t(m.pill)}</span>}<time>{m.time}</time></div>
                        {m.mention ? <><span className="mention">{m.mention}</span> {t(m.bKey)}</> : t(m.bKey)}
                      </div>
                    </div>
                  ))}
                  <div className="typing"><span>{t('landing.demo.chat.typing')}</span><i /><i /><i /></div>
                </div>
                <div className="chat-c">
                  <span className="fake">{t('landing.demo.chat.placeholder')}</span>
                  <span className="snd"><Ic id="i-send" /></span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Telegram assistant ───────────────────────────────────
            Phone + chat REUSE the landing's exact global classes (.tg-grid /
            .phone.device / .tg-status / .tg-head / .tg-chat / .tg-msg / .tg-doc
            / .tg-points / .cic) — same chrome, not a hand-tuned copy. Only the
            message data differs. The demo palette band stays via the shared `sheet-pane`.
            floor-exempt: dsshare +2 — реюз шапки телефона лендинга (статус-бар
            сигнал/wifi/батарея + иконки шапки) добавляет сырую разметку в
            витрину демо (out-of-scope, как LandingPage/PublicTrip), доля из ДС
            падает на 0.02%. Апрув Pavel: «взять телеграм как на лендинге». */}
        <section className="tg-sec sheet-pane section-pad" id="assistant">
          <div className="wrap tg-grid">
            <div className="tg-demo rv-l">
              <div className="phone device">
                <div className="phone-screen device-screen">
                  <div className="tg-status" aria-hidden="true">
                    <span className="tg-time">9:41</span>
                    <span className="tg-island" />
                    <span className="tg-sys">
                      <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor"><rect x="0" y="7" width="3" height="4" rx="1" /><rect x="4.5" y="5" width="3" height="6" rx="1" /><rect x="9" y="2.5" width="3" height="8.5" rx="1" /><rect x="13.5" y="0" width="3" height="11" rx="1" /></svg>
                      <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor"><path d="M8 2.6c2.6 0 5 1 6.8 2.6l-1.5 1.7C11.9 5.6 10 4.8 8 4.8s-3.9.8-5.3 2.1L1.2 5.2C3 3.6 5.4 2.6 8 2.6Z" /><path d="M8 6.4c1.5 0 2.9.6 4 1.5L8 11.7 4 7.9C5.1 7 6.5 6.4 8 6.4Z" /></svg>
                      <svg width="25" height="12" viewBox="0 0 25 12" fill="none"><rect x="1" y="1" width="20" height="10" rx="3" stroke="currentColor" strokeWidth="1" opacity=".45" /><rect x="2.6" y="2.6" width="15" height="6.8" rx="1.6" fill="currentColor" /><rect x="22.4" y="4" width="1.7" height="4" rx=".8" fill="currentColor" opacity=".45" /></svg>
                    </span>
                  </div>
                  <div className="tg-head">
                    <span className="tav"><svg width="18" height="18" style={{ color: '#fff' }}><use href="#i-tg" /></svg>{/* inline-style-exempt: белый значок на брендовом фоне (как на лендинге) */}</span>
                    <div><b>Triplanio</b>{/* i18n-ignore: имя продукта, как <b>Triplanio Assistant</b> на лендинге */}<small>{t('landing.demo.tg.bot_status')}</small></div>
                    <span className="tg-hicons" aria-hidden="true"><svg viewBox="0 0 24 24" width="17" height="17"><path fill="currentColor" d="M6.6 10.8c1.4 2.7 3.9 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.3 0 .7-.2 1l-2.3 2.2Z" /></svg><svg viewBox="0 0 24 24" width="17" height="17"><circle cx="12" cy="5" r="1.7" fill="currentColor" /><circle cx="12" cy="12" r="1.7" fill="currentColor" /><circle cx="12" cy="19" r="1.7" fill="currentColor" /></svg></span>
                  </div>
                  <div className="tg-chat">
                    {DEMO_TG_MSGS.map((m, i) => (m.date ? (
                      <div className="tg-date" key={i}>{t(m.date)}</div>
                    ) : (
                      <div className={`tg-msg ${m.bot ? 'bot' : 'user'}`} key={i}>
                        <span dangerouslySetInnerHTML={{ __html: t(m.bKey) }} />
                        {m.doc && (
                          <span className="tg-doc"><span className="dic"><Ic id="i-doc" size={16} /></span><span className="dmeta"><b>{m.doc.name}</b><span>{t(m.doc.metaKey)}</span></span></span>
                        )}
                        <small>{m.time} {m.ticks && <svg className="ticks" aria-hidden="true"><use href="#i-ticks" /></svg>}</small>
                      </div>
                    )))}
                  </div>
                </div>
              </div>
            </div>
            <div className="rv-r">
              <span className="brow">{t('landing.demo.tg.eyebrow')}</span>
              <h2 className="tg-h2">{t('landing.demo.tg.h2a')} <span className="accent">{t('landing.demo.tg.h2b')}</span></h2>
              <p className="tg-lede">{t('landing.demo.tg.p')}</p>
              <ul className="tg-points">
                {DEMO_TG_POINTS.map((p, i) => (
                  <li key={i}>
                    <span className="cic"><Ic id={p.icon} size={19} /></span>
                    <div><b>{t(p.tKey)}</b><p>{t(p.pKey)}</p></div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <DemoCta />
      </main>

      <SiteFooter lang={lang} setLang={setLang} brandHref={SITE} />
    </>
  );
}

/**
 * Финальный CTA демо — ТА ЖЕ секция, что на лендинге и публичке: `<SiteCta>`.
 * Здесь был форк со своими классами `.dm-final` / `.sheet-pane` (побайтовые копии
 * `.final` / `.sheet-pane`), из-за которого правка CTA обходила демо стороной.
 * Уникален только текст — он и передаётся префиксом ключей.
 */
function DemoCta() {
  return <SiteCta ns="landing.demo.fin" surface="demo" />;
}
