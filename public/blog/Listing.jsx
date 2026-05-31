/* global React, window, Icon */
const { useState: useStateL, useEffect: useEffectL } = React;

const SORTS = [
  { id: "new", label: "Сначала новые" },
  { id: "read", label: "Время чтения" },
  { id: "az", label: "По алфавиту" },
];
function sortArticles(list, sort) {
  const c = list.slice();
  if (sort === "new") c.sort((a, b) => b.date.localeCompare(a.date));
  if (sort === "read") c.sort((a, b) => a.read - b.read);
  if (sort === "az") c.sort((a, b) => a.title.localeCompare(b.title, "ru"));
  return c;
}

/* shared toolbar: filter button + sort + count + active chips */
function ListToolbar({ f, set, activeCount, count, sort, setSort, onOpenFilter }) {
  const [sortOpen, setSortOpen] = useStateL(false);
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="flexrow" style={{ justifyContent: "space-between" }}>
        <div className="flexrow" style={{ gap: 8 }}>
          <button className="filterbtn" onClick={onOpenFilter}>
            <Icon name="filter" size={16} />Фильтры{activeCount > 0 && <span className="n">{activeCount}</span>}
          </button>
          <div style={{ position: "relative" }}>
            <button className="filterbtn" onClick={() => setSortOpen(o => !o)}><Icon name="sort" size={16} />{SORTS.find(s => s.id === sort).label}<Icon name="chevronDown" size={14} /></button>
            {sortOpen && (
              <div className="sharepop" style={{ top: "calc(100% + 6px)", left: 0, flexDirection: "column", padding: 6, width: 180 }}>
                {SORTS.map(s => (
                  <button key={s.id} style={{ width: "100%", justifyContent: "flex-start", padding: "9px 12px", color: s.id === sort ? "var(--brand)" : "var(--ink-2)", fontWeight: s.id === sort ? 700 : 500, fontSize: 13.5 }}
                    onClick={() => { setSort(s.id); setSortOpen(false); }}>{s.label}</button>
                ))}
              </div>
            )}
          </div>
        </div>
        <span className="resultcount"><b>{count}</b> {count === 1 ? "статья" : count >= 2 && count <= 4 ? "статьи" : "статей"}</span>
      </div>
      <ActiveChips f={f} set={set} />
    </div>
  );
}

