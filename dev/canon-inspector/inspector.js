// TRIP-165 · Canon inspector — overlay, selection panel, change-list tray.
//
// Preview-only, dev-only. Enter inspect mode → click any text → the panel shows
// its REAL current canon ("Сейчас"). Picking a canon or toggling a modifier is
// a live PREVIEW only (ephemeral inline style); nothing is queued until you
// press "Сохранить". Saved decisions accumulate in a tray, persist to
// localStorage, and "Копировать список" hands them to a PR. Nothing is ever
// written to source or shipped to production.
//
// Scope switch: preview/save either the clicked element ("Этот") or every
// element that looks like it ("Все похожие", by shared class) — e.g. all the
// sidebar menu items at once, not a single word.

import { CANONS, KNOBS, STATES, COLORS, probeCanons, detectCanon, comboApply, probeColors, detectColor, colorByKey } from './canons.js';
import { describe, groupSelector } from './describe.js';

const LS_KEY = 'ci:canon-changes';
const ROOT_CLASS = 'ci-root';

let probed = null;             // { canons, combos } — lazy probe of app.css
let probedColors = null;       // Map<colourKey, rgb> — lazy probe of colour tokens
let active = false;            // inspect mode on/off
let selected = null;           // currently selected (primary) element
let changes = [];              // [{key, from, to, descriptor, scope, selector, count}]
let seq = 0;                   // uid counter for change keys

const baseCanon = new WeakMap();   // element → {id,mods}|null  (real canon, cached before any preview)
const pendingCanon = new WeakMap();// element → {id,mods}|null  (current preview choice)
const scopeMode = new WeakMap();   // element → 'el' | 'group'
const queuedFor = new WeakMap();   // element → change.key (in-session dedup)
const originalCss = new WeakMap(); // element → prior inline cssText (for reset)
const previewStates = new WeakMap();// element → {keys:Set, track:int} — preview-only states (caps/track/mono/mute)
const baseColor = new WeakMap();   // element → colour key|null (real colour, cached before preview)
const pendingColor = new WeakMap();// element → colour key|null (current preview/queued colour choice)

let els = {};                  // cached DOM refs (launcher, hi, panel, tray…)
let panelMoved = false;        // user dragged the panel → stop auto-repositioning
let dragging = false;          // a panel/tray drag is in progress (suppress hover/select)
const offCanon = new Set();    // elements currently flagged off-canon (red highlight)

// ── canon/modifier helpers ─────────────────────────────────────────────────
const psFor = (el) => previewStates.get(el) || { keys: new Set(), track: 0 };
const sameSet = (a, b) => a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');
const sameCanon = (a, b) => (!a && !b) || (!!a && !!b && a.id === b.id && sameSet(a.mods, b.mods));
function canonLabel(info) {
  if (!info) return 'off-canon';
  const c = CANONS[info.id - 1];
  const mods = info.mods.length ? ' + ' + info.mods.join(' + ') : '';
  const mk = c.mockup && c.mockup !== '—' ? ` (макет: ${c.mockup})` : '';
  return `${info.id} · ${c.name}${mk}${mods}`;
}

// ── persistence ──────────────────────────────────────────────────────────
function normInfo(v) {
  if (v == null) return null;
  if (typeof v === 'number') return { id: v, mods: [] };   // legacy shape
  return { id: v.id, mods: v.mods || [] };
}
function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    changes = JSON.parse(raw).map((c) => ({ ...c, from: normInfo(c.from), to: normInfo(c.to) }));
    seq = changes.reduce((m, c) => Math.max(m, c.key), 0);
  } catch { /* corrupt / unavailable — start empty */ }
}
function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(changes)); } catch { /* quota / private mode */ }
}

