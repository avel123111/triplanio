import React from 'react';
import {
  Plus, TriangleAlert, X, ChevronRight, ArrowLeft, MapPin, FileText, Check, Info,
  Sparkles, Lock, Camera, Wallet, Trash2, ExternalLink, Calendar, BedDouble, Users,
  Pencil, ArrowRight, Sparkle, Ellipsis, Map, Link, Flag, MessageCircle, Bell, User,
  Share2, Send, Search, Plane, Paperclip, Moon, List, LayoutGrid, Globe,
  GripVertical, Crown, ArrowRightLeft, Upload, TrainFront, Sun, Shield, RefreshCw,
  ChevronUp, ChevronDown, Menu, Compass, MonitorSmartphone, Waypoints, Gift,
  Ticket, Route, ShieldCheck, Car,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Единый источник иконок.
//   1) BRAND  — бренд/eSIM-глифы (нет в lucide): Simple Icons + Phosphor.
//   2) LUCIDE — карта name → компонент lucide (единый stroke=2).
//   3) ICONS  — легаси-набор; используется только как fallback для имён,
//               которых нет в LUCIDE/BRAND (мёртвые глифы — оставлены про запас).
// ─────────────────────────────────────────────────────────────────────────────

const _Icon = ({ size = 18, children, style }) => (
  <svg
    width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.6"
    strokeLinecap="round" strokeLinejoin="round"
    style={style}
  >
    {children}
  </svg>
);

// ── Бренд-иконки (официальные глифы) ─────────────────────────────────────────
// Цвет управляется через currentColor: по умолчанию наследуется от родителя,
// фирменный цвет задаётся пропом color (см. использования в футере/бренд-контексте).
const brandSvg = (size, style, className, color, vb = '0 0 24 24') => ({
  width: size, height: size, viewBox: vb, xmlns: 'http://www.w3.org/2000/svg',
  fill: 'currentColor', className, 'aria-hidden': true,
  style: color ? { color, ...style } : style,
});

const BRAND = {
  // Simple Icons (CC0)
  telegram: ({ size = 18, style, className, color }) => (
    <svg {...brandSvg(size, style, className, color)}><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" /></svg>
  ),
  // Twitter → актуальный логотип X (фирменный чёрный невидим в тёмной теме → currentColor)
  twitter: ({ size = 18, style, className, color }) => (
    <svg {...brandSvg(size, style, className, color)}><path d="M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z" /></svg>
  ),
  instagram: ({ size = 18, style, className, color }) => (
    <svg {...brandSvg(size, style, className, color)}><path d="M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077" /></svg>
  ),
  whatsapp: ({ size = 18, style, className, color }) => (
    <svg {...brandSvg(size, style, className, color)}><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" /></svg>
  ),
  // Phosphor (MIT) — eSIM (виборбокс 256, заливка, монохром)
  esim: ({ size = 18, style, className, color }) => (
    <svg {...brandSvg(size, style, className, color, '0 0 256 256')}><path d="M213.66,82.34l-56-56A8,8,0,0,0,152,24H56A16,16,0,0,0,40,40V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V88A8,8,0,0,0,213.66,82.34ZM200,216H56V40h92.69L200,91.31V216ZM176,112H80a8,8,0,0,0-8,8v72a8,8,0,0,0,8,8h96a8,8,0,0,0,8-8V120A8,8,0,0,0,176,112Zm-8,72H152V152a8,8,0,0,0-16,0v32H120V152a8,8,0,0,0-16,0v32H88V128h80Z" /></svg>
  ),
};

// ── lucide-иконки новее нашей версии 0.475 — инлайн-SVG из lucide 1.21 ────────
// (folder-bookmark, card-sim). Тот же stroke-стиль, что у lucide.
const strokeSvg = (size, style, className, color, strokeWidth) => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
  stroke: color || 'currentColor', strokeWidth, strokeLinecap: 'round',
  strokeLinejoin: 'round', className, style, 'aria-hidden': true,
});
const FolderBookmark = ({ size = 24, style, className, color, strokeWidth = 2 }) => (
  <svg {...strokeSvg(size, style, className, color, strokeWidth)}>
    <path d="M12 6v8l3-3 3 3V6" />
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z" />
  </svg>
);
const CardSim = ({ size = 24, style, className, color, strokeWidth = 2 }) => (
  <svg {...strokeSvg(size, style, className, color, strokeWidth)}>
    <path d="M12 14v4" />
    <path d="M14.172 2a2 2 0 0 1 1.414.586l3.828 3.828A2 2 0 0 1 20 7.828V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
    <path d="M8 14h8" />
    <rect x="8" y="10" width="8" height="8" rx="1" />
  </svg>
);
export { FolderBookmark, CardSim };

