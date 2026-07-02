// TRIP-165 · Canon inspector — overlay, selection panel, change-list tray.
//
// Preview-only, dev-only. Alt-click any text → pick one of the 10 canons →
// see the effect live (ephemeral inline style). Queued decisions accumulate in
// a tray and persist to localStorage; "Копировать список" hands them to a PR.
// Nothing is ever written to source or shipped to production.

import { CANONS, probeCanons, detectCanon } from './canons.js';
import { describe } from './describe.js';

const LS_KEY = 'ci:canon-changes';
const ROOT_CLASS = 'ci-root';

let probes = null;             // Map<id, {canon,sig,human,apply}> — lazy
let active = false;            // inspect mode on/off
let selected = null;           // currently selected element
let changes = [];              // [{key, from, to, descriptor}]
let seq = 0;                   // uid counter for change keys
const queuedFor = new WeakMap(); // element → change.key (in-session dedup)
const originalCss = new WeakMap(); // element → prior inline cssText (for reset)

let els = {};                  // cached DOM refs (launcher, hi, panel, tray…)

// ── persistence ──────────────────────────────────────────────────────────
function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) { changes = JSON.parse(raw); seq = changes.reduce((m, c) => Math.max(m, c.key), 0); }
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
  .ci-launch { position: fixed; left: 16px; bottom: 16px; z-index: 2147483000; display: flex; align-items: center; gap: 8px;
    padding: 9px 13px; border-radius: 999px; border: 1px solid #334155; background: #0f172a; color: #e2e8f0;
    font-size: 13px; font-weight: 600; cursor: pointer; box-shadow: 0 6px 20px rgba(0,0,0,.35); }
  .ci-launch:hover { background: #1e293b; }
  .ci-launch.is-on { background: #2563eb; border-color: #2563eb; color: #fff; }
  .ci-launch .ci-dot { width: 8px; height: 8px; border-radius: 50%; background: #64748b; }
  .ci-launch.is-on .ci-dot { background: #bfdbfe; }
  .ci-hi { position: fixed; z-index: 2147482000; pointer-events: none; border: 2px solid #2563eb;
    background: rgba(37,99,235,.10); border-radius: 4px; transition: all .04s linear; display: none; }
  .ci-panel { position: fixed; z-index: 2147483000; width: 300px; max-height: 78vh; overflow: auto;
    background: #0f172a; color: #e2e8f0; border: 1px solid #334155; border-radius: 14px;
    box-shadow: 0 16px 48px rgba(0,0,0,.5); display: none; }
  .ci-panel__head { padding: 12px 14px; border-bottom: 1px solid #1e293b; position: sticky; top: 0; background: #0f172a; }
  .ci-panel__now { font-size: 12px; color: #94a3b8; }
  .ci-panel__now b { color: #e2e8f0; font-size: 13px; }
  .ci-panel__off { color: #fca5a5; }
  .ci-panel__samp { margin-top: 4px; font-size: 12px; color: #cbd5e1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ci-canon { display: block; width: 100%; text-align: left; border: 0; border-bottom: 1px solid #1e293b;
    background: transparent; color: inherit; padding: 9px 14px; cursor: pointer; }
  .ci-canon:hover { background: #1e293b; }
  .ci-canon.is-cur { background: #172554; }
  .ci-canon__t { font-size: 13px; font-weight: 600; }
  .ci-canon__t i { color: #60a5fa; font-style: normal; }
  .ci-canon__spec { font-size: 11px; color: #94a3b8; margin-top: 2px; font-family: ui-monospace, monospace; }
  .ci-canon__role { font-size: 11px; color: #64748b; margin-top: 1px; }
  .ci-panel__foot { display: flex; gap: 8px; padding: 10px 14px; position: sticky; bottom: 0; background: #0f172a; border-top: 1px solid #1e293b; }
  .ci-btn { flex: 1; padding: 8px; border-radius: 9px; border: 1px solid #334155; background: #1e293b; color: #e2e8f0; font-size: 12px; font-weight: 600; cursor: pointer; }
  .ci-btn:hover { background: #334155; }
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
  els.launcher.innerHTML = `<span class="ci-dot"></span><span>Каноны</span>`;
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
  if (!probes) probes = probeCanons();
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

// ── selection panel ────────────────────────────────────────────────────────
function selectEl(el) {
  selected = el;
  const curId = detectCanon(el, probes);
  const queuedKey = queuedFor.get(el);
  const activeId = queuedKey != null ? changes.find((c) => c.key === queuedKey)?.to : curId;

  const head = h('ci-panel__head');
  const nowLabel = curId
    ? `<b>${curId} · ${CANONS[curId - 1].name}</b>`
    : `<b class="ci-panel__off">off-canon</b> — не совпадает ни с одним`;
  head.innerHTML = `<div class="ci-panel__now">Сейчас: ${nowLabel}</div>`
    + `<div class="ci-panel__samp">${escapeHtml((el.textContent || '').trim().slice(0, 60)) || '<пусто>'}</div>`;

  const list = document.createDocumentFragment();
  for (const c of CANONS) {
    const p = probes.get(c.id);
    const btn = h('ci-canon', 'button');
    if (c.id === activeId) btn.classList.add('is-cur');
    btn.innerHTML = `<div class="ci-canon__t">${c.id} · ${c.name}${c.id === curId ? ' <i>(сейчас)</i>' : ''}</div>`
      + `<div class="ci-canon__spec">${p.human}</div>`
      + `<div class="ci-canon__role">${c.role}</div>`;
    btn.onclick = () => { applyCanon(el, c.id, curId); selectEl(el); };
    list.appendChild(btn);
  }

  const foot = h('ci-panel__foot');
  const reset = h('ci-btn', 'button'); reset.textContent = 'Сбросить';
  reset.onclick = () => { resetEl(el); selectEl(el); };
  const close = h('ci-btn', 'button'); close.textContent = 'Закрыть';
  close.onclick = () => { els.panel.style.display = 'none'; };
  foot.append(reset, close);

  els.panel.innerHTML = '';
  els.panel.append(head, ...list.childNodes, foot);
  positionPanel(el);
}

function positionPanel(el) {
  const r = el.getBoundingClientRect();
  els.panel.style.display = 'block';
  const pw = 300, gap = 10;
  let left = r.right + gap;
  if (left + pw > window.innerWidth) left = Math.max(gap, r.left - pw - gap);
  if (left + pw > window.innerWidth) left = window.innerWidth - pw - gap;
  let top = Math.min(r.top, window.innerHeight - els.panel.offsetHeight - gap);
  els.panel.style.left = Math.max(gap, left) + 'px';
  els.panel.style.top = Math.max(gap, top) + 'px';
}

// ── apply / reset (ephemeral inline preview) ───────────────────────────────
function applyCanon(el, id, fromId) {
  if (!originalCss.has(el)) originalCss.set(el, el.getAttribute('style') || '');
  const { apply } = probes.get(id);
  el.style.fontFamily = apply.fontFamily;
  el.style.fontSize = apply.fontSize;
  el.style.fontWeight = apply.fontWeight;
  el.style.lineHeight = apply.lineHeight;
  el.style.letterSpacing = apply.letterSpacing;
  el.style.textTransform = apply.textTransform;
  queueChange(el, fromId, id);
}

function resetEl(el) {
  if (originalCss.has(el)) {
    const prev = originalCss.get(el);
    if (prev) el.setAttribute('style', prev); else el.removeAttribute('style');
    originalCss.delete(el);
  }
  const key = queuedFor.get(el);
  if (key != null) { changes = changes.filter((c) => c.key !== key); queuedFor.delete(el); save(); renderTray(); }
}

// ── change list / tray ─────────────────────────────────────────────────────
function queueChange(el, fromId, toId) {
  const existingKey = queuedFor.get(el);
  if (existingKey != null) {
    const c = changes.find((x) => x.key === existingKey);
    if (c) { c.to = toId; save(); renderTray(); return; }
  }
  const key = ++seq;
  queuedFor.set(el, key);
  changes.push({ key, from: fromId, to: toId, descriptor: describe(el) });
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
    const from = c.from ? `${c.from} · ${CANONS[c.from - 1].name}` : 'off-canon';
    row.innerHTML = `<span class="ci-row__x" data-k="${c.key}">✕</span>`
      + `<div class="ci-row__map">${from} → <i>${c.to} · ${CANONS[c.to - 1].name}</i></div>`
      + `<div class="ci-row__path">${escapeHtml(c.descriptor.text || c.descriptor.tag)}<br>${escapeHtml(c.descriptor.path)}</div>`;
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
    const from = c.from ? `${c.from}·${CANONS[c.from - 1].name}` : 'off-canon';
    const to = `${c.to}·${CANONS[c.to - 1].name} (.${CANONS[c.to - 1].cls})`;
    return `- ${from} → ${to}\n    текст: ${c.descriptor.text || '—'}\n    класс: ${c.descriptor.className || '—'}\n    путь:  ${c.descriptor.path}`;
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
