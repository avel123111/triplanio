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

import { CANONS, STATES, probeCanons, detectCanon, comboApply } from './canons.js';
import { describe, groupSelector } from './describe.js';

const LS_KEY = 'ci:canon-changes';
const ROOT_CLASS = 'ci-root';

let probed = null;             // { canons, combos } — lazy probe of app.css
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

let els = {};                  // cached DOM refs (launcher, hi, panel, tray…)

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
  .ci-panel { position: fixed; z-index: 2147483000; width: 300px; max-height: 78vh; overflow: auto;
    background: #0f172a; color: #e2e8f0; border: 1px solid #334155; border-radius: 14px;
    box-shadow: 0 16px 48px rgba(0,0,0,.5); display: none; }
  .ci-panel__head { padding: 12px 14px; border-bottom: 1px solid #1e293b; position: sticky; top: 0; background: #0f172a; }
  .ci-panel__now { font-size: 12px; color: #94a3b8; }
  .ci-panel__now b { color: #e2e8f0; font-size: 13px; }
  .ci-panel__prev { font-size: 12px; color: #94a3b8; margin-top: 2px; }
  .ci-panel__prev b { color: #60a5fa; font-size: 13px; }
  .ci-panel__off { color: #fca5a5; }
  .ci-panel__samp { margin-top: 4px; font-size: 12px; color: #cbd5e1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ci-scope { display: flex; gap: 6px; margin-top: 10px; }
  .ci-scope button { flex: 1; padding: 6px 8px; border-radius: 8px; border: 1px solid #334155; background: #1e293b;
    color: #94a3b8; font-size: 11px; font-weight: 600; cursor: pointer; }
  .ci-scope button.is-on { background: #172554; border-color: #2563eb; color: #e2e8f0; }
  .ci-mods { display: flex; gap: 6px; padding: 10px 14px; border-bottom: 1px solid #1e293b; }
  .ci-mods__lbl { font-size: 11px; color: #64748b; align-self: center; margin-right: 2px; }
  .ci-chip { padding: 5px 10px; border-radius: 999px; border: 1px solid #334155; background: #1e293b;
    color: #94a3b8; font-size: 11px; font-weight: 600; cursor: pointer; }
  .ci-chip.is-on { background: #2563eb; border-color: #2563eb; color: #fff; }
  .ci-chip[disabled] { opacity: .4; cursor: not-allowed; }
  .ci-canon { display: block; width: 100%; text-align: left; border: 0; border-bottom: 1px solid #1e293b;
    background: transparent; color: inherit; padding: 9px 14px; cursor: pointer; }
  .ci-canon:hover { background: #1e293b; }
  .ci-canon.is-cur { background: #172554; }
  .ci-canon__t { font-size: 13px; font-weight: 600; }
  .ci-canon__t i { color: #60a5fa; font-style: normal; }
  .ci-canon__mk { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 6px;
    background: #1e293b; color: #93c5fd; font-size: 10px; font-weight: 700;
    font-family: ui-monospace, monospace; vertical-align: middle; }
  .ci-canon__spec { font-size: 11px; color: #94a3b8; margin-top: 2px; font-family: ui-monospace, monospace; }
  .ci-canon__role { font-size: 11px; color: #64748b; margin-top: 1px; }
  .ci-panel__foot { display: flex; gap: 8px; padding: 10px 14px; position: sticky; bottom: 0; background: #0f172a; border-top: 1px solid #1e293b; }
  .ci-btn { flex: 1; padding: 8px; border-radius: 9px; border: 1px solid #334155; background: #1e293b; color: #e2e8f0; font-size: 12px; font-weight: 600; cursor: pointer; }
  .ci-btn:hover { background: #334155; }
  .ci-btn--save { background: #2563eb; border-color: #2563eb; color: #fff; }
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
  active = true;
  els.launcher.classList.add('is-on');
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
}
function disable() {
  active = false;
  selected = null;
  els.launcher.classList.remove('is-on');
  els.hi.style.display = 'none';
  els.panel.style.display = 'none';
  document.removeEventListener('mousemove', onMove, true);
  document.removeEventListener('click', onClick, true);
  document.removeEventListener('keydown', onKey, true);
}

const isOurs = (el) => !!(el && el.closest && el.closest('.' + ROOT_CLASS));

function onMove(e) {
  const el = e.target;
  if (isOurs(el)) { els.hi.style.display = 'none'; return; }
  const r = el.getBoundingClientRect();
  Object.assign(els.hi.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
}

function onClick(e) {
  if (isOurs(e.target)) return; // let our own UI work normally
  e.preventDefault();
  e.stopPropagation();
  selectEl(e.target);
}

function onKey(e) { if (e.key === 'Escape') disable(); }

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
  if (!scopeMode.has(el)) scopeMode.set(el, 'el');
  render(el);
  positionPanel(el);
}

function render(el) {
  const base = baseCanon.get(el);
  const pending = pendingCanon.get(el);
  const scope = scopeMode.get(el);
  const groupCount = scopeTargets(el).length;

  // head: real current + (if previewing something else) the preview
  const head = h('ci-panel__head');
  const nowLabel = base
    ? `<b>${canonLabel(base)}</b>`
    : `<b class="ci-panel__off">off-canon</b> — не совпадает ни с одним`;
  let headHtml = `<div class="ci-panel__now">Сейчас: ${nowLabel}</div>`;
  if (!sameCanon(pending, base)) headHtml += `<div class="ci-panel__prev">Предпросмотр: <b>${canonLabel(pending)}</b></div>`;
  headHtml += `<div class="ci-panel__samp">${escapeHtml((el.textContent || '').trim().slice(0, 60)) || '<пусто>'}</div>`;
  head.innerHTML = headHtml;

  const scopeRow = h('ci-scope');
  const bEl = h(scope === 'el' ? 'is-on' : '', 'button'); bEl.textContent = 'Этот';
  bEl.onclick = () => setScope(el, 'el');
  const bGroup = h(scope === 'group' ? 'is-on' : '', 'button'); bGroup.textContent = `Все похожие · ${groupSelector(el)} (${groupCount})`;
  bGroup.onclick = () => setScope(el, 'group');
  scopeRow.append(bEl, bGroup);
  head.appendChild(scopeRow);

  // states — per-canon set from the design-system mockup (only those that change
  // THIS canon). strong/flush save to the worklist; caps/track/mono/mute preview only.
  const mods = h('ci-mods');
  const modLbl = h('ci-mods__lbl'); modLbl.textContent = 'Состояния:';
  mods.appendChild(modLbl);
  const baseApply = pending ? probed.canons.get(pending.id).apply : null;
  const ps = psFor(el);
  for (const st of STATES) {
    if (baseApply && !st.applies(baseApply)) continue;   // hide states that don't change this canon
    const chip = h('ci-chip', 'button');
    let on = false, label = st.label;
    if (st.saveable) on = !!pending && pending.mods.includes(st.key);
    else if (st.cycle) { on = ps.track > 0; if (on) label = `${st.label} ·${ps.track}`; }
    else on = ps.keys.has(st.key);
    chip.textContent = label;
    if (on) chip.classList.add('is-on');
    if (!pending) chip.setAttribute('disabled', '');
    chip.onclick = () => (st.saveable ? toggleMod(el, st.key) : togglePreviewState(el, st.key));
    mods.appendChild(chip);
  }

  // canon list
  const list = document.createDocumentFragment();
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
    list.appendChild(btn);
  }

  // footer: save (only when the preview differs from the real current)
  const foot = h('ci-panel__foot');
  const saveBtn = h('ci-btn ci-btn--save', 'button'); saveBtn.textContent = 'Сохранить';
  if (sameCanon(pending, base)) saveBtn.setAttribute('disabled', '');
  saveBtn.onclick = () => commit(el);
  const reset = h('ci-btn', 'button'); reset.textContent = 'Сбросить';
  reset.onclick = () => resetEl(el);
  const close = h('ci-btn', 'button'); close.textContent = 'Закрыть';
  close.onclick = () => { els.panel.style.display = 'none'; };
  foot.append(saveBtn, reset, close);

  els.panel.innerHTML = '';
  els.panel.append(head, mods, ...list.childNodes, foot);
}

function positionPanel(el) {
  const r = el.getBoundingClientRect();
  els.panel.style.display = 'block';
  const pw = 300, gap = 10;
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

function applyPreview(el) {
  const pending = pendingCanon.get(el);
  if (!pending) return;
  const props = comboApply(probed, pending.id, pending.mods);
  if (!props) return;
  const scss = stateCssFor(el);           // preview-state overlay (caps/track/mono/mute)
  for (const t of scopeTargets(el)) {
    // Capture each target's REAL canon before we mutate it, so clicking a
    // group sibling later still reports its true "Сейчас".
    if (!baseCanon.has(t)) baseCanon.set(t, detectCanon(t, probed));
    if (!originalCss.has(t)) originalCss.set(t, t.getAttribute('style') || '');
    Object.assign(t.style, props, scss || {});
  }
}
function restorePreview(el) {
  for (const t of scopeTargets(el)) {
    if (!originalCss.has(t)) continue;
    const prev = originalCss.get(t);
    if (prev) t.setAttribute('style', prev); else t.removeAttribute('style');
    originalCss.delete(t);
  }
}

// ── save / reset ───────────────────────────────────────────────────────────
function commit(el) {
  const base = baseCanon.get(el);
  const pending = pendingCanon.get(el);
  // No real change → don't record; drop any stale queued entry for this element.
  if (sameCanon(pending, base)) {
    if (queuedFor.has(el)) removeChange(queuedFor.get(el));
    render(el);
    return;
  }
  queueChange(el, base, pending);
  render(el);
}

function resetEl(el) {
  restorePreview(el);
  previewStates.delete(el);
  pendingCanon.set(el, baseCanon.get(el));
  if (queuedFor.has(el)) removeChange(queuedFor.get(el));
  render(el);
}

// ── change list / tray ─────────────────────────────────────────────────────
function queueChange(el, from, to) {
  const scope = scopeMode.get(el);
  const selector = groupSelector(el);
  const count = scope === 'group' ? scopeTargets(el).length : 1;
  const existingKey = queuedFor.get(el);
  if (existingKey != null) {
    const c = changes.find((x) => x.key === existingKey);
    if (c) { Object.assign(c, { from, to, scope, selector, count }); save(); renderTray(); return; }
  }
  const key = ++seq;
  queuedFor.set(el, key);
  changes.push({ key, from, to, descriptor: describe(el), scope, selector, count });
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
    let html = `<span class="ci-row__x" data-k="${c.key}">✕</span>`
      + `<div class="ci-row__map">${canonLabel(c.from)} → <i>${canonLabel(c.to)}</i></div>`;
    if (c.scope === 'group') html += `<div class="ci-row__scope">область: ${escapeHtml(c.selector)} · ${c.count} эл.</div>`;
    html += `<div class="ci-row__path">${escapeHtml(c.descriptor.text || c.descriptor.tag)}<br>${escapeHtml(c.descriptor.path)}</div>`;
    row.innerHTML = html;
    row.querySelector('.ci-row__x').onclick = () => removeChange(c.key);
    rows.appendChild(row);
  }

  els.tray.innerHTML = '';
  els.tray.append(head, ...rows.childNodes);
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
    const to = CANONS[c.to.id - 1];
    const toStr = `${canonLabel(c.to)} (.${to.cls}${c.to.mods.map((m) => ' .t-' + m).join('')})`;
    const scope = c.scope === 'group' ? `\n    область: ${c.selector} (${c.count} эл.)` : '';
    return `- ${canonLabel(c.from)} → ${toStr}${scope}\n    текст: ${c.descriptor.text || '—'}\n    класс: ${c.descriptor.className || '—'}\n    путь:  ${c.descriptor.path}`;
  });
  const out = `# Canon-inspector: ${changes.length} правк(и) канонов (TRIP-165)\n\n${lines.join('\n')}\n`;
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
