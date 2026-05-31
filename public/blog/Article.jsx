/* global React, window, Icon */
const { useState: useStateA, useEffect: useEffectA, useRef: useRefA } = React;

function renderBlock(b, i) {
  const C = window.ARTICLE_BLOCKS;
  switch (b.type) {
    case "lede": return <C.Lede key={i} text={b.text} />;
    case "text": return <C.TextBlock key={i} html={b.html} />;
    case "heading": return <C.Heading key={i} id={b.id} text={b.text} />;
    case "quote": return <C.Quote key={i} text={b.text} cite={b.cite} />;
    case "photoText": return <C.PhotoText key={i} {...b} />;
    case "fullPhoto": return <C.FullPhoto key={i} {...b} />;
    case "gallery": return <C.Gallery key={i} />;
    case "map": return <C.MapBlock key={i} />;
    case "listCards": return <C.ListCards key={i} />;
    case "bestTime": return <C.BestTime key={i} />;
    case "visaTable": return <C.VisaTable key={i} />;
    case "compareTable": return <C.CompareTable key={i} />;
    case "checklist": return <C.Checklist key={i} />;
    case "bookingMon": return <C.BookingWidget key={i} />;
    case "flightsMon": return <C.FlightsWidget key={i} />;
    case "activitiesMon": return <C.ActivitiesWidget key={i} />;
    case "relatedInline": return <RelatedInline key={i} inline />;
    default: return null;
  }
}

/* related articles (also reused at the end) */
function RelatedInline({ inline }) {
  const { go, viewport } = window.useApp();
  const cur = "48-hours-lisbon";
  const rel = window.TRIP.ARTICLES.filter(a => a.slug !== cur && (a.dest.country === "portugal" || a.topics.includes("culture") || a.topics.includes("food"))).slice(0, viewport === "desktop" ? 3 : 3);
  return (
    <section className="related blockgap">
      <div className="sectionhead"><h2 style={{ fontSize: 21 }}>{inline ? "Читайте также" : "Похожие статьи"}</h2></div>
      {viewport === "desktop"
        ? <div className="cardgrid">{rel.map(a => <window.ArticleCard key={a.slug} a={a} />)}</div>
        : <div style={{ display: "grid", gap: 12 }}>{rel.map(a => <window.ArticleCard key={a.slug} a={a} variant="row" />)}</div>}
    </section>
  );
}

/* sticky desktop TOC + mobile collapsible */
function Toc({ items, active, onJump, variant }) {
  const [open, setOpen] = useStateA(false);
  if (variant === "mobile") {
    return (
      <div className={`toc-mobile ${open ? "open" : ""}`}>
        <button className="toc-mobile__head" onClick={() => setOpen(o => !o)}>
          <Icon name="list" size={17} style={{ color: "var(--brand)" }} /><span className="t">Содержание</span>
          <span className="muted" style={{ fontSize: 12.5 }}>{items.length}</span><Icon name="chevronDown" size={16} className="ch" />
        </button>
        <div className="toc-mobile__body"><ol>{items.map(it => (
          <li key={it.id}><a className={active === it.id ? "active" : ""} onClick={() => { onJump(it.id); setOpen(false); }}>{it.text}</a></li>
        ))}</ol></div>
      </div>
    );
  }
  return (
    <nav className="toc-desktop">
      <div className="eyebrow eyebrow--plain" style={{ color: "var(--muted-2)" }}>Содержание</div>
      <div className="toc-list">{items.map(it => (
        <a key={it.id} className={active === it.id ? "active" : ""} onClick={() => onJump(it.id)}>{it.text}</a>
      ))}</div>
    </nav>
  );
}

