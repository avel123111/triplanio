import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { useI18n } from '@/lib/i18n/I18nContext';
import { Icon as BaseIcon } from '@/design/icons';
import { SiteHeader, SiteFooter, useLandingCss } from '@/components/site/SiteChrome';

const APP_URL = '/login';
const Icon = (props) => <BaseIcon size={20} {...props} />;

const copy = {
  en: {
    heroTitle: 'Your whole trip — in one place. And it guides you.',
    heroLead: 'Route, budget, bookings and conversations stay connected and watched over. Triplanio suggests, reminds and keeps things tidy while you look forward to the trip.',
    start: 'Start free', see: 'See how it works', micro: 'Free · no card · ru/en/es',
    navCta: 'Start free', login: 'Log in',
    painEyebrow: 'Before Triplanio', painTitle: 'A trip should not live in five chats.', painLead: 'Usually it is scattered across chats, booking screenshots and a note called “who booked what”. People get used to it. We do not.',
    coreTitle: 'One living place for the whole trip.', coreLead: 'Itinerary, money, bookings and chat are connected. Change the plan and the nearby details update with it. If you travel with someone, everyone sees it.',
    planTitle: 'Planning starts with hints, not a blank page.', planLead: 'Triplanio suggests where to stay and what to see, then folds the route into calm day-by-day chips in minutes.',
    assistTitle: 'Nothing important has to stay in your head.', assistLead: 'Check-in, departures, booking details and trip questions surface in the app and in Telegram — right when they matter.',
    moneyTitle: 'Multi-currency money, visible all the way.', moneyLead: 'See what has already been spent and what the trip costs across currencies, categories and cities — without mental exchange-rate math.',
    afterTitle: 'The trip does not disappear at home.', afterLead: 'Share a beautiful trip page, then let visited cities and countries collect on your travel map.',
    modesTitle: 'Your trip, your way.', pause: 'Less prep chaos — more of the journey itself.',
    finalTitle: 'Build your next trip in one calm place.', finalLead: 'Start free. No credit card. Works for solo trips and groups.',
    faqTitle: 'Questions before you pack.',
    faq: [
      ['Is it useful if I travel solo?', 'Yes. Solo is first-class: your route, bookings, budget and reminders stay collected even when nobody else joins.'],
      ['Does everyone need to register?', 'No. You can plan alone, invite people later and keep offline participants visible for shared budgets and context.'],
      ['How does the multi-currency budget work?', 'Expenses can live in different currencies with categories, cities and exchange rates, then roll up into one readable total.'],
      ['Is Telegram required?', 'No. It is an extra channel for reminders and assistant answers; the trip also works in the web app.'],
      ['Are trip and group data private?', 'Trips are private by default and visible only to you and invited people unless you create a share link.'],
      ['Which languages are available?', 'The landing and product language switcher supports English, Russian and Spanish.'],
    ],
    modes: [['Solo', 'Everything is collected and watched over. Nothing gets forgotten.'], ['Friends', 'Plan together, everyone stays in the loop, nobody drops out.'], ['Couple', 'Quiet anticipation instead of three parallel chats.'], ['Family', 'Documents, bookings and day chips stay close at hand.']],
  },
  ru: {
    heroTitle: 'Вся поездка — в одном месте. И оно ведёт её за тебя.',
    heroLead: 'Маршрут, бюджет, брони и общение — вместе и под присмотром. Triplanio подсказывает, напоминает и держит всё в порядке, пока ты предвкушаешь поездку.',
    start: 'Начать бесплатно', see: 'Посмотреть, как устроено', micro: 'Бесплатно · без карты · ru/en/es',
    navCta: 'Начать бесплатно', login: 'Войти',
    painEyebrow: 'До Triplanio', painTitle: 'Поездка не должна жить в пяти чатах.', painLead: 'Обычно она размазана по перепискам, скриншотам броней и заметке «кто что бронировал». К этому привыкают. Мы — нет.',
    coreTitle: 'Одно живое место для всей поездки.', coreLead: 'Маршрут, деньги, брони и разговор связаны между собой. Меняешь план — рядом обновляются детали. Если едешь с кем-то — видят все.',
    planTitle: 'Планирование начинается с подсказок, а не с пустого листа.', planLead: 'Triplanio подсказывает, где остановиться и что посмотреть, и складывает маршрут по дням за минуты.',
    assistTitle: 'Важное не нужно держать в голове.', assistLead: 'Заезд, вылеты, детали броней и вопросы по поездке появляются в приложении и в Telegram — ровно когда нужно.',
    moneyTitle: 'Мультивалютный бюджет виден всю дорогу.', moneyLead: 'Сколько уже потрачено и во что выходит поездка — по валютам, категориям и городам, без пересчёта в уме.',
    afterTitle: 'Дома поездка не исчезает.', afterLead: 'Поделись красивой страницей поездки, а города и страны сами сложатся на карту путешествий.',
    modesTitle: 'Твоя поездка — по-твоему.', pause: 'Меньше суеты в подготовке — больше самого путешествия.',
    finalTitle: 'Собери следующую поездку в одном спокойном месте.', finalLead: 'Начать можно бесплатно. Без карты. Для соло-поездок и компаний.',
    faqTitle: 'Вопросы перед стартом.',
    faq: [
      ['Подходит, если я путешествую один?', 'Да. Соло — не побочный сценарий: маршрут, брони, бюджет и напоминания собраны и под присмотром.'],
      ['Нужно ли всем участникам регистрироваться?', 'Нет. Можно планировать одному, пригласить людей позже и держать офлайн-участников в бюджете и контексте.'],
      ['Как работает бюджет с разными валютами?', 'Траты живут в разных валютах с категориями, городами и курсами, а затем складываются в понятный итог.'],
      ['Telegram обязателен?', 'Нет. Это дополнительный канал для напоминаний и ответов ассистента; в веб-приложении всё тоже работает.'],
      ['Данные поездки приватны?', 'Поездки приватны по умолчанию и видны только тебе и приглашённым людям, если ты не создал публичную ссылку.'],
      ['На каких языках доступно?', 'Переключатель поддерживает русский, английский и испанский.'],
    ],
    modes: [['Одному', 'Вся поездка собрана и под присмотром. Ничего не забыто.'], ['С друзьями', 'Планируете вместе, все в курсе, никто не выпадает.'], ['Вдвоём', 'Спокойное предвкушение вместо переписки в трёх чатах.'], ['Семьёй', 'Документы и брони под рукой, понятный маршрут по дням.']],
  },
  es: {
    heroTitle: 'Todo el viaje en un solo lugar. Y te acompaña.',
    heroLead: 'Ruta, presupuesto, reservas y conversación quedan conectados. Triplanio sugiere, recuerda y mantiene todo ordenado mientras esperas el viaje.',
    start: 'Empezar gratis', see: 'Ver cómo funciona', micro: 'Gratis · sin tarjeta · ru/en/es',
    navCta: 'Empezar gratis', login: 'Entrar',
    painEyebrow: 'Antes de Triplanio', painTitle: 'Un viaje no debería vivir en cinco chats.', painLead: 'Normalmente está repartido entre mensajes, capturas de reservas y una nota de “quién reservó qué”. La gente se acostumbra. Nosotros no.',
    coreTitle: 'Un lugar vivo para todo el viaje.', coreLead: 'Itinerario, dinero, reservas y chat están conectados. Cambias el plan y los detalles cercanos se actualizan. Si viajas con alguien, todos lo ven.',
    planTitle: 'Planear empieza con sugerencias, no con una página vacía.', planLead: 'Triplanio sugiere dónde quedarse y qué ver, y arma la ruta por días en minutos.',
    assistTitle: 'Lo importante no tiene que vivir en tu cabeza.', assistLead: 'Check-in, salidas, reservas y preguntas aparecen en la app y en Telegram justo cuando importan.',
    moneyTitle: 'Presupuesto multidivisa visible durante todo el viaje.', moneyLead: 'Ve cuánto se gastó y cuánto cuesta el viaje entre divisas, categorías y ciudades, sin calcular mentalmente.',
    afterTitle: 'El viaje no termina al volver a casa.', afterLead: 'Comparte una página bonita y deja que ciudades y países visitados se guarden en tu mapa.',
    modesTitle: 'Tu viaje, a tu manera.', pause: 'Menos caos al preparar — más viaje de verdad.',
    finalTitle: 'Arma tu próximo viaje en un lugar tranquilo.', finalLead: 'Empieza gratis. Sin tarjeta. Para viajar solo o en grupo.',
    faqTitle: 'Preguntas antes de salir.',
    faq: [
      ['¿Sirve si viajo solo?', 'Sí. Viajar solo está cuidado: ruta, reservas, presupuesto y recordatorios quedan reunidos.'],
      ['¿Todos tienen que registrarse?', 'No. Puedes planear solo, invitar después y mantener participantes offline en presupuesto y contexto.'],
      ['¿Cómo funciona el presupuesto multidivisa?', 'Los gastos pueden estar en distintas divisas con categorías, ciudades y tipos de cambio, y reunirse en un total claro.'],
      ['¿Telegram es obligatorio?', 'No. Es un canal extra para recordatorios y respuestas; el viaje también funciona en la web.'],
      ['¿Mis datos son privados?', 'Los viajes son privados por defecto y visibles solo para ti y tus invitados, salvo que crees un enlace público.'],
      ['¿Qué idiomas hay?', 'El selector admite inglés, ruso y español.'],
    ],
    modes: [['Solo', 'Todo está reunido y vigilado. Nada se olvida.'], ['Amigos', 'Planifican juntos y todos siguen al tanto.'], ['Pareja', 'Anticipación tranquila en vez de tres chats.'], ['Familia', 'Documentos, reservas y días siempre a mano.']],
  },
};