// ── styles (self-contained; not tied to app tokens) ───────────────────────
function injectStyles() {
  const s = document.createElement('style');
  s.textContent = `
  .${ROOT_CLASS}, .${ROOT_CLASS} * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, sans-serif; }
  .ci-launch { position: fixed; left: 16px; bottom: 16px; z-index: 2147483000; width: 44px; height: 44px; padding: 0;
    display: flex; align-items: center; justify-content: center; border-radius: 50%; border: 1px solid #334155;
    background: #0f172a; cursor: pointer; box-shadow: 0 6px 20px rgba(0,0,0,.35); }
  .ci-launch:hover { background: #1e293b; }
  .ci-launch.is-on { background: #2563eb; border-color: #2563eb; }
  .ci-launch .ci-dot { width: 12px; height: 12px; border-radius: 50%; background: #64748b; }
  .ci-launch.is-on .ci-dot { background: #fff; }
  .ci-hi { position: fixed; z-index: 2147482000; pointer-events: none; border: 2px solid #2563eb;
    background: rgba(37,99,235,.10); border-radius: 4px; transition: all .04s linear; display: none; }
  /* panel = header / scrollable body / footer (structured) */
  .ci-panel { position: fixed; z-index: 2147483000; width: 336px; max-height: 84vh; display: none; flex-direction: column;
    background: #0f172a; color: #e2e8f0; border: 1px solid #33415588; border-radius: 16px;
    box-shadow: 0 24px 64px rgba(0,0,0,.6); overflow: hidden; }
  .ci-head { flex: none; padding: 12px 14px; border-bottom: 1px solid #1e293b; cursor: move;
    background: linear-gradient(180deg,#16203a,#0f172a); }
  .ci-head__bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .ci-head__title { font-size: 10.5px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: #93c5fd; }
  .ci-head__x { width: 22px; height: 22px; flex: none; border: 0; border-radius: 7px; background: #1e293b; color: #94a3b8; cursor: pointer; font-size: 12px; line-height: 1; }
  .ci-head__x:hover { background: #334155; color: #fff; }
  .ci-status { display: flex; align-items: center; gap: 8px; margin-top: 10px; font-size: 12px; color: #94a3b8; }
  .ci-status__dot { width: 8px; height: 8px; flex: none; border-radius: 50%; background: #22c55e; box-shadow: 0 0 0 3px #22c55e22; }
  .ci-status__dot--off { background: #ef4444; box-shadow: 0 0 0 3px #ef444422; }
  .ci-status b { color: #e2e8f0; font-size: 13px; }
  .ci-panel__off { color: #fca5a5; }
  .ci-status__prev { margin-top: 4px; padding-left: 16px; font-size: 12px; color: #94a3b8; }
  .ci-status__prev b { color: #60a5fa; }
  .ci-samp { margin-top: 9px; padding: 7px 10px; border-radius: 9px; background: #0b1220; border: 1px solid #1e293b;
    font-size: 12px; color: #cbd5e1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .ci-body { flex: 1; overflow: auto; }
  .ci-sec { padding: 11px 14px; border-bottom: 1px solid #172033; }
  .ci-sec__h { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 9px;
    font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: #6b7a94; }
  .ci-sec__h span { font-weight: 600; letter-spacing: 0; text-transform: none; color: #475569; font-family: ui-monospace, monospace; }
  .ci-hint { font-size: 11px; color: #64748b; font-style: italic; }
  .ci-wrap { display: flex; flex-wrap: wrap; gap: 6px; }

  .ci-scope { display: flex; gap: 6px; }
  .ci-scope button { flex: 1; padding: 7px 8px; border-radius: 8px; border: 1px solid #334155; background: #1e293b;
    color: #94a3b8; font-size: 11px; font-weight: 600; cursor: pointer; }
  .ci-scope button.is-on { background: #172554; border-color: #2563eb; color: #e2e8f0; }

  .ci-chip { padding: 5px 10px; border-radius: 999px; border: 1px solid #334155; background: #1e293b;
    color: #94a3b8; font-size: 11px; font-weight: 600; cursor: pointer; }
  .ci-chip:hover { border-color: #475569; }
  .ci-chip.is-on { background: #2563eb; border-color: #2563eb; color: #fff; }
  .ci-chip[disabled] { opacity: .4; cursor: not-allowed; }

  .ci-sw { display: inline-flex; align-items: center; gap: 6px; padding: 4px 9px 4px 5px; border-radius: 999px;
    border: 1px solid #334155; background: #1e293b; color: #94a3b8; font-size: 11px; font-weight: 600; cursor: pointer; }
  .ci-sw:hover { border-color: #475569; }
  .ci-sw i { width: 13px; height: 13px; border-radius: 50%; border: 1px solid rgba(255,255,255,.25); flex: none; display: block; }
  .ci-sw.is-on { border-color: #2563eb; color: #fff; background: #172554; }

  .ci-canons { display: flex; flex-direction: column; gap: 5px; }
  .ci-canon { display: block; width: 100%; text-align: left; border: 1px solid transparent; border-radius: 10px;
    background: #0d1626; color: inherit; padding: 8px 11px; cursor: pointer; transition: background .1s, border-color .1s; }
  .ci-canon:hover { background: #16203a; }
  .ci-canon.is-cur { background: #172554; border-color: #2563eb; }
  .ci-canon__t { font-size: 13px; font-weight: 600; }
  .ci-canon__t i { color: #34d399; font-style: normal; font-size: 11px; font-weight: 700; }
  .ci-canon__mk { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 6px;
    background: #0f172a; color: #93c5fd; font-size: 10px; font-weight: 700;
    font-family: ui-monospace, monospace; vertical-align: middle; }
  .ci-canon__spec { font-size: 11px; color: #94a3b8; margin-top: 2px; font-family: ui-monospace, monospace; }
  .ci-canon__role { font-size: 11px; color: #64748b; margin-top: 1px; }
  .ci-knobs { display: flex; flex-direction: column; gap: 4px; }
  .ci-knob { display: flex; align-items: baseline; gap: 8px; font-size: 11px; }
  .ci-knob code { font-family: ui-monospace, monospace; color: #93c5fd; }
  .ci-knob b { font-family: ui-monospace, monospace; color: #e2e8f0; }
  .ci-knob span { color: #64748b; }

  .ci-foot { flex: none; display: flex; gap: 8px; padding: 10px 14px; background: #0f172a; border-top: 1px solid #1e293b; }
  .ci-btn { flex: 1; padding: 9px; border-radius: 9px; border: 1px solid #334155; background: #1e293b; color: #e2e8f0; font-size: 12px; font-weight: 600; cursor: pointer; }
  .ci-btn:hover { background: #334155; }
  .ci-btn--save { flex: 2; background: #2563eb; border-color: #2563eb; color: #fff; }
  .ci-btn--save:hover { background: #1d4ed8; }
  .ci-btn[disabled] { opacity: .4; cursor: not-allowed; }
  .ci-tray { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; width: 320px; max-height: 60vh; overflow: auto;
    background: #0f172a; color: #e2e8f0; border: 1px solid #334155; border-radius: 14px; box-shadow: 0 16px 48px rgba(0,0,0,.5); display: none; }
  .ci-tray__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 11px 14px; border-bottom: 1px solid #1e293b; position: sticky; top: 0; background: #0f172a; }
  .ci-tray__title { font-size: 13px; font-weight: 700; }
  .ci-tray__acts { display: flex; gap: 6px; }
  .ci-mini { padding: 5px 9px; border-radius: 8px; border: 1px solid #334155; background: #1e293b; color: #e2e8f0; font-size: 11px; font-weight: 600; cursor: pointer; }
  .ci-mini:hover { background: #334155; }
  .ci-row { padding: 9px 14px; border-bottom: 1px solid #1e293b; font-size: 12px; }
  .ci-row__map { color: #e2e8f0; font-weight: 600; }
  .ci-row__map i { color: #60a5fa; font-style: normal; }
  .ci-row__scope { color: #fbbf24; font-size: 11px; margin-top: 2px; }
  .ci-row__path { color: #64748b; font-size: 11px; margin-top: 2px; word-break: break-all; font-family: ui-monospace, monospace; }
  .ci-row__x { float: right; color: #64748b; cursor: pointer; padding-left: 8px; }
  .ci-row__x:hover { color: #fca5a5; }
  .ci-empty { padding: 16px 14px; color: #64748b; font-size: 12px; }
  .ci-tray__head { cursor: move; }
  .ci-offcanon-hi { outline: 2px solid #ef4444 !important; outline-offset: 1px;
    background: rgba(239,68,68,.10) !important; }
  `;
  document.head.appendChild(s);
}