/* sub-navigation chips that drill the destination hierarchy */
function DestSubnav({ dest, onDrill }) {
  const D = window.TRIP.DESTINATIONS;
  const cont = D.find(c => c.id === dest.continent);
  if (!cont) return null;
  const country = cont.countries.find(c => c.id === dest.country);
  let label, items;
  if (country && !dest.city) { label = "Города"; items = country.cities.map(c => ({ id: c.id, label: c.label, dest: { ...dest, city: c.id } })); }
  else if (!country) { label = "Страны"; items = cont.countries.map(c => ({ id: c.id, label: c.label, dest: { continent: cont.id, country: c.id } })); }
  else return null;
  if (!items.length) return null;
  return (
    <div style={{ marginTop: 4 }}>
      <div className="filtergroup__lbl" style={{ marginBottom: 9 }}>{label}</div>
      <div className="activebar">
        {items.map(it => (
          <button key={it.id} className="filterbtn" style={{ flex: "none" }} onClick={() => onDrill(it.dest)}>
            {it.label}<span className="n" style={{ background: "var(--surface-2)", color: "var(--muted)" }}>{window.countFor(it.dest)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function CategoryPage({ params }) {
  const { go, viewport } = window.useApp();
  const ff = window.useArticleFilter(params.init || {});
  const { f, set, toggle, results, activeCount } = ff;
  const [sort, setSort] = useStateL("new");
  const [filterOpen, setFilterOpen] = useStateL(false);
  const sorted = sortArticles(results, sort);

  // title + breadcrumb context
  let title = "Все статьи", crumbNav = null;
  if (f.dest) {
    const parts = window.TRIP.destPath(f.dest);
    const ids = [f.dest.continent, f.dest.country, f.dest.city].filter(Boolean);
    title = parts[parts.length - 1];
    crumbNav = (
      <span className="crumb crumb--link" style={{ fontSize: 13 }}>
        <span onClick={() => go("home")} style={{ cursor: "pointer" }}>Блог</span>
        {parts.map((p, i) => (
          <React.Fragment key={i}>
            <span className="sep">/</span>
            <span onClick={() => i < parts.length - 1 && set({ dest: { continent: ids[0], country: i >= 1 ? ids[1] : undefined, city: undefined } })}
              style={{ cursor: i < parts.length - 1 ? "pointer" : "default", fontWeight: i === parts.length - 1 ? 600 : 500, color: i === parts.length - 1 ? "var(--ink)" : "var(--muted)" }}>{p}</span>
          </React.Fragment>
        ))}
      </span>
    );
  } else if (f.topics.length === 1 && activeCount === 1) {
    title = window.topicLabel(f.topics[0]);
  } else if (f.types.length === 1 && activeCount === 1) {
    title = window.typeLabel(f.types[0]);
  }

  return (
    <div className="fade-route">
      <div className="screenpad">
        <div className="wrap">
          {crumbNav || <span className="crumb crumb--link" style={{ fontSize: 13 }}><span onClick={() => go("home")} style={{ cursor: "pointer" }}>Блог</span><span className="sep">/</span><b>Все статьи</b></span>}
          <h1 style={{ fontSize: viewport === "desktop" ? 40 : 30, marginTop: 12, letterSpacing: "-.03em" }}>{title}</h1>
          {f.dest && <DestSubnav dest={f.dest} onDrill={(d) => set({ dest: d })} />}
          <div style={{ marginTop: 18 }}>
            <ListToolbar f={f} set={set} activeCount={activeCount} count={results.length} sort={sort} setSort={setSort} onOpenFilter={() => setFilterOpen(true)} />
          </div>
          <div className={viewport === "desktop" ? "cardgrid" : ""} style={{ marginTop: 18, display: "grid", gap: viewport === "desktop" ? 24 : 14 }}>
            {sorted.map(a => <ArticleCard key={a.slug} a={a} variant={viewport === "desktop" ? "default" : "row"} onNav={(p) => p[0] === "topic" ? set({ topics: [p[1]] }) : set({ dest: { continent: p[0], country: p[1], city: p[2] } })} />)}
          </div>
          {!sorted.length && <div className="empty"><div className="ic"><Icon name="compass" size={26} /></div><h3>Здесь пока пусто</h3><p>Уберите часть фильтров, чтобы увидеть больше статей.</p><button className="btn btn--ghost" style={{ marginTop: 14 }} onClick={ff.reset}>Сбросить фильтры</button></div>}
        </div>
      </div>
      <AppFooter />
      <FilterSheet open={filterOpen} onClose={() => setFilterOpen(false)} f={f} set={set} toggle={toggle} resultCount={results.length} />
    </div>
  );
}

function SearchPage({ params }) {
  const { viewport } = window.useApp();
  const ff = window.useArticleFilter({ q: params.q || "" });
  const { f, set, toggle, results, activeCount } = ff;
  const [sort, setSort] = useStateL("new");
  const [filterOpen, setFilterOpen] = useStateL(false);
  const sorted = sortArticles(results, sort);

  return (
    <div className="fade-route">
      <div className="screenpad">
        <div className="wrap">
          <span className="eyebrow" style={{ marginBottom: 14 }}>Поиск</span>
          <div className="searchfield" style={{ marginBottom: 16, padding: "13px 16px" }}>
            <Icon name="search" size={19} style={{ color: "var(--brand)" }} />
            <input autoFocus placeholder="Куда едем? Тема, место, тег…" value={f.q} onChange={e => set({ q: e.target.value })} />
            {f.q && <button className="iconbtn sm" style={{ width: 28, height: 28, border: 0, background: "var(--surface-2)" }} onClick={() => set({ q: "" })}><Icon name="close" size={14} /></button>}
          </div>
          <ListToolbar f={f} set={set} activeCount={activeCount} count={results.length} sort={sort} setSort={setSort} onOpenFilter={() => setFilterOpen(true)} />
          {f.q.trim() && <p className="muted" style={{ fontSize: 14, marginTop: 14 }}>Результаты по запросу «<b style={{ color: "var(--ink)" }}>{f.q}</b>»</p>}
          <div style={{ marginTop: 14, display: "grid", gap: viewport === "desktop" ? 14 : 12 }}>
            {sorted.map(a => <ArticleCard key={a.slug} a={a} variant="row" onNav={(p) => p[0] === "topic" ? set({ topics: [p[1]] }) : set({ dest: { continent: p[0], country: p[1], city: p[2] } })} />)}
          </div>
          {!sorted.length && f.q.trim() && <div className="empty"><div className="ic"><Icon name="search" size={26} /></div><h3>Ничего не нашлось</h3><p>Попробуйте другой запрос или уберите фильтры.</p></div>}
          {!f.q.trim() && <div className="empty"><div className="ic"><Icon name="search" size={26} /></div><h3>Начните вводить запрос</h3><p>Ищите по названиям, темам, направлениям и тегам.</p></div>}
        </div>
      </div>
      <FilterSheet open={filterOpen} onClose={() => setFilterOpen(false)} f={f} set={set} toggle={toggle} resultCount={results.length} />
    </div>
  );
}

Object.assign(window, { CategoryPage, SearchPage, ListToolbar, DestSubnav, sortArticles });