function AtomBudget() {
  return <div className="tlp-budget"><div className="tlp-donut"/><div><b>€4,820</b><span>$5,210 · ₽491k</span><em>Hotels · Food · Trains</em></div></div>;
}
function HeroAtoms({ c }) {
  return <div className="tlp-hero-art" aria-hidden="true"><div className="tlp-route"><span>Lisbon</span><i/><span>Porto</span><i/><span>BCN</span></div><AtomBudget/><div className="tlp-ai"><strong>@Triplanio</strong><p>{c.assistLead.split('.')[0]}.</p></div></div>;
}
function PainVisual() { return <div className="tlp-chaos" aria-hidden="true"><div className="scrap chat">who booked hotel?</div><div className="scrap mail">BA503 · e-ticket</div><div className="scrap note">todo: check €€€</div><div className="scrap sheet">Split / Sam / Mike</div><div className="tlp-order"><div className="day">Day 1 · Flight</div><div className="day warm">Hotel confirmed</div><div className="day green">Budget synced</div></div></div>; }
function CoreVisual() { return <div className="tlp-coreviz" aria-hidden="true"><div className="chip">+1 day in Porto</div><div className="pulse one">Route updated</div><div className="pulse two">Budget recalculated</div><div className="pulse three">Booking moved</div><div className="avatars"><span>A</span><span>M</span><span>+2</span></div></div>; }
function PlanVisual() { return <div className="tlp-planviz" aria-hidden="true">{['Jul 12','Jul 13','Jul 14','Jul 15'].map((d,i)=><div className="plan-day" key={d}><b>{d}</b><span>{i<2?'Filled':'Open'}</span></div>)}<div className="suggest"><Icon name="sparkles"/> Alfama stay · river morning</div></div>; }
function AssistVisual() { return <div className="tlp-assistviz" aria-hidden="true"><div className="telegram">Telegram · 09:14<br/><b>Leave for the station at 14:10</b></div><div className="appbubble"><b>@Triplanio</b><br/>Your train is coach 22 · seats 41A-D.</div></div>; }
function MoneyVisual() { return <div className="tlp-moneyviz" aria-hidden="true"><AtomBudget/>{['Hotel €2,025','Flight $1,460','Dinner ₽8,400'].map(x=><div className="expense" key={x}>{x}<span>synced</span></div>)}<div className="fx">€1 = $1.08 · ₽101.8</div></div>; }
function AfterVisual() { return <div className="tlp-afterviz" aria-hidden="true"><div className="postcard"><b>Iberia summer</b><span>Lisbon → Porto → Barcelona</span></div><div className="map"><i/><i/><i/><b>7 countries · 24 cities</b></div></div>; }