// ── overlay + tray scaffolding ─────────────────────────────────────────────
function h(cls, tag = 'div') { const e = document.createElement(tag); e.className = cls; return e; }

function build() {
  const root = h(ROOT_CLASS);

  els.launcher = h('ci-launch', 'button');
  els.launcher.title = 'Каноны — инспектор типографики';
  els.launcher.innerHTML = `<span class="ci-dot"></span>`;
  els.launcher.onclick = () => (active ? disable() : enable());

  els.hi = h('ci-hi');
  els.panel = h('ci-panel');
  els.tray = h('ci-tray');

  root.append(els.launcher, els.hi, els.panel, els.tray);
  document.body.appendChild(root);
  renderTray();
}

// ── inspect mode ───────────────────────────────────────────────────────────
function enable() {
  if (!probed) probed = probeCanons();
  if (!probedColors) probedColors = probeColors();
  active = true;
  els.launcher.classList.add('is-on');
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
  highlightOffCanon();          // flag every off-canon text element in red
}
function disable() {
  active = false;
  selected = null;
  dragging = false;
  panelMoved = false;
  clearOffCanon();
  els.launcher.classList.remove('is-on');
  els.hi.style.display = 'none';
  els.panel.style.display = 'none';
  document.removeEventListener('mousemove', onMove, true);
  document.removeEventListener('click', onClick, true);
  document.removeEventListener('keydown', onKey, true);
}

