import React from 'react';

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

const ICONS = {
  brand: <><path d="M5 5h14v6a8 8 0 0 1-14 0z" fill="currentColor" stroke="none"/><path d="M12 11l-3-3 3 3 3-3" stroke="white" strokeWidth="2"/></>,
  home: <><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/></>,
  collection: <><rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/></>,
  grid: <><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></>,
  list: <><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></>,
  back: <><path d="M15 19l-7-7 7-7"/></>,
  undo: <><path d="M9 7L4 12l5 5"/><path d="M4 12h11a5 5 0 0 1 0 10h-1"/></>,
  chev: <><path d="M9 6l6 6-6 6"/></>,
  chevD: <><path d="M6 9l6 6 6-6"/></>,
  close: <><path d="M6 6l12 12M18 6L6 18"/></>,
  plus: <><path d="M12 5v14M5 12h14"/></>,
  more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  plane: <><path d="M17.8 19.2L16 11l3.5-3.5a2 2 0 10-2.8-2.8L13 8 4.8 6.2a1 1 0 00-.9 1.7l5.6 3.6-2.3 2.3-2.6-.4a.7.7 0 00-.6 1.2l2.4 1.9 1.9 2.4a.7.7 0 001.2-.6l-.4-2.6 2.3-2.3 3.6 5.6a1 1 0 001.7-.9z"/></>,
  train: <><rect x="6" y="4" width="12" height="13" rx="2"/><circle cx="9" cy="18.5" r="1"/><circle cx="15" cy="18.5" r="1"/><path d="M6 10h12"/></>,
  bus: <><rect x="4" y="5" width="16" height="12" rx="2"/><path d="M4 11h16"/><circle cx="8" cy="19" r="1"/><circle cx="16" cy="19" r="1"/></>,
  car: <><path d="M5 16v2M19 16v2"/><rect x="3" y="10" width="18" height="6" rx="2"/><path d="M5 10l2-4h10l2 4"/></>,
  ferry: <><path d="M3 17c2 2 4 0 6 0s4 2 6 0 4 0 6 0"/><path d="M5 14l7-7 7 7"/><path d="M8 14V9h8v5"/></>,
  walk: <><circle cx="13" cy="4" r="1.5"/><path d="M9 22l3-7-3-3v-4l5 1 3 5"/></>,
  bed: <><path d="M3 18V9"/><path d="M21 18v-5"/><path d="M3 13h18v-2a3 3 0 0 0-3-3H8a5 5 0 0 0-5 5z"/><circle cx="7" cy="11.5" r="1.5"/></>,
  cam: <><rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="12" cy="13.5" r="3.5"/><path d="M8 7l1.5-2h5L16 7"/></>,
  cup: <><path d="M5 8h12v6a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5z"/><path d="M17 9h2a2 2 0 0 1 0 4h-2"/></>,
  globe: <><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="9" ry="4"/><path d="M12 3v18"/></>,
  pin: <><path d="M12 22s-7-7.6-7-13a7 7 0 1 1 14 0c0 5.4-7 13-7 13z"/><circle cx="12" cy="9" r="2.5"/></>,
  map: <><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/></>,
  ruler: <><path d="M3.5 14.5l7-7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4l-7 7a1 1 0 0 1-1.4 0L3.5 15.9a1 1 0 0 1 0-1.4z"/><path d="M8 10l1.5 1.5M10.5 7.5L12 9M5.5 12.5L7 14"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M8 3v4M16 3v4"/></>,
  weather: <><circle cx="9" cy="9" r="3.5"/><path d="M5 18h13a3 3 0 0 0 0-6 5 5 0 0 0-9.5-1.5"/></>,
  users: <><circle cx="9" cy="8" r="3.5"/><path d="M3 20c.5-3.5 3-5.5 6-5.5s5.5 2 6 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M15 14c2-.5 4 .5 5 3"/></>,
  user: <><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.5-4 3.5-6 7-6s6.5 2 7 6"/></>,
  chat: <><path d="M4 5h16v11H8l-4 4z"/></>,
  bell: <><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/></>,
  wallet: <><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><circle cx="17" cy="14.5" r="1"/></>,
  card: <><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 11h18"/></>,
  search: <><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/></>,
  filter: <><path d="M4 5h16l-6 8v6l-4-2v-4z"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/></>,
  check: <><path d="M5 13l4 4 10-10"/></>,
  checkSm: <><path d="M5 12l4 4 10-10"/></>,
  link: <><path d="M9 14a4 4 0 0 1 0-5l3-3a4 4 0 0 1 6 6l-1.5 1.5"/><path d="M15 10a4 4 0 0 1 0 5l-3 3a4 4 0 0 1-6-6l1.5-1.5"/></>,
  unlink: <><path d="M18.84 12.25l1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M5.17 11.75l-1.71 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71"/><line x1="8" y1="2" x2="8" y2="5"/><line x1="2" y1="8" x2="5" y2="8"/><line x1="16" y1="19" x2="16" y2="22"/><line x1="19" y1="16" x2="22" y2="16"/></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v11"/></>,
  download: <><path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/></>,
  upload: <><path d="M12 20V8M7 13l5-5 5 5"/><path d="M4 4h16"/></>,
  file: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></>,
  trash: <><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/></>,
  edit: <><path d="M14 4l6 6-11 11H3v-6z"/><path d="M13 5l6 6"/></>,
  share: <><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8 11l8-4M8 13l8 4"/></>,
  sparkles: <><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/><path d="M19 17l.7 1.5L21 19l-1.3.5L19 21l-.7-1.5L17 19l1.3-.5z"/></>,
  spark: <><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/></>,
  ai: <><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/></>,
  warning: <><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 8h.01"/></>,
  error: <><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></>,
  pro: <><path d="M5 7l3 11h8l3-11-4 3-3-5-3 5z"/></>,
  arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
  arrowD: <><path d="M12 5v14M6 13l6 6 6-6"/></>,
  arrowR: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
  arrowSwap: <><path d="M7 7h13l-4-4M17 17H4l4 4"/></>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"/></>,
  moon: <><path d="M20 14a8 8 0 1 1-9-10 7 7 0 0 0 9 10z"/></>,
  drag: <><circle cx="9" cy="6" r=".5"/><circle cx="9" cy="12" r=".5"/><circle cx="9" cy="18" r=".5"/><circle cx="15" cy="6" r=".5"/><circle cx="15" cy="12" r=".5"/><circle cx="15" cy="18" r=".5"/></>,
  esim: <><rect x="6" y="3" width="12" height="18" rx="2"/><path d="M9 18h6"/><path d="M9 7h6v6H9z"/></>,
  shield: <><path d="M12 3l8 3v6c0 4.5-3.5 8-8 9-4.5-1-8-4.5-8-9V6z"/></>,
  refresh: <><path d="M4 12a8 8 0 0 1 14-5l2 2"/><path d="M20 4v5h-5"/><path d="M20 12a8 8 0 0 1-14 5l-2-2"/><path d="M4 20v-5h5"/></>,
  external: <><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/></>,
  telegram: <><path d="M21 4l-3 16-7-5-3 3v-5l11-9-13 8-3-1z" fill="currentColor" stroke="none"/></>,
  thumbUp: <><path d="M7 21V11l4-7c1.5 0 2 1.5 2 3v3h5a2 2 0 0 1 2 2.5l-2 8a2 2 0 0 1-2 1.5H7z"/><path d="M7 11H4v10h3"/></>,
  thumbDown: <><path d="M17 3v10l-4 7c-1.5 0-2-1.5-2-3v-3H6a2 2 0 0 1-2-2.5l2-8A2 2 0 0 1 8 2h9z"/><path d="M17 13h3V3h-3"/></>,
  flag: <><path d="M5 3v18"/><path d="M5 4h12l-2 4 2 4H5"/></>,
  send: <><path d="M3 11l18-7-7 18-3-7z"/></>,
  paperclip: <><path d="M20 11l-8 8a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-7 7a2 2 0 0 1-3-3l6-6"/></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></>,
  eyeOff: <><path d="M3 3l18 18"/><path d="M10 6c.7-.1 1.3-.1 2-.1 6.5 0 10 6.1 10 6.1a16 16 0 0 1-3.5 4M6 7C3.4 8.8 2 12 2 12s3.5 6.1 10 6.1c2 0 3.7-.5 5.2-1.3"/><path d="M14 14a3 3 0 0 1-4-4"/></>,
  vote: <><path d="M4 17l8-12 8 12-8 4z"/><path d="M4 17l8 4 8-4"/></>,
  crown: <><path d="M3 8l3 9h12l3-9-5 3-4-6-4 6z"/><path d="M6 20h12"/></>,
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

export const Icon = ({ name, size = 18, style }) => (
  <_Icon size={size} style={style}>{ICONS[name] || null}</_Icon>
);

export default Icon;
