/* global React, ReactDOM, window, Icon, TriplanioMark */
const { useState: useStateApp, useEffect: useEffectApp, useRef: useRefApp, useCallback: useCb } = React;

function App() {
  const [route, setRoute] = useStateApp({ name: "home", params: {} });
  const [theme, setTheme] = useStateApp(() => {
    try { return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; } catch { return "light"; }
  });
  const [viewport, setViewport] = useStateApp(() => (typeof window !== "undefined" && window.innerWidth >= 900) ? "desktop" : "mobile");
  const [bookmarks, setBookmarks] = useStateApp(() => { try { return JSON.parse(localStorage.getItem("trip_bm") || "[]"); } catch { return []; } });
  const [searchOpen, setSearchOpen] = useStateApp(false);
  const [lightbox, setLightbox] = useStateApp(null); // {imgs, i}
  const [toast, setToast] = useStateApp(null);

  const scrollerRef = useRefApp(null);
  const progressRef = useRefApp(null);
  const totopRef = useRefApp(null);
  const subs = useRefApp(new Set());
  const toastTimer = useRefApp(null);

  // apply theme on root
  useEffectApp(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.classList.add("theming");
    const t = setTimeout(() => document.documentElement.classList.remove("theming"), 320);
    return () => clearTimeout(t);
  }, [theme]);

  // responsive viewport — real window width drives layout (no toggle)
  useEffectApp(() => {
    const apply = () => {
      const wide = window.innerWidth >= 900;
      setViewport(wide ? "desktop" : "mobile");
      document.documentElement.classList.toggle("is-wide", wide);
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);

  const go = useCb((name, params = {}) => {
    setRoute({ name, params });
    requestAnimationFrame(() => { if (scrollerRef.current) scrollerRef.current.scrollTop = 0; });
  }, []);

  const toggleBookmark = useCb((slug) => setBookmarks(prev => {
    const n = prev.includes(slug) ? prev.filter(x => x !== slug) : [...prev, slug];
    localStorage.setItem("trip_bm", JSON.stringify(n)); return n;
  }), []);

  const showToast = useCb((msg) => {
    setToast(msg); clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  const subscribeScroll = useCb((cb) => { subs.current.add(cb); return () => subs.current.delete(cb); }, []);
  const openLightbox = useCb((imgs, i) => setLightbox({ imgs, i }), []);
  const openSearch = useCb(() => setSearchOpen(true), []);

  // scroll handling
  useEffectApp(() => {
    const el = scrollerRef.current; if (!el) return;
    let raf = null;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const top = el.scrollTop, max = Math.max(1, el.scrollHeight - el.clientHeight);
        if (progressRef.current) progressRef.current.style.width = Math.min(100, (top / max) * 100) + "%";
        if (totopRef.current) totopRef.current.classList.toggle("show", top > 600);
        subs.current.forEach(cb => cb(top, max));
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [route.name, viewport]);

  // ⌘K
  useEffectApp(() => {
    const onKey = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setSearchOpen(true); } if (e.key === "Escape") { setSearchOpen(false); setLightbox(null); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ctx = { route, go, theme, setTheme, viewport, bookmarks, toggleBookmark, showToast, scrollerRef, subscribeScroll, openLightbox, openSearch };

  let screen = null;
  if (route.name === "home") screen = <window.Home />;
  else if (route.name === "article") screen = <window.ArticlePage />;
  else if (route.name === "category") screen = <window.CategoryPage params={route.params} />;
  else if (route.name === "search") screen = <window.SearchPage params={route.params} />;

  const isArticle = route.name === "article";

  return (
    <window.AppCtx.Provider value={ctx}>
      <div className="app-shell">
        {/* appbar */}
        <header className="appbar">
          <div className="brand" onClick={() => go("home")}>
            <img src="assets/logo-mark.svg" alt="Triplanio" />
            <span className="wm">Triplanio <span className="blog">Блог</span></span>
          </div>
          <nav className="deskmenu">
            <a onClick={() => go("category", { init: { types: ["guide"] } })}>Гайды</a>
            <a onClick={() => go("category", { init: { dest: { continent: "europe" } } })}>Направления</a>
            <a onClick={() => go("category", { init: { topics: ["nomad"] } })}>Digital Nomad</a>
            <a onClick={() => go("category", { init: { types: ["deal"] } })}>Дилы</a>
          </nav>
          <div className="spacer" />
          <button className="iconbtn" onClick={openSearch} title="Поиск"><Icon name="search" size={18} /></button>
          <button className="iconbtn" onClick={() => setTheme(theme === "light" ? "dark" : "light")} title="Сменить тему">
            <Icon name={theme === "light" ? "moon" : "sun"} size={18} />
          </button>
          {viewport === "desktop" && <button className="btn btn--primary" style={{ marginLeft: 4 }} onClick={() => showToast("Открываем приложение Triplanio…")}>Открыть приложение</button>}
        </header>

        {/* progress bar (article) */}
        {isArticle && <div style={{ height: 3, flex: "none", background: "var(--line-2)" }}><div ref={progressRef} style={{ height: "100%", width: "0%", background: "linear-gradient(90deg,var(--brand),var(--brand-600))", transition: "width .08s linear" }} /></div>}

        <div className="scroller" ref={scrollerRef}>{screen}</div>

        {/* back to top */}
        {isArticle && <button ref={totopRef} className="totop" onClick={() => scrollerRef.current && scrollerRef.current.scrollTo({ top: 0, behavior: "smooth" })}><Icon name="arrowUp" size={18} /></button>}

        {/* global overlays */}
        <window.SearchSheet open={searchOpen} onClose={() => setSearchOpen(false)} />
        {lightbox && <Lightbox data={lightbox} onClose={() => setLightbox(null)} setData={setLightbox} />}
        <div className={`toast ${toast ? "show" : ""}`}><Icon name="check" size={15} />{toast}</div>
      </div>
    </window.AppCtx.Provider>
  );
}

function Lightbox({ data, onClose, setData }) {
  const { imgs, i } = data;
  const g = imgs[i];
  const nav = (d) => setData(p => ({ ...p, i: (p.i + d + imgs.length) % imgs.length }));
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "ArrowRight") nav(1); if (e.key === "ArrowLeft") nav(-1); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  });
  return (
    <div className="lightbox show">
      <div className="lightbox__top">
        <span style={{ fontSize: 13.5, opacity: .8 }}>{i + 1} / {imgs.length}</span>
        <button className="iconbtn sm" style={{ background: "rgba(255,255,255,.12)", border: 0, color: "#fff" }} onClick={onClose}><Icon name="close" size={16} /></button>
      </div>
      <div className="lightbox__stage">
        <button className="lightbox__nav prev" onClick={() => nav(-1)}><Icon name="arrowLeft" size={20} /></button>
        <window.Img src={g.src} grad={g.grad} style={{ width: "100%", height: "100%", maxHeight: "70vh", borderRadius: 12 }} />
        <button className="lightbox__nav next" onClick={() => nav(1)}><Icon name="arrowRight" size={20} /></button>
      </div>
      <div className="lightbox__cap">{g.cap}</div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