const isOurs = (el) => !!(el && el.closest && el.closest('.' + ROOT_CLASS));

function onMove(e) {
  if (dragging) { els.hi.style.display = 'none'; return; }
  const el = e.target;
  if (isOurs(el)) { els.hi.style.display = 'none'; return; }
  const r = el.getBoundingClientRect();
  Object.assign(els.hi.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
}

function onClick(e) {
  if (dragging) return;         // trailing click after a drag — ignore
  if (isOurs(e.target)) return; // let our own UI work normally
  e.preventDefault();
  e.stopPropagation();
  selectEl(e.target);
}

function onKey(e) { if (e.key === 'Escape') disable(); }

// ── draggable panels ───────────────────────────────────────────────────────
// Drag a floating element by a handle (its header). Buttons inside the handle
// keep working (drag ignores mousedown that starts on a button).
function makeDraggable(box, handle, onStart) {
  handle.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    e.preventDefault();
    const r = box.getBoundingClientRect();
    const offX = e.clientX - r.left, offY = e.clientY - r.top;
    dragging = true;
    if (onStart) onStart();
    box.style.right = 'auto'; box.style.bottom = 'auto';
    const move = (ev) => {
      const left = Math.max(0, Math.min(ev.clientX - offX, window.innerWidth - box.offsetWidth));
      const top = Math.max(0, Math.min(ev.clientY - offY, window.innerHeight - box.offsetHeight));
      box.style.left = left + 'px'; box.style.top = top + 'px';
    };
    const up = () => {
      document.removeEventListener('mousemove', move, true);
      document.removeEventListener('mouseup', up, true);
      setTimeout(() => { dragging = false; }, 0);   // swallow the trailing click
    };
    document.addEventListener('mousemove', move, true);
    document.addEventListener('mouseup', up, true);
  });
}

// ── off-canon highlighting ─────────────────────────────────────────────────
// An element "owns text" if it has a non-empty direct text node (it renders
// text itself, rather than only through children) — those are what must sit on
// a canon. On enable we flag every such element that detects as off-canon.
function ownsText(el) {
  for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return true;
  return false;
}
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH', 'TEXTAREA', 'INPUT', 'OPTION']);
function reflag(el) {
  // Re-evaluate one element's off-canon state (used after preview/save/reset).
  if (!active || isOurs(el)) return;
  const off = ownsText(el) && !detectCanon(el, probed);
  el.classList.toggle('ci-offcanon-hi', off);
  if (off) offCanon.add(el); else offCanon.delete(el);
}
function highlightOffCanon() {
  for (const el of document.body.querySelectorAll('*')) {
    if (SKIP_TAGS.has(el.tagName) || isOurs(el) || !ownsText(el)) continue;
    if (!el.getClientRects().length) continue;               // not rendered
    if (!detectCanon(el, probed)) { el.classList.add('ci-offcanon-hi'); offCanon.add(el); }
  }
}
function clearOffCanon() {
  for (const el of offCanon) el.classList.remove('ci-offcanon-hi');
  offCanon.clear();
}

// ── scope (element vs. all-like-this) ──────────────────────────────────────
function scopeTargets(el) {
  if (scopeMode.get(el) !== 'group') return [el];
  const sel = groupSelector(el);
  try {
    return [...document.querySelectorAll(sel)].filter((t) => !isOurs(t));
  } catch { return [el]; }
}

