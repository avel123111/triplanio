import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '@/lib/i18n/I18nContext';
import { BRAND_NAME } from '@/lib/brand';
import { LangSwitch } from '@/components/site/SiteChrome';
import LandingSprite from '@/components/site/LandingSprite';

/* =========================================================
   AuthShell — общая двух-пейновая оболочка неавторизованной зоны
   (логин /login и join /join). Прототип v5.7 держит экраны обоих в
   ОДНОЙ оболочке, поэтому она вынесена сюда, а не скопирована в два
   файла: левый пейн (бренд + язык + переключаемые .screen через
   children + легал), правый — арт-фото с копией и ротатором.
   Всё под .auth (зонная ДС, site.css §AUTH). TRIP-464/463.
========================================================= */
export default function AuthShell({ lang, setLang, activeScreen, children }) {
  const t = useT();
  // Ротатор арт-пейна (декоративный, aria-hidden): крутит 3 строки прототипа.
  const [rot, setRot] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setRot((r) => (r + 1) % 3), 4200);
    return () => clearInterval(id);
  }, []);

  // ── Кроссфейд + анимация высоты между экранами (порт прототипа v5.7 `go`) ──
  // Прототип держит ВСЕ экраны смонтированными и кроссфейдит между ними, попутно
  // анимируя высоту .form-wrap от старого экрана к новому. React рендерит все
  // .screen сразу (Login/JoinTrip), а этот эффект переключает av-is-active/
  // av-is-leaving и гонит height. Первый маунт (нет уходящего) — без анимации.
  const formWrapRef = useRef(null);
  useLayoutEffect(() => {
    const wrap = formWrapRef.current;
    if (!wrap) return undefined;
    const to = wrap.querySelector(`.screen[data-screen="${activeScreen}"]`);
    if (!to) return undefined;
    const from = wrap.querySelector('.screen.av-is-active');
    if (from === to) return undefined;

    // Первый маунт: активируем стартовый экран без анимации высоты (без вспышки).
    if (!from) { to.classList.add('av-is-active'); return undefined; }

    const h0 = from.offsetHeight;
    from.classList.remove('av-is-active');
    from.classList.add('av-is-leaving');
    const leaveT = setTimeout(() => {
      if (!from.classList.contains('av-is-active')) from.classList.remove('av-is-leaving');
    }, 360);

    to.classList.add('av-is-active');
    const h1 = to.offsetHeight;
    wrap.style.height = h0 + 'px';
    const raf = requestAnimationFrame(() => { wrap.style.height = h1 + 'px'; });
    // После оседания перехода отпускаем высоту в auto, чтобы правки контента
    // внутри экрана (ошибка, смена strength) вписывались без фикс-высоты.
    const releaseT = setTimeout(() => { wrap.style.height = ''; }, 380);

    return () => { clearTimeout(leaveT); clearTimeout(releaseT); cancelAnimationFrame(raf); };
  }, [activeScreen]);

  return (
    <div className="authv">
      <LandingSprite />

      {/* ════ LEFT: форма ════ */}
      <section className="pane-form">
        {/* on-light: светлая шапка — темит общий LangSwitch (.lang-btn) в ink,
            как на светлых секциях лендинга. Реюз, не дубль (rule #6). */}
        <header className="pane-top on-light">
          <Link to="/" className="av-brand">
            <svg className="av-logo" width="33" height="33" aria-hidden="true"><use href="#tl-logo" /></svg>
            <span>{BRAND_NAME}</span>
          </Link>
          <div className="top-actions">
            <LangSwitch value={lang} onChange={setLang} />
          </div>
        </header>

        <main className="form-area">
          <div className="form-wrap" ref={formWrapRef}>{children}</div>
        </main>

        <footer className="pane-foot">
          <span>© 2026 {BRAND_NAME}</span>{/* i18n-ignore: год + бренд, как в прототипе */}
          {/* nav-exempt: /terms — статический HTML до Ф6 (vercel.json rewrite), <Link> дал бы 404 */}
          <a href="/terms">{t('auth.foot_terms')}</a>
          {/* nav-exempt: /privacy — статический HTML до Ф6 (vercel.json rewrite), <Link> дал бы 404 */}
          <a href="/privacy">{t('auth.foot_privacy')}</a>
          {/* mailto — внешний протокол (не internal href), как в футере лендинга */}
          <a href="mailto:support@triplanio.com">{t('auth.foot_support')}</a>
          <span className="secure">
            <svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-shield" /></svg>
            <span>{t('auth.foot_secure')}</span>
          </span>
        </footer>
      </section>

      {/* ════ RIGHT: арт-пейн (декоративный) ════ */}
      <aside className="pane-art" aria-hidden="true">
        <div className="art" />
        <div className="art-scrim" />
        <div className="art-copy">
          <span className="kicker">{t('auth.art_kicker')}</span>
          <h2 dangerouslySetInnerHTML={{ __html: t('auth.art_title') }} />
          <p className="rotator">
            {[0, 1, 2].map((i) => (
              <span key={i} className={i === rot ? 'av-on' : ''}>{t(`auth.art_l${i + 1}`)}</span>
            ))}
          </p>
        </div>
        <div className="art-grain" />
      </aside>
    </div>
  );
}
