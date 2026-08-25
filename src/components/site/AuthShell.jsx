import React, { useState, useEffect } from 'react';
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
export default function AuthShell({ lang, setLang, children }) {
  const t = useT();
  // Ротатор арт-пейна (декоративный, aria-hidden): крутит 3 строки прототипа.
  const [rot, setRot] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setRot((r) => (r + 1) % 3), 4200);
    return () => clearInterval(id);
  }, []);

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
          <div className="form-wrap">{children}</div>
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