// ── selection panel ────────────────────────────────────────────────────────
function selectEl(el) {
  selected = el;

  // Cache the REAL canon once, before any preview mutates the element.
  if (!baseCanon.has(el)) baseCanon.set(el, detectCanon(el, probed));
  const base = baseCanon.get(el);

  // Seed the pending (preview) choice: an already-queued target, else the base.
  if (!pendingCanon.has(el)) {
    const queued = queuedFor.has(el) ? changes.find((c) => c.key === queuedFor.get(el)) : null;
    pendingCanon.set(el, queued ? queued.to : base);
  }
  if (!baseColor.has(el)) baseColor.set(el, detectColor(el, probedColors));
  if (!pendingColor.has(el)) {
    const queued = queuedFor.has(el) ? changes.find((c) => c.key === queuedFor.get(el)) : null;
    pendingColor.set(el, queued ? (queued.toColor ?? null) : baseColor.get(el));
  }
  if (!scopeMode.has(el)) scopeMode.set(el, 'el');
  render(el);
  positionPanel(el);
}

// A titled section: uppercase header (+ optional monospace note) then its nodes.
function section(title, note, ...nodes) {
  const sec = h('ci-sec');
  const hd = h('ci-sec__h');
  hd.append(title);
  if (note) { const n = h('', 'span'); n.textContent = note; hd.appendChild(n); }
  sec.appendChild(hd);
  for (const n of nodes) sec.appendChild(n);
  return sec;
}
function hintNode(text) { const d = h('ci-hint'); d.textContent = text; return d; }

function render(el) {
  const base = baseCanon.get(el);
  const pending = pendingCanon.get(el);
  const scope = scopeMode.get(el);
  const groupCount = scopeTargets(el).length;

  // ── header (draggable): title bar + status + sample ──
  const head = h('ci-head');
  const bar = h('ci-head__bar');
  const title = h('ci-head__title'); title.textContent = 'Инспектор канонов';
  const xBtn = h('ci-head__x', 'button'); xBtn.textContent = '✕'; xBtn.title = 'Закрыть';
  xBtn.onclick = () => { els.panel.style.display = 'none'; };
  bar.append(title, xBtn);
  const status = h('ci-status');
  status.innerHTML = base
    ? `<span class="ci-status__dot"></span><span>Сейчас: <b>${canonLabel(base)}</b></span>`
    : `<span class="ci-status__dot ci-status__dot--off"></span><span><b class="ci-panel__off">off-canon</b> — не на каноне</span>`;
  head.append(bar, status);
  if (!sameCanon(pending, base)) {
    const prev = h('ci-status__prev'); prev.innerHTML = `Предпросмотр: <b>${canonLabel(pending)}</b>`;
    head.appendChild(prev);
  }
  const samp = h('ci-samp'); samp.textContent = (el.textContent || '').trim().slice(0, 90) || '‹пусто›';
  head.appendChild(samp);

  // ── body: scope · canon · states · colour ──
  const body = h('ci-body');

  // scope
  const scopeRow = h('ci-scope');
  const bEl = h(scope === 'el' ? 'is-on' : '', 'button'); bEl.textContent = 'Этот';
  bEl.onclick = () => setScope(el, 'el');
  const bGroup = h(scope === 'group' ? 'is-on' : '', 'button'); bGroup.textContent = `Все похожие (${groupCount})`;
  bGroup.title = groupSelector(el);
  bGroup.onclick = () => setScope(el, 'group');
  scopeRow.append(bEl, bGroup);
  body.appendChild(section('Область', scope === 'group' ? groupSelector(el) : '', scopeRow));

  // canon
  const canons = h('ci-canons');
  for (const c of CANONS) {
    const p = probed.canons.get(c.id);
    const btn = h('ci-canon', 'button');
    if (pending && c.id === pending.id) btn.classList.add('is-cur');
    const isBase = base && c.id === base.id;
    const mkTag = c.mockup && c.mockup !== '—' ? ` <span class="ci-canon__mk">макет: ${c.mockup}</span>` : '';
    btn.innerHTML = `<div class="ci-canon__t">${c.id} · ${c.name}${mkTag}${isBase ? ' <i>(сейчас)</i>' : ''}</div>`
      + `<div class="ci-canon__spec">${p.human}</div>`
      + `<div class="ci-canon__role">${c.role}</div>`;
    btn.onclick = () => pickCanon(el, c.id);
    canons.appendChild(btn);
  }
  body.appendChild(section('Канон', `${CANONS.length}`, canons));

  // knobs — дисплейные «ручки» из файла типографики «Экзо» (TRIP-183), с живым значением
  const knobs = h('ci-knobs');
  const rootCS = getComputedStyle(document.documentElement);
  for (const k of KNOBS) {
    const val = (rootCS.getPropertyValue(k.css) || '').trim() || '—';
    const row = h('ci-knob');
    const nm = k.css === k.file ? k.css : `${k.css} ↔ ${k.file}`;
    row.innerHTML = `<code>${nm}</code> <b>${val}</b> <span>${k.label}</span>`;
    knobs.appendChild(row);
  }
  body.appendChild(section('Ручки (модификаторы файла)', `${KNOBS.length}`, knobs));

  // states — only those that change THIS canon (needs a chosen canon)
  const baseApply = pending ? probed.canons.get(pending.id).apply : null;
  const ps = psFor(el);
  const stWrap = h('ci-wrap');
  for (const st of STATES) {
    if (baseApply && !st.applies(baseApply)) continue;
    const chip = h('ci-chip', 'button');
    let on = false, label = st.label;
    if (st.saveable) on = !!pending && pending.mods.includes(st.key);
    else if (st.cycle) { on = ps.track > 0; if (on) label = `${st.label} ·${ps.track}`; }
    else on = ps.keys.has(st.key);
    chip.textContent = label;
    if (on) chip.classList.add('is-on');
    chip.onclick = () => (st.saveable ? toggleMod(el, st.key) : togglePreviewState(el, st.key));
    stWrap.appendChild(chip);
  }
  body.appendChild(section('Состояния', '', pending ? stWrap : hintNode('Выбери канон, чтобы включить состояния')));

  // colour — sanctioned text colours (SAVED to the worklist)
  const curColor = pendingColor.get(el) ?? null;
  const colWrap = h('ci-wrap');
  for (const c of COLORS) {
    const sw = h('ci-sw', 'button');
    sw.title = `${c.label}${c.util ? ' · ' + c.util : ''}`;
    sw.innerHTML = `<i style="background:${c.css}"></i><span>${c.label}</span>`;
    if (curColor === c.key) sw.classList.add('is-on');
    sw.onclick = () => pickColor(el, c.key);
    colWrap.appendChild(sw);
  }
  body.appendChild(section('Цвет текста', '', colWrap));

  // ── footer ──
  const foot = h('ci-foot');
  const saveBtn = h('ci-btn ci-btn--save', 'button');
  const changed = isChanged(el);
  saveBtn.textContent = changed ? 'Сохранить' : 'Нет изменений';
  if (!changed) saveBtn.setAttribute('disabled', '');
  saveBtn.onclick = () => commit(el);
  const reset = h('ci-btn', 'button'); reset.textContent = 'Сбросить';
  reset.onclick = () => resetEl(el);
  foot.append(saveBtn, reset);

  els.panel.innerHTML = '';
  els.panel.append(head, body, foot);
  makeDraggable(els.panel, head, () => { panelMoved = true; });   // drag by header
}