// ── Карта name → lucide ──────────────────────────────────────────────────────
const LUCIDE = {
  plus: Plus, warning: TriangleAlert, close: X, chev: ChevronRight, back: ArrowLeft,
  pin: MapPin, file: FileText, check: Check, info: Info, sparkles: Sparkles, lock: Lock,
  cam: Camera, wallet: Wallet, trash: Trash2, external: ExternalLink, calendar: Calendar,
  bed: BedDouble, users: Users, edit: Pencil, arrowR: ArrowRight, spark: Sparkle,
  more: Ellipsis, map: Map, link: Link, flag: Flag, chat: MessageCircle, bell: Bell,
  user: User, share: Share2, send: Send, search: Search, pro: Crown, plane: Plane,
  paperclip: Paperclip, moon: Moon, list: List, grid: LayoutGrid, globe: Globe,
  drag: GripVertical, crown: Crown, arrowSwap: ArrowRightLeft, arrowRight: ArrowRight,
  upload: Upload, train: TrainFront, sun: Sun, shield: Shield, refresh: RefreshCw,
  chevron: ChevronRight, chevU: ChevronUp, chevD: ChevronDown, arrow: ArrowRight,
  menu: Menu,
  // имена из лендинга (фичи/списки)
  gift: Gift, devices: MonitorSmartphone, timeline: Waypoints, compass: Compass,
  // правки иконок событий (2026-06-18)
  ticket: Ticket, route: Route, 'shield-check': ShieldCheck, car: Car,
  'folder-bookmark': FolderBookmark, 'card-sim': CardSim,
};