function FeatureBlock({ id, eyebrow, title, lead, visual, reverse }) {
  return <section className={`tlp-section tlp-proof ${reverse ? 'is-reverse' : ''}`} id={id}><div><span className="tlp-eyebrow">{eyebrow}</span><h2>{title}</h2><p>{lead}</p></div>{visual}</section>;
}

function LandingPageBody() {
  const { lang } = useI18n();
  const c = copy[lang] || copy.en;
  const nav = useNavigate();
  const { isAuthenticated } = useAuth();
  const ctaTarget = isAuthenticated ? '/trips' : APP_URL;
  return <main className="tlp" id="top">
    <section className="tlp-hero"><div className="tlp-copy"><span className="tlp-kicker">Triplanio · trip command center</span><h1>{c.heroTitle}</h1><p>{c.heroLead}</p><div className="tlp-actions"><button className="btn btn--primary btn--lg" onClick={() => nav(ctaTarget)}>{c.start}</button><a className="btn btn--ghost btn--lg" href="#how">{c.see}</a></div><small>{c.micro}</small></div><HeroAtoms c={c}/></section>
    <section className="tlp-section tlp-pain"><div><span className="tlp-eyebrow">{c.painEyebrow}</span><h2>{c.painTitle}</h2><p>{c.painLead}</p></div><PainVisual/></section>
    <FeatureBlock id="features" eyebrow="Connected core" title={c.coreTitle} lead={c.coreLead} visual={<CoreVisual/>}/>
    <FeatureBlock id="how" eyebrow="Fast start" title={c.planTitle} lead={c.planLead} visual={<PlanVisual/>} reverse/>
    <FeatureBlock eyebrow="Assistant" title={c.assistTitle} lead={c.assistLead} visual={<AssistVisual/>}/>
    <FeatureBlock eyebrow="Budget" title={c.moneyTitle} lead={c.moneyLead} visual={<MoneyVisual/>} reverse/>
    <FeatureBlock eyebrow="After the trip" title={c.afterTitle} lead={c.afterLead} visual={<AfterVisual/>}/>
    <section className="tlp-section"><span className="tlp-eyebrow">For any trip</span><h2>{c.modesTitle}</h2><div className="tlp-modes">{c.modes.map((m,i)=><article key={m[0]}><div className="miniavatars"><span>{m[0][0]}</span>{i>0 && <span>+</span>}</div><h3>{m[0]}</h3><p>{m[1]}</p></article>)}</div></section>
    <section className="tlp-pause"><h2>{c.pause}</h2></section>
    <section className="tlp-section tlp-faq" id="faq"><h2>{c.faqTitle}</h2>{c.faq.map(([q,a])=><details key={q}><summary>{q}</summary><p>{a}</p></details>)}</section>
    <section className="tlp-final"><h2>{c.finalTitle}</h2><p>{c.finalLead}</p><button className="btn btn--white btn--lg" onClick={() => nav(ctaTarget)}>{c.start}</button><small>{c.micro}</small></section>
  </main>;
}

function useScrollReveal(ready) {
  useEffect(() => {
    if (!ready || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    document.documentElement.classList.add('reveal--ready');
    return () => document.documentElement.classList.remove('reveal--ready');
  }, [ready]);
}

export default function LandingPage() {
  const { lang, setLang } = useI18n();
  useEffect(() => { const r = document.documentElement; r.classList.remove('dark'); r.setAttribute('data-theme', 'light'); }, []);
  useEffect(() => { document.documentElement.setAttribute('lang', lang); }, [lang]);
  const cssReady = useLandingCss();
  useScrollReveal(cssReady);
  if (!cssReady) return null;
  return <><SiteHeader lang={lang} setLang={setLang} /><LandingPageBody/><SiteFooter lang={lang} setLang={setLang} /></>;
}