function positionPanel(el) {
  els.panel.style.display = 'flex';              // column: header / scroll body / footer
  if (panelMoved) return;                        // user moved it — keep their position
  const r = el.getBoundingClientRect();
  const pw = 336, gap = 10;                      // keep in sync with .ci-panel width
  let left = r.right + gap;
  if (left + pw > window.innerWidth) left = Math.max(gap, r.left - pw - gap);
  if (left + pw > window.innerWidth) left = window.innerWidth - pw - gap;
  const top = Math.min(r.top, window.innerHeight - els.panel.offsetHeight - gap);
  els.panel.style.left = Math.max(gap, left) + 'px';
  els.panel.style.top = Math.max(gap, top) + 'px';
}

// ── preview (ephemeral inline style; never queued) ─────────────────────────
function pickCanon(el, id) {
  const cur = pendingCanon.get(el);
  pendingCanon.set(el, { id, mods: cur ? cur.mods : [] });
  previewStates.delete(el);               // preview-states are canon-specific — reset on canon switch
  applyPreview(el);
  render(el);
}
function toggleMod(el, key) {
  const cur = pendingCanon.get(el);
  if (!cur) return;                       // no canon chosen → modifier is meaningless
  const mods = cur.mods.includes(key) ? cur.mods.filter((k) => k !== key) : [...cur.mods, key];
  pendingCanon.set(el, { id: cur.id, mods });
  applyPreview(el);
  render(el);
}
// Preview-only states (caps/track/mono/mute) — ephemeral, never queued to the worklist.
function togglePreviewState(el, key) {
  const st = STATES.find((s) => s.key === key);
  if (!st || !pendingCanon.get(el)) return;
  const ps = psFor(el);
  if (st.cycle) ps.track = (ps.track + 1) % (st.cycle.length + 1);   // 0=off, then 1..n
  else if (ps.keys.has(key)) ps.keys.delete(key); else ps.keys.add(key);
  previewStates.set(el, ps);
  applyPreview(el);
  render(el);
}
// Combined inline CSS of the active preview-states (layers on top of the canon).
function stateCssFor(el) {
  const ps = previewStates.get(el);
  if (!ps) return null;
  const css = {};
  for (const st of STATES) if (!st.cycle && st.css && ps.keys.has(st.key)) Object.assign(css, st.css);
  if (ps.track > 0) { const t = STATES.find((s) => s.cycle); css.letterSpacing = t.cycle[ps.track - 1]; }
  return css;
}
function setScope(el, mode) {
  // restore the previous scope's preview before switching, to avoid orphaned styles
  restorePreview(el);
  scopeMode.set(el, mode);
  applyPreview(el);
  render(el);
}
// Colour axis — SAVED to the worklist (unlike the preview-only states). Click the
// active swatch again to clear the choice.
function pickColor(el, key) {
  const cur = pendingColor.get(el) ?? null;
  pendingColor.set(el, cur === key ? null : key);
  applyPreview(el);
  render(el);
}
// Is there anything worth saving? Canon differs from real, or colour differs.
function isChanged(el) {
  const canonDiff = !sameCanon(pendingCanon.get(el), baseCanon.get(el));
  const colorDiff = (pendingColor.get(el) ?? null) !== (baseColor.get(el) ?? null);
  return canonDiff || colorDiff;
}
const colorLabel = (key) => {
  const c = key ? colorByKey(key) : null;
  return c ? `${c.label}${c.util ? ' ' + c.util : ''}` : '—';
};

