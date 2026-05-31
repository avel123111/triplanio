/* global React, window, Icon */
const { useState: useStateF, useMemo: useMemoF, useEffect: useEffectF, useRef: useRefF } = React;

/* ── matching ── */
function matchArticle(a, f) {
  if (f.types.length && !f.types.includes(a.type)) return false;
  if (f.topics.length && !f.topics.some(t => a.topics.includes(t))) return false;
  if (f.tags.length && !f.tags.some(t => a.tags.includes(t))) return false;
  if (f.dest) {
    if (f.dest.continent && a.dest.continent !== f.dest.continent) return false;
    if (f.dest.country && a.dest.country !== f.dest.country) return false;
    if (f.dest.city && a.dest.city !== f.dest.city) return false;
  }
  if (f.q && f.q.trim()) {
    const q = f.q.toLowerCase();
    const hay = (a.title + " " + a.excerpt + " " + a.tags.join(" ") + " " + window.typeLabel(a.type) + " " + a.topics.map(window.topicLabel).join(" ")).toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

const emptyFilter = () => ({ q: "", types: [], topics: [], tags: [], dest: null });

function useArticleFilter(initial) {
  const [f, setF] = useStateF(() => ({ ...emptyFilter(), ...(initial || {}) }));
  const set = (patch) => setF(prev => ({ ...prev, ...(typeof patch === "function" ? patch(prev) : patch) }));
  const toggle = (dim, id) => set(prev => ({ [dim]: prev[dim].includes(id) ? prev[dim].filter(x => x !== id) : [...prev[dim], id] }));
  const results = useMemoF(() => window.TRIP.ARTICLES.filter(a => matchArticle(a, f)), [f]);
  const activeCount = f.types.length + f.topics.length + f.tags.length + (f.dest ? 1 : 0);
  return { f, set, toggle, results, activeCount, reset: () => set(emptyFilter()) };
}

/* ── active chips bar ── */
function ActiveChips({ f, set }) {
  const chips = [];
  f.types.forEach(id => chips.push({ k: "t" + id, label: window.typeLabel(id), rm: () => set(p => ({ types: p.types.filter(x => x !== id) })) }));
  f.topics.forEach(id => chips.push({ k: "o" + id, label: window.topicLabel(id), rm: () => set(p => ({ topics: p.topics.filter(x => x !== id) })) }));
  f.tags.forEach(id => chips.push({ k: "g" + id, label: "#" + id, rm: () => set(p => ({ tags: p.tags.filter(x => x !== id) })) }));
  if (f.dest) chips.push({ k: "d", label: window.TRIP.destPath(f.dest).join(" / "), rm: () => set({ dest: null }) });
  if (!chips.length) return null;
  return (
    <div className="activebar">
      {chips.map(c => (
        <button key={c.k} className="activechip" onClick={c.rm}>{c.label}<span className="x"><Icon name="close" size={11} /></span></button>
      ))}
    </div>
  );
}

/* ── nested destination selector ── */
function countFor(partial) {
  return window.TRIP.ARTICLES.filter(a => matchArticle(a, { ...emptyFilter(), dest: partial })).length;
}
function DestinationSelector({ dest, onChange }) {
  const D = window.TRIP.DESTINATIONS;
  const d = dest || {};
  const cont = D.find(c => c.id === d.continent);
  const country = cont && cont.countries.find(c => c.id === d.country);

  let level = "continent", options = D, mk = (o) => ({ continent: o.id });
  if (country) { level = "city"; options = country.cities; mk = (o) => ({ continent: cont.id, country: country.id, city: o.id }); }
  else if (cont) { level = "country"; options = cont.countries; mk = (o) => ({ continent: cont.id, country: o.id }); }

  return (
    <div className="destsel">
      <div className="destsel__bc">
        <Icon name="pin" size={14} style={{ color: "var(--brand)" }} />
        <button onClick={() => onChange(null)} style={{ color: d.continent ? "var(--brand)" : "var(--muted)" }}>Все места</button>
        {cont && (<><span style={{ color: "var(--muted-2)" }}>/</span><button onClick={() => onChange({ continent: cont.id })}>{cont.label}</button></>)}
        {country && (<><span style={{ color: "var(--muted-2)" }}>/</span><button onClick={() => onChange({ continent: cont.id, country: country.id })}>{country.label}</button></>)}
      </div>
      <div className="destsel__opts">
        {options.map(o => {
          const target = mk(o);
          const selected = level === "city" && d.city === o.id;
          const drillable = level !== "city";
          return (
            <button key={o.id} className={`destopt ${selected ? "sel" : ""}`} onClick={() => onChange(target)}>
              <span>{o.label}</span>
              <span className="count" style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted-2)", fontWeight: 600 }}>{countFor(target)}</span>
              {drillable && <Icon name="chevron" size={15} className="chev" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── full filter bottom sheet ── */
function FilterSheet({ open, onClose, f, set, toggle, resultCount }) {
  const [tagq, setTagq] = useStateF("");
  const tags = window.TRIP.TAGS.filter(t => t.includes(tagq.toLowerCase()));
  return (
    <>
      <div className={`overlay ${open ? "show" : ""}`} onClick={onClose} />
      <div className={`sheet ${open ? "show" : ""}`} style={{ maxHeight: "92%" }}>
        <div className="sheet__grip" />
        <div className="sheet__head">
          <Icon name="filter" size={18} style={{ color: "var(--brand)" }} />
          <h3>Фильтры</h3>
          <button className="iconbtn sm" style={{ marginLeft: "auto" }} onClick={onClose}><Icon name="close" size={16} /></button>
        </div>
        <div className="sheet__body">
          <div className="filtergroup">
            <div className="filtergroup__lbl">Тип материала</div>
            <div className="selectchips">
              {window.TRIP.CONTENT_TYPES.map(t => (
                <button key={t.id} className={`selectchip ${f.types.includes(t.id) ? "on" : ""}`} onClick={() => toggle("types", t.id)}>
                  {t.label}{f.types.includes(t.id) && <Icon name="close" size={12} className="x" />}
                </button>
              ))}
            </div>
          </div>
          <div className="filtergroup">
            <div className="filtergroup__lbl">Тема</div>
            <div className="selectchips">
              {window.TRIP.TOPICS.map(t => (
                <button key={t.id} className={`selectchip ${f.topics.includes(t.id) ? "on" : ""}`} onClick={() => toggle("topics", t.id)}>
                  {t.label}{f.topics.includes(t.id) && <Icon name="close" size={12} className="x" />}
                </button>
              ))}
            </div>
          </div>
          <div className="filtergroup">
            <div className="filtergroup__lbl">Направление <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500, color: "var(--muted)" }}>континент → страна → город</span></div>
            <DestinationSelector dest={f.dest} onChange={(d) => set({ dest: d })} />
          </div>
          <div className="filtergroup">
            <div className="filtergroup__lbl">Теги</div>
            <div className="tagsearch"><input placeholder="Поиск по тегам…" value={tagq} onChange={e => setTagq(e.target.value)} /></div>
            <div className="selectchips">
              {tags.map(t => (
                <button key={t} className={`selectchip ${f.tags.includes(t) ? "on" : ""}`} onClick={() => toggle("tags", t)}>
                  #{t}{f.tags.includes(t) && <Icon name="close" size={12} className="x" />}
                </button>
              ))}
              {!tags.length && <span className="muted" style={{ fontSize: 13 }}>Ничего не найдено</span>}
            </div>
          </div>
        </div>
        <div className="sheet__foot">
          <button className="clearall" onClick={() => set(emptyFilter())}>Сбросить всё</button>
          <button className="btn btn--primary" style={{ marginLeft: "auto" }} onClick={onClose}>
            Показать {resultCount}
          </button>
        </div>
      </div>
    </>
  );
}

/* ── one-tap live search sheet ── */
function SearchSheet({ open, onClose }) {
  const { go } = window.useApp();
  const [q, setQ] = useStateF("");
  const ref = useRefF(null);
  useEffectF(() => { if (open && ref.current) setTimeout(() => ref.current.focus(), 280); }, [open]);
  const results = useMemoF(() => {
    if (!q.trim()) return [];
    return window.TRIP.ARTICLES.filter(a => matchArticle(a, { ...emptyFilter(), q })).slice(0, 6);
  }, [q]);
  const suggestions = ["Лиссабон", "Япония", "пляж", "бюджет", "виза"];
  return (
    <>
      <div className={`overlay ${open ? "show" : ""}`} onClick={onClose} />
      <div className={`sheet ${open ? "show" : ""}`} style={{ maxHeight: "82%" }}>
        <div className="sheet__grip" />
        <div className="sheet__head">
          <div className="searchfield">
            <Icon name="search" size={18} style={{ color: "var(--muted)" }} />
            <input ref={ref} placeholder="Куда едем? Тема, место, тег…" value={q} onChange={e => setQ(e.target.value)} />
            {q && <button className="iconbtn sm" style={{ width: 26, height: 26, border: 0, background: "var(--surface-2)" }} onClick={() => setQ("")}><Icon name="close" size={13} /></button>}
          </div>
          <button className="clearall" onClick={onClose} style={{ background: "none", border: 0 }}>Отмена</button>
        </div>
        <div className="sheet__body" style={{ minHeight: 200 }}>
          {!q.trim() && (
            <div style={{ paddingTop: 8 }}>
              <div className="filtergroup__lbl" style={{ marginBottom: 12 }}>Популярное</div>
              <div className="selectchips">
                {suggestions.map(s => <button key={s} className="selectchip" onClick={() => setQ(s)}>{s}</button>)}
              </div>
            </div>
          )}
          {q.trim() && results.length > 0 && (
            <div style={{ display: "grid", gap: 10, paddingTop: 6 }}>
              <div className="resultcount" style={{ marginBottom: 2 }}><b>{results.length}</b> результатов</div>
              {results.map(a => <window.ArticleCard key={a.slug} a={a} variant="row" />)}
              <button className="btn btn--ghost btn--block" onClick={() => { go("search", { q }); onClose(); }} style={{ marginTop: 4 }}>
                Все результаты по «{q}»
              </button>
            </div>
          )}
          {q.trim() && !results.length && (
            <div className="empty"><div className="ic"><Icon name="search" size={24} /></div><h3>Ничего не нашлось</h3><p>Попробуйте другой запрос или уберите фильтры.</p></div>
          )}
        </div>
      </div>
    </>
  );
}

Object.assign(window, { matchArticle, emptyFilter, useArticleFilter, ActiveChips, DestinationSelector, FilterSheet, SearchSheet, countFor });
