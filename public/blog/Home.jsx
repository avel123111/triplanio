/* global React, window, Icon */
const { useState: useStateH } = React;

/* destination explorer that drills in-place, then jumps to the category page */
function DestExplorer() {
  const { go } = window.useApp();
  const [dest, setDest] = useStateH(null);
  const D = window.TRIP.DESTINATIONS;
  const d = dest || {};
  const cont = D.find(c => c.id === d.continent);
  const country = cont && cont.countries.find(c => c.id === d.country);

  let options = D, level = "continent", mk = (o) => ({ continent: o.id });
  if (country) { level = "city"; options = country.cities; mk = (o) => ({ continent: cont.id, country: country.id, city: o.id }); }
  else if (cont) { level = "country"; options = cont.countries; mk = (o) => ({ continent: cont.id, country: o.id }); }

  const subLabel = (o) => {
    if (level === "continent") return `${o.countries.length} стран`;
    if (level === "country") return `${o.cities.length} городов`;
    return "Город";
  };

  return (
    <div className="destnav">
      <div className="destnav__head">
        {dest && <button className="destnav__back" onClick={() => setDest(country ? { continent: cont.id } : null)}><Icon name="arrowLeft" size={16} /></button>}
        <span className="crumb">
          <span onClick={() => setDest(null)} style={{ cursor: "pointer", color: dest ? "var(--muted)" : "var(--ink-2)", fontWeight: dest ? 500 : 600 }}>Все направления</span>
          {cont && <><span className="sep">/</span><b>{cont.label}</b></>}
          {country && <><span className="sep">/</span><b>{country.label}</b></>}
        </span>
        {dest && <button className="more" style={{ marginLeft: "auto", border: 0, background: "none" }} onClick={() => go("category", { init: { dest } })}>Открыть<Icon name="arrowRight" size={14} /></button>}
      </div>
      <div className="destnav__list">
        {options.map(o => {
          const target = mk(o);
          return (
            <button key={o.id} className="destrow" onClick={() => level === "city" ? go("category", { init: { dest: target } }) : setDest(target)}>
              <span className="destrow__ic"><Icon name={level === "city" ? "pin" : "globe"} size={19} /></span>
              <span>
                <span className="destrow__lbl" style={{ display: "block" }}>{o.label}</span>
                <span className="destrow__sub">{subLabel(o)}</span>
              </span>
              <span className="count">{window.countFor(target)}</span>
              <Icon name="chevron" size={16} style={{ color: "var(--muted-2)" }} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Home() {
  const { go, openSearch, viewport } = window.useApp();
  const A = window.TRIP.ARTICLES;
  const featured = A.find(a => a.featured) || A[0];
  const editorPicks = A.filter(a => a.featured).slice(0, 3);
  const recent = A.slice().sort((a, b) => b.date.localeCompare(a.date));
  const deals = A.filter(a => a.type === "deal");
  const guides = A.filter(a => a.type === "guide" || a.type === "listicle");

  const onNav = (path) => {
    if (path[0] === "topic") go("category", { init: { topics: [path[1]] } });
    else go("category", { init: { dest: { continent: path[0], country: path[1], city: path[2] } } });
  };

  return (
    <div className="fade-route">
      <section className="hero-home">
        <span className="eyebrow">Блог Triplanio</span>
        <h1 style={{ marginTop: 14 }}>Истории и гайды для тех, кто планирует всерьёз.</h1>
        <p className="lede">Маршруты, проверенные адреса и практичные советы — от бюджетных поездок до медового месяца. Без «вау, как красиво», только то, что пригодится в планировании.</p>
        <div style={{ marginTop: 20, maxWidth: 520 }}>
          <button className="searchbtn" onClick={openSearch}>
            <Icon name="search" size={18} />
            <span>Куда едем? Место, тема или тег…</span>
            {viewport === "desktop" && <span className="kbd">⌘K</span>}
          </button>
        </div>
        <div className="chipcloud" style={{ marginTop: 16 }}>
          {window.TRIP.CONTENT_TYPES.slice(0, 5).map(t => (
            <button key={t.id} className="chipbig" onClick={() => go("category", { init: { types: [t.id] } })}>{t.label}</button>
          ))}
        </div>
      </section>

      <div className="screenpad" style={{ paddingTop: 6 }}>
        <div className="wrap">
          {/* featured */}
          <section>
            <div className="sectionhead"><h2>Выбор редакции</h2></div>
            <ArticleCard a={featured} variant="feature" onNav={onNav} />
            {viewport === "desktop" && (
              <div className="cardgrid" style={{ marginTop: 24 }}>
                {recent.slice(0, 3).map(a => <ArticleCard key={a.slug} a={a} onNav={onNav} />)}
              </div>
            )}
          </section>

          {/* destination explorer */}
          <section className="block-sect">
            <div className="sectionhead">
              <h2>Куда отправимся?</h2>
              <span className="more" onClick={() => go("category", {})}>Все статьи<Icon name="arrowRight" size={14} /></span>
            </div>
            <p className="muted" style={{ fontSize: 14, margin: "-6px 0 14px" }}>Выберите континент, спуститесь к стране и городу — как путешествие вглубь.</p>
            <DestExplorer />
          </section>

          {/* topics cloud */}
          <section className="block-sect">
            <div className="sectionhead"><h2>Темы</h2></div>
            <div className="chipcloud">
              {window.TRIP.TOPICS.map(t => (
                <button key={t.id} className="chipbig" onClick={() => go("category", { init: { topics: [t.id] } })}>
                  {t.label}<span className="n">{window.TRIP.ARTICLES.filter(a => a.topics.includes(t.id)).length}</span>
                </button>
              ))}
            </div>
          </section>

          {/* recent rail (mobile) / grid (desktop) */}
          <section className="block-sect">
            <div className="sectionhead"><h2>Свежее</h2><span className="more" onClick={() => go("category", {})}>Смотреть всё<Icon name="arrowRight" size={14} /></span></div>
            {viewport === "desktop"
              ? <div className="cardgrid">{recent.slice(0, 6).map(a => <ArticleCard key={a.slug} a={a} onNav={onNav} />)}</div>
              : <div className="rail">{recent.slice(0, 6).map(a => <ArticleCard key={a.slug} a={a} onNav={onNav} />)}</div>}
          </section>

          {/* guides collection */}
          <section className="block-sect">
            <div className="sectionhead"><h2>Гайды и подборки</h2></div>
            {viewport === "desktop"
              ? <div className="cardgrid">{guides.slice(0, 3).map(a => <ArticleCard key={a.slug} a={a} onNav={onNav} />)}</div>
              : <div style={{ display: "grid", gap: 12 }}>{guides.slice(0, 4).map(a => <ArticleCard key={a.slug} a={a} variant="row" onNav={onNav} />)}</div>}
          </section>

          {/* deals strip */}
          {deals.length > 0 && (
            <section className="block-sect">
              <div className="sectionhead"><h2>Дилы недели</h2><span className="more" onClick={() => go("category", { init: { types: ["deal"] } })}>Все дилы<Icon name="arrowRight" size={14} /></span></div>
              <div style={{ display: "grid", gap: 12 }}>
                {deals.map(a => <ArticleCard key={a.slug} a={a} variant="row" onNav={onNav} />)}
              </div>
            </section>
          )}
        </div>
      </div>
      <AppFooter />
    </div>
  );
}

function AppFooter() {
  const { go } = window.useApp();
  return (
    <footer className="appfoot">
      <div className="wrap">
        <div className="appfoot__top">
          <div style={{ maxWidth: 280 }}>
            <div className="brand"><img src="assets/logo-mark.svg" alt="" /><span className="wm">Triplanio <span className="blog">Блог</span></span></div>
            <p className="muted" style={{ fontSize: 13.5, lineHeight: 1.55, marginTop: 12 }}>Весь маршрут — в одном красивом плане. Блог — часть приложения для планирования путешествий.</p>
          </div>
          <div className="cols">
            <div className="col"><h5>Разделы</h5><a onClick={() => go("category", { init: { types: ["guide"] } })}>Гайды</a><a onClick={() => go("category", { init: { types: ["listicle"] } })}>Подборки</a><a onClick={() => go("category", { init: { types: ["deal"] } })}>Дилы</a><a onClick={() => go("category", { init: { topics: ["visa"] } })}>Визы</a></div>
            <div className="col"><h5>Направления</h5><a onClick={() => go("category", { init: { dest: { continent: "europe" } } })}>Европа</a><a onClick={() => go("category", { init: { dest: { continent: "asia" } } })}>Азия</a><a onClick={() => go("category", { init: { dest: { continent: "americas" } } })}>Америка</a></div>
            <div className="col"><h5>Triplanio</h5><a>Приложение</a><a>AI-планировщик</a><a>Тарифы</a></div>
          </div>
        </div>
        <div className="appfoot__bottom"><span>© 2026 Triplanio</span><span>EN · RU · ES</span></div>
      </div>
    </footer>
  );
}

Object.assign(window, { Home, AppFooter, DestExplorer });