function applyPreview(el) {
  const pending = pendingCanon.get(el);
  const props = pending ? comboApply(probed, pending.id, pending.mods) : null;
  const scss = stateCssFor(el);           // preview-state overlay (caps/track/mono/mute)
  const colKey = pendingColor.get(el) ?? null;
  const merged = { ...(props || {}), ...(scss || {}) };
  if (colKey) merged.color = colorByKey(colKey).css;
  for (const t of scopeTargets(el)) {
    // Capture each target's REAL canon before we mutate it, so clicking a
    // group sibling later still reports its true "Сейчас".
    if (!baseCanon.has(t)) baseCanon.set(t, detectCanon(t, probed));
    if (!originalCss.has(t)) originalCss.set(t, t.getAttribute('style') || '');
    // Reset to the captured original, then layer the preview — so deselecting a
    // colour/state actually removes it (Object.assign alone can't unset).
    const orig = originalCss.get(t);
    if (orig) t.setAttribute('style', orig); else t.removeAttribute('style');
    Object.assign(t.style, merged);
    reflag(t);                              // now on a canon → drop red highlight
  }
}
function restorePreview(el) {
  for (const t of scopeTargets(el)) {
    if (!originalCss.has(t)) continue;
    const prev = originalCss.get(t);
    if (prev) t.setAttribute('style', prev); else t.removeAttribute('style');
    originalCss.delete(t);
    reflag(t);                              // back to its real canon → re-check highlight
  }
}

// ── save / reset ───────────────────────────────────────────────────────────
function commit(el) {
  // No real change (canon AND colour unchanged) → don't record; drop stale entry.
  if (!isChanged(el)) {
    if (queuedFor.has(el)) removeChange(queuedFor.get(el));
    render(el);
    return;
  }
  queueChange(el, baseCanon.get(el), pendingCanon.get(el));
  render(el);
}

function resetEl(el) {
  restorePreview(el);
  previewStates.delete(el);
  pendingCanon.set(el, baseCanon.get(el));
  pendingColor.set(el, baseColor.get(el));
  if (queuedFor.has(el)) removeChange(queuedFor.get(el));
  render(el);
}

// ── change list / tray ─────────────────────────────────────────────────────
function queueChange(el, from, to) {
  const scope = scopeMode.get(el);
  const selector = groupSelector(el);
  const count = scope === 'group' ? scopeTargets(el).length : 1;
  const fromColor = baseColor.get(el) ?? null;
  const toColor = pendingColor.get(el) ?? null;
  const existingKey = queuedFor.get(el);
  if (existingKey != null) {
    const c = changes.find((x) => x.key === existingKey);
    if (c) { Object.assign(c, { from, to, fromColor, toColor, scope, selector, count }); save(); renderTray(); return; }
  }
  const key = ++seq;
  queuedFor.set(el, key);
  changes.push({ key, from, to, fromColor, toColor, descriptor: describe(el), scope, selector, count });
  save();
  renderTray();
}

