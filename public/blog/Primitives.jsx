/* global React, window */
const { useState, useEffect, useRef, useMemo, useCallback, createContext, useContext } = React;
const T = window.TRIP;

/* ── App context: nav, theme, viewport, bookmarks, toast ── */
const AppCtx = createContext(null);
const useApp = () => useContext(AppCtx);

/* ── helpers ── */
const RU_MONTHS = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
function fmtDate(iso) {
  const d = new Date(iso);
  return `${d.getDate()} ${RU_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
const typeLabel = (id) => (T.CONTENT_TYPES.find(t => t.id === id) || {}).label || id;
const topicLabel = (id) => (T.TOPICS.find(t => t.id === id) || {}).label || id;
function readWord(n) {
  const m = n % 10, d = n % 100;
  if (m === 1 && d !== 11) return "минута";
  if (m >= 2 && m <= 4 && (d < 10 || d >= 20)) return "минуты";
  return "минут";
}

/* ── Image with graceful gradient fallback + shimmer ── */
function Img({ src, grad, alt = "", className = "", style }) {
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState(false);
  return (
    <div className={`imgwrap ${loaded || err ? "" : "loading"} ${className}`}
      style={{ background: grad || "var(--surface-2)", ...style }}>
      {!err && (
        <img src={src} alt={alt} className="imgph"
          style={{ opacity: loaded ? 1 : 0, transition: "opacity .4s ease", position: "absolute", inset: 0 }}
          onLoad={() => setLoaded(true)} onError={() => setErr(true)} loading="lazy" />
      )}
    </div>
  );
}

/* ── small bits ── */
function TypeBadge({ type, ghost }) {
  return <span className={`type-badge ${ghost ? "type-badge--ghost" : ""}`} data-t={type}>{typeLabel(type)}</span>;
}

function DestCrumb({ dest, light, onNav }) {
  const parts = T.destPath(dest);
  const ids = [dest.continent, dest.country, dest.city].filter(Boolean);
  return (
    <span className={`crumb ${onNav ? "crumb--link" : ""}`}>
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="sep">/</span>}
          <span onClick={onNav ? (e) => { e.stopPropagation(); onNav(ids.slice(0, i + 1)); } : undefined}
            style={i === parts.length - 1 ? { fontWeight: 600 } : null}>{p}</span>
        </React.Fragment>
      ))}
    </span>
  );
}

function SaveButton({ slug, small }) {
  const { bookmarks, toggleBookmark } = useApp();
  const saved = bookmarks.includes(slug);
  return (
    <button className={`iconbtn ${small ? "sm" : ""}`} title={saved ? "В закладках" : "Сохранить"}
      onClick={(e) => { e.stopPropagation(); toggleBookmark(slug); }}
      style={saved ? { color: "var(--brand)", borderColor: "var(--brand)", background: "var(--brand-soft)" } : (small ? { background: "rgba(255,255,255,.9)", borderColor: "transparent", color: "#0f172a", backdropFilter: "blur(6px)" } : null)}>
      <Icon name="bookmark" size={small ? 16 : 18} fill={saved ? "currentColor" : "none"} />
    </button>
  );
}

/* ── Article card ── */
function ArticleCard({ a, variant = "default", onNav }) {
  const { go } = useApp();
  const open = () => go("article", { slug: a.slug });
  if (variant === "row") {
    return (
      <div className="acard acard--row" role="button" tabIndex={0} onClick={open}>
        <div className="acard__media"><Img src={a.cover} grad={a.grad} alt={a.title} /></div>
        <div className="acard__body">
          <div className="flexrow" style={{ gap: 8 }}><TypeBadge type={a.type} />
            <span className="metarow"><Icon name="clock" size={13} />{a.read} мин</span></div>
          <div className="acard__title">{a.title}</div>
          <DestCrumb dest={a.dest} onNav={onNav} />
        </div>
      </div>
    );
  }
  const feature = variant === "feature";
  return (
    <div className={`acard ${feature ? "acard--feature feature-hero" : ""}`} role="button" tabIndex={0} onClick={open}>
      <div className="acard__media">
        <Img src={a.cover} grad={a.grad} alt={a.title} />
        <div className="badge-pos"><TypeBadge type={a.type} ghost /></div>
        <div className="save-pos"><SaveButton slug={a.slug} small /></div>
      </div>
      <div className="acard__body">
        <DestCrumb dest={a.dest} onNav={onNav} />
        <div className="acard__title">{a.title}</div>
        <div className="acard__excerpt">{a.excerpt}</div>
        <div className="acard__topics">
          {a.topics.slice(0, feature ? 3 : 2).map(t => <span key={t} className="topictag"
            onClick={(e) => { e.stopPropagation(); onNav && onNav(["topic", t]); }}>{topicLabel(t)}</span>)}
        </div>
        <div className="acard__foot">
          <span className="metarow"><Icon name="clock" size={13} />{a.read} {readWord(a.read)}</span>
          <span className="metarow"><span className="dot" />{fmtDate(a.date)}</span>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { AppCtx, useApp, Img, TypeBadge, DestCrumb, SaveButton, ArticleCard, fmtDate, typeLabel, topicLabel, readWord });