function ArticlePage() {
  const { go, viewport, scrollerRef, subscribeScroll, bookmarks, toggleBookmark, showToast } = window.useApp();
  const a = window.TRIP.ARTICLES.find(x => x.slug === "48-hours-lisbon");
  const blocks = window.TRIP.DEMO_BLOCKS;
  const tocItems = blocks.filter(b => b.type === "heading").map(b => ({ id: b.id, text: b.text }));
  const [active, setActive] = useStateA(tocItems[0] && tocItems[0].id);
  const [shareOpen, setShareOpen] = useStateA(false);
  const [hl, setHl] = useStateA(null);
  const proseRef = useRefA(null);
  const saved = bookmarks.includes(a.slug);

  // TOC active tracking via scroll subscription
  useEffectA(() => subscribeScroll((top) => {
    const sc = scrollerRef.current; if (!sc) return;
    let current = tocItems[0] && tocItems[0].id;
    tocItems.forEach(it => {
      const el = sc.querySelector(`[data-toc="${it.id}"]`);
      if (el && el.offsetTop - 90 <= top) current = it.id;
    });
    setActive(current);
  }), []);

  const jump = (id) => {
    const sc = scrollerRef.current; const el = sc && sc.querySelector(`[data-toc="${id}"]`);
    if (el) sc.scrollTo({ top: el.offsetTop - 70, behavior: "smooth" });
  };

  // highlight-to-share
  useEffectA(() => {
    const sc = scrollerRef.current; const pr = proseRef.current; if (!sc || !pr) return;
    const onUp = () => {
      const sel = window.getSelection();
      if (sel && sel.toString().trim().length > 8 && pr.contains(sel.anchorNode)) {
        try {
          const rect = sel.getRangeAt(0).getBoundingClientRect();
          const host = sc.getBoundingClientRect();
          setHl({ x: rect.left - host.left + rect.width / 2, y: rect.top - host.top + sc.scrollTop - 6, text: sel.toString() });
        } catch { setHl(null); }
      } else setHl(null);
    };
    pr.addEventListener("mouseup", onUp);
    return () => pr.removeEventListener("mouseup", onUp);
  }, []);

  const copyLink = () => { try { navigator.clipboard && navigator.clipboard.writeText("https://triplanio.com/blog/" + a.slug); } catch {} showToast("Ссылка скопирована"); setShareOpen(false); };

  return (
    <div className="fade-route article">
      <header className="art-hero">
        <div className="art-hero__media"><window.Img src={a.cover} grad={a.grad} /></div>
        <div className="art-hero__cap">
          <span className="crumb crumb--link">
            <span onClick={() => go("home")}>Блог</span><span className="sep">/</span>
            {window.TRIP.destPath(a.dest).map((p, i, arr) => <React.Fragment key={i}><span onClick={() => go("category", { init: { dest: i === 0 ? { continent: a.dest.continent } : i === 1 ? { continent: a.dest.continent, country: a.dest.country } : a.dest } })}>{p}</span>{i < arr.length - 1 && <span className="sep">/</span>}</React.Fragment>)}
          </span>
          <div style={{ marginBottom: 12 }}><window.TypeBadge type={a.type} ghost /></div>
          <h1>{a.title}</h1>
        </div>
      </header>

      <div className="art-body">
        <div className="art-shell">
          {viewport === "desktop" && <Toc items={tocItems} active={active} onJump={jump} />}
          <div>
            <div className="prose">
              {/* meta */}
              <div className="art-meta">
                <div className="art-meta__author">
                  <span className="art-meta__avatar">{a.author.name[0]}</span>
                  <div><div className="art-meta__name">{a.author.name}</div><div className="art-meta__role">{a.author.role}</div></div>
                </div>
                <div className="art-actions" style={{ position: "relative" }}>
                  <button className="iconbtn sm" onClick={() => { setShareOpen(o => !o); }} title="Поделиться"><Icon name="share" size={16} /></button>
                  <button className="iconbtn sm" onClick={() => { toggleBookmark(a.slug); showToast(saved ? "Убрано из закладок" : "Сохранено в Triplanio"); }} title="Сохранить"
                    style={saved ? { color: "var(--brand)", borderColor: "var(--brand)", background: "var(--brand-soft)" } : null}>
                    <Icon name="bookmark" size={16} fill={saved ? "currentColor" : "none"} />
                  </button>
                  {shareOpen && (
                    <div className="sharepop" style={{ top: "calc(100% + 8px)", right: 0 }}>
                      <button title="Telegram" onClick={() => { showToast("Открываем Telegram…"); setShareOpen(false); }}><Icon name="telegram" size={18} /></button>
                      <button title="WhatsApp" onClick={() => { showToast("Открываем WhatsApp…"); setShareOpen(false); }}><Icon name="whatsapp" size={18} /></button>
                      <button title="Копировать ссылку" onClick={copyLink}><Icon name="link" size={18} /></button>
                    </div>
                  )}
                </div>
              </div>
              <div className="metarow" style={{ gap: 10, padding: "12px 0 2px", flexWrap: "wrap" }}>
                <span className="metarow"><Icon name="clock" size={14} />{a.read} {window.readWord(a.read)} чтения</span>
                <span className="dot" /><span>{window.fmtDate(a.date)}</span>
                {a.updated && <><span className="dot" /><span className="muted">обновлено {window.fmtDate(a.updated)}</span></>}
              </div>

              {/* mobile TOC */}
              {viewport !== "desktop" && <Toc items={tocItems} active={active} onJump={jump} variant="mobile" />}

              {/* blocks */}
              <div ref={proseRef} style={{ marginTop: 10 }}>
                {blocks.map((b, i) => renderBlock(b, i))}
              </div>

              {/* tags */}
              <div className="flexrow" style={{ flexWrap: "wrap", gap: 8, margin: "28px 0 8px" }}>
                {a.tags.map(t => <button key={t} className="tagchip" onClick={() => go("category", { init: { tags: [t] } })}>#{t}</button>)}
              </div>

              {/* CTA */}
              <section className="cta-trip">
                <span className="eyebrow">Спланируйте поездку</span>
                <h3>Понравился маршрут? Соберите свою поездку в Triplanio.</h3>
                <p>Перенесите отели, рейсы и места из статьи в единый план — с таймлайном, бюджетом в любой валюте и AI-помощником в Telegram.</p>
                <button className="btn btn--white" onClick={() => showToast("Открываем приложение Triplanio…")}>Начать планировать<Icon name="arrowRight" size={16} /></button>
                <div className="cta-mini"><span className="cta-mini__app"><Icon name="sparkles" size={15} />AI соберёт черновик за минуту</span></div>
              </section>

              <RelatedInline />
            </div>
          </div>
        </div>
      </div>
      <AppFooter />

      {/* highlight-to-share bubble */}
      {hl && (
        <div className="hlbubble" style={{ left: hl.x, top: hl.y }}>
          <button onClick={() => { showToast("Цитата готова к публикации"); setHl(null); window.getSelection().removeAllRanges(); }}><Icon name="share" size={14} />Поделиться</button>
          <button onClick={() => { try { navigator.clipboard && navigator.clipboard.writeText(hl.text); } catch {} showToast("Скопировано"); setHl(null); window.getSelection().removeAllRanges(); }}><Icon name="link" size={14} />Копировать</button>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { ArticlePage, RelatedInline });