function renderTray() {
  els.tray.style.display = changes.length ? 'block' : 'none';
  if (!changes.length) { els.tray.innerHTML = ''; return; }

  const head = h('ci-tray__head');
  head.innerHTML = `<span class="ci-tray__title">Правки · ${changes.length}</span>`;
  const acts = h('ci-tray__acts');
  const copy = h('ci-mini', 'button'); copy.textContent = 'Копировать список';
  copy.onclick = copyList;
  const clear = h('ci-mini', 'button'); clear.textContent = 'Очистить';
  clear.onclick = clearList;
  acts.append(copy, clear);
  head.appendChild(acts);

  const rows = document.createDocumentFragment();
  for (const c of changes) {
    const row = h('ci-row');
    const canonChanged = !sameCanon(c.from, c.to);
    const colorChanged = (c.fromColor ?? null) !== (c.toColor ?? null);
    let map = '';
    if (canonChanged) map += `${canonLabel(c.from)} → <i>${canonLabel(c.to)}</i>`;
    if (colorChanged) map += `${canonChanged ? '<br>' : ''}цвет: ${escapeHtml(colorLabel(c.fromColor))} → <i>${escapeHtml(colorLabel(c.toColor))}</i>`;
    if (!map) map = canonLabel(c.to);
    let html = `<span class="ci-row__x" data-k="${c.key}">✕</span>`
      + `<div class="ci-row__map">${map}</div>`;
    if (c.scope === 'group') html += `<div class="ci-row__scope">область: ${escapeHtml(c.selector)} · ${c.count} эл.</div>`;
    html += `<div class="ci-row__path">${escapeHtml(c.descriptor.text || c.descriptor.tag)}<br>${escapeHtml(c.descriptor.path)}</div>`;
    row.innerHTML = html;
    row.querySelector('.ci-row__x').onclick = () => removeChange(c.key);
    rows.appendChild(row);
  }

  els.tray.innerHTML = '';
  els.tray.append(head, ...rows.childNodes);
  makeDraggable(els.tray, head);            // drag the tray by its header
}

function removeChange(key) {
  changes = changes.filter((c) => c.key !== key);
  save();
  renderTray();
}
function clearList() {
  if (!confirm('Очистить весь список правок канонов?')) return;
  changes = [];
  save();
  renderTray();
}

function copyList() {
  const lines = changes.map((c) => {
    const canonChanged = !sameCanon(c.from, c.to);
    const cls = c.to ? ` (.${CANONS[c.to.id - 1].cls}${c.to.mods.map((m) => ' .t-' + m).join('')})` : '';
    const head = canonChanged ? `${canonLabel(c.from)} → ${canonLabel(c.to)}${cls}` : canonLabel(c.to);
    const colLine = (c.fromColor ?? null) !== (c.toColor ?? null)
      ? `\n    цвет: ${colorLabel(c.fromColor)} → ${colorLabel(c.toColor)}${c.toColor ? ` [${colorByKey(c.toColor).css}]` : ''}`
      : '';
    const scope = c.scope === 'group' ? `\n    область: ${c.selector} (${c.count} эл.)` : '';
    return `- ${head}${colLine}${scope}\n    текст: ${c.descriptor.text || '—'}\n    класс: ${c.descriptor.className || '—'}\n    путь:  ${c.descriptor.path}`;
  });
  const out = `# Canon-inspector: ${changes.length} правк(и) канонов/цветов (TRIP-175)\n\n${lines.join('\n')}\n`;
  const done = () => { els.tray.querySelector('.ci-tray__title').textContent = `Скопировано ✓ · ${changes.length}`; };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(out).then(done, () => fallbackCopy(out, done));
  else fallbackCopy(out, done);
}
function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); done(); } catch { /* noop */ }
  document.body.removeChild(ta);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ── public entry ───────────────────────────────────────────────────────────
export function initCanonInspector() {
  if (window.__canonInspector) return;   // guard against double init (HMR)
  window.__canonInspector = true;
  load();
  injectStyles();
  build();
}