// ── Легаси-набор (fallback для имён вне LUCIDE/BRAND) ─────────────────────────
const ICONS = {
  brand: <><path d="M5 5h14v6a8 8 0 0 1-14 0z" fill="currentColor" stroke="none"/><path d="M12 11l-3-3 3 3 3-3" stroke="white" strokeWidth="2"/></>,
  home: <><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/></>,
  collection: <><rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/></>,
  undo: <><path d="M9 7L4 12l5 5"/><path d="M4 12h11a5 5 0 0 1 0 10h-1"/></>,
  bus: <><rect x="4" y="5" width="16" height="12" rx="2"/><path d="M4 11h16"/><circle cx="8" cy="19" r="1"/><circle cx="16" cy="19" r="1"/></>,
  car: <><path d="M5 16v2M19 16v2"/><rect x="3" y="10" width="18" height="6" rx="2"/><path d="M5 10l2-4h10l2 4"/></>,
  ferry: <><path d="M3 17c2 2 4 0 6 0s4 2 6 0 4 0 6 0"/><path d="M5 14l7-7 7 7"/><path d="M8 14V9h8v5"/></>,
  walk: <><circle cx="13" cy="4" r="1.5"/><path d="M9 22l3-7-3-3v-4l5 1 3 5"/></>,
  cup: <><path d="M5 8h12v6a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5z"/><path d="M17 9h2a2 2 0 0 1 0 4h-2"/></>,
  ruler: <><path d="M3.5 14.5l7-7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4l-7 7a1 1 0 0 1-1.4 0L3.5 15.9a1 1 0 0 1 0-1.4z"/><path d="M8 10l1.5 1.5M10.5 7.5L12 9M5.5 12.5L7 14"/></>,
  card: <><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 11h18"/></>,
  filter: <><path d="M4 5h16l-6 8v6l-4-2v-4z"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/></>,
  checkSm: <><path d="M5 12l4 4 10-10"/></>,
  unlink: <><path d="M18.84 12.25l1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M5.17 11.75l-1.71 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71"/><line x1="8" y1="2" x2="8" y2="5"/><line x1="2" y1="8" x2="5" y2="8"/><line x1="16" y1="19" x2="16" y2="22"/><line x1="19" y1="16" x2="22" y2="16"/></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v11"/></>,
  download: <><path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/></>,
  arrowD: <><path d="M12 5v14M6 13l6 6 6-6"/></>,
  ai: <><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/></>,
  error: <><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></>,
  thumbUp: <><path d="M7 21V11l4-7c1.5 0 2 1.5 2 3v3h5a2 2 0 0 1 2 2.5l-2 8a2 2 0 0 1-2 1.5H7z"/><path d="M7 11H4v10h3"/></>,
  thumbDown: <><path d="M17 3v10l-4 7c-1.5 0-2-1.5-2-3v-3H6a2 2 0 0 1-2-2.5l2-8A2 2 0 0 1 8 2h9z"/><path d="M17 13h3V3h-3"/></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></>,
  eyeOff: <><path d="M3 3l18 18"/><path d="M10 6c.7-.1 1.3-.1 2-.1 6.5 0 10 6.1 10 6.1a16 16 0 0 1-3.5 4M6 7C3.4 8.8 2 12 2 12s3.5 6.1 10 6.1c2 0 3.7-.5 5.2-1.3"/><path d="M14 14a3 3 0 0 1-4-4"/></>,
  vote: <><path d="M4 17l8-12 8 12-8 4z"/><path d="M4 17l8 4 8-4"/></>,
  cloud: <><path d="M6 18h11a4 4 0 0 0 0-8 5 5 0 0 0-9.5-1.5A4 4 0 0 0 6 18z"/></>,
  'cloud-sun': <><circle cx="6" cy="8" r="2.5"/><path d="M3 8h.5M8.5 5l.4-.4M8.5 11l.4.4M2.6 11l.4-.4"/><path d="M9 18h10a3.5 3.5 0 0 0 0-7 4.5 4.5 0 0 0-8.5-1A3.5 3.5 0 0 0 9 18z"/></>,
  rain: <><path d="M6 14h11a4 4 0 0 0 0-8 5 5 0 0 0-9.5-1.5A4 4 0 0 0 6 14z"/><path d="M9 18l-1 3M13 18l-1 3M17 18l-1 3"/></>,
  picture: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9.5" r="2"/><path d="M3 17l5-4 4 3 4-5 5 5"/></>,
  notification: <><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/></>,
  pdf: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M8 14h2a1 1 0 0 1 0 2H8v-2zM8 14v4M13 18v-4h1.5a1.5 1.5 0 0 1 0 3H13"/></>,
  excel: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13l4 5M13 13l-4 5"/></>,
  rocket: <><path d="M12 3c4 2 6 6 6 11l-3 3-3-2-3 2-3-3c0-5 2-9 6-11z"/><circle cx="12" cy="10" r="1.5"/><path d="M8 19l-2 2 4-1M16 19l2 2-4-1"/></>,
  thermo: <><path d="M12 3a2 2 0 0 1 2 2v9a4 4 0 1 1-4 0V5a2 2 0 0 1 2-2z"/><circle cx="12" cy="17.5" r="1.5" fill="currentColor"/></>,
  globe2: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></>,
  gift: <><rect x="3" y="8" width="18" height="13" rx="2"/><path d="M3 12h18"/><path d="M12 8V3M8 8S7 3 12 3s4 5 4 5"/></>,
};

// ── Единый компонент Icon ────────────────────────────────────────────────────
export const Icon = ({ name, size = 18, style, className, color, strokeWidth = 2 }) => {
  const Brand = BRAND[name];
  if (Brand) return <Brand size={size} style={style} className={className} color={color} />;

  const L = LUCIDE[name];
  if (L) return <L size={size} color={color} style={style} className={className} strokeWidth={strokeWidth} />;

  // Fallback: легаси-глиф (мёртвые имена оставлены про запас)
  return <_Icon size={size} style={color ? { color, ...style } : style}>{ICONS[name] || null}</_Icon>;
};

export default Icon;
