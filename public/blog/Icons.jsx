/* global React */
/* Triplanio icon set (monoline, 1.6 stroke) + blog additions */
const Icon = ({ name, size = 20, stroke = "currentColor", strokeWidth = 1.6, fill = "none", ...rest }) => {
  const paths = {
    compass: (<><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5 5-2z" /></>),
    timeline: (<><circle cx="6" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><path d="M6 8v8" /><path d="M10 6h10" /><path d="M10 12h7" /><path d="M10 18h10" /></>),
    users: (<><circle cx="9" cy="8" r="3.2" /><path d="M3 19c0-3 2.7-5 6-5s6 2 6 5" /><circle cx="17" cy="9" r="2.6" /><path d="M15 14c3 0 6 1.8 6 5" /></>),
    sparkles: (<><path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6L12 4z" /><path d="M19 16l.7 1.9L21.6 18.6 19.7 19.3 19 21.2 18.3 19.3 16.4 18.6 18.3 17.9 19 16z" /></>),
    chat: (<><path d="M21 12a8 8 0 1 1-3.1-6.3" /><path d="M21 5v4h-4" /><path d="M8 11h.01M12 11h.01M16 11h.01" /></>),
    wallet: (<><path d="M3 7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v2H5a2 2 0 0 1-2-2z" /><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7H7a2 2 0 0 1-2-2" /><circle cx="16" cy="14" r="1.4" /></>),
    globe: (<><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>),
    lock: (<><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>),
    map: (<><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" /><path d="M9 4v14M15 6v14" /></>),
    calendar: (<><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16" /><path d="M9 3v4M15 3v4" /></>),
    bed: (<><path d="M3 18v-7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v7" /><path d="M3 14h18" /><path d="M3 18v3M21 18v3" /><circle cx="8" cy="11.5" r="1.4" /></>),
    plane: <path d="M21 12.5 3 18l4-5-4-5 18 5.5a.5.5 0 0 1 0 1z" />,
    cam: (<><rect x="3" y="7" width="18" height="13" rx="2" /><circle cx="12" cy="13.5" r="3.5" /><path d="M8 7l1.5-2h5L16 7" /></>),
    check: <path d="m5 12 4 4 10-10" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
    chevron: <path d="m9 6 6 6-6 6" />,
    chevronDown: <path d="m6 9 6 6 6-6" />,
    plus: (<><path d="M12 5v14" /><path d="M5 12h14" /></>),
    minus: <path d="M5 12h14" />,
    menu: (<><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></>),
    close: (<><path d="m6 6 12 12" /><path d="M18 6 6 18" /></>),
    arrowRight: (<><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>),
    arrowLeft: (<><path d="M19 12H5" /><path d="m11 18-6-6 6-6" /></>),
    arrowUp: (<><path d="M12 19V5" /><path d="m6 11 6-6 6 6" /></>),
    /* blog additions */
    search: (<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></>),
    bookmark: <path d="M6 4h12a1 1 0 0 1 1 1v15l-7-4-7 4V5a1 1 0 0 1 1-1z" />,
    share: (<><circle cx="6" cy="12" r="2.6" /><circle cx="17" cy="6" r="2.6" /><circle cx="17" cy="18" r="2.6" /><path d="M8.3 10.8l6.4-3.6M8.3 13.2l6.4 3.6" /></>),
    link: (<><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5" /></>),
    filter: (<><path d="M4 6h16" /><path d="M7 12h10" /><path d="M10 18h4" /></>),
    sort: (<><path d="M4 7h16" /><path d="M6 12h12" /><path d="M9 17h6" /></>),
    sun: (<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>),
    moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
    clock: (<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
    pin: (<><path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></>),
    star: <path d="m12 4 2.3 4.8 5.2.7-3.8 3.6.9 5.2L12 16l-4.6 2.3.9-5.2L4.5 9.5l5.2-.7L12 4z" />,
    grid: (<><rect x="4" y="4" width="7" height="7" rx="1.4" /><rect x="13" y="4" width="7" height="7" rx="1.4" /><rect x="4" y="13" width="7" height="7" rx="1.4" /><rect x="13" y="13" width="7" height="7" rx="1.4" /></>),
    list: (<><path d="M8 6h12M8 12h12M8 18h12" /><circle cx="4" cy="6" r="1" fill="currentColor" stroke="none" /><circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="4" cy="18" r="1" fill="currentColor" stroke="none" /></>),
    monitor: (<><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>),
    phone: (<><rect x="7" y="3" width="10" height="18" rx="2.4" /><path d="M11 18h2" /></>),
    home: (<><path d="M4 11l8-7 8 7" /><path d="M6 10v9h12v-9" /></>),
    passport: (<><rect x="5" y="3" width="14" height="18" rx="2" /><circle cx="12" cy="10" r="3" /><path d="M9 17h6" /></>),
    coffee: (<><path d="M4 8h13v5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8z" /><path d="M17 9h2.5a2.5 2.5 0 0 1 0 5H17" /><path d="M7 3v2M11 3v2" /></>),
    ticket: (<><path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2H6a2 2 0 0 1-2-2 2 2 0 0 0 0-4z" /><path d="M14 6v12" /></>),
    eye: (<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></>),
    telegram: <path d="m4 12 16-7-3 16-5-5-2.5 4-1-5L4 12Z" fill="currentColor" stroke="none" />,
    whatsapp: <path d="M12 3a9 9 0 0 0-7.7 13.6L3 21l4.6-1.2A9 9 0 1 0 12 3Zm5.1 12.7c-.2.6-1.2 1.1-1.7 1.2-.5.1-1 .1-1.5 0a7.3 7.3 0 0 1-2.8-1.3 9 9 0 0 1-2.8-3.3c-.3-.5-.5-1-.5-1.5 0-.6.3-1 .5-1.2.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .5.4l.7 1.6c.1.3 0 .5-.1.7l-.4.5c-.1.2-.3.3-.1.6.2.4.7 1.1 1.3 1.6.7.6 1.4.9 1.7 1 .3.1.5.1.7-.1l.6-.7c.2-.2.4-.2.6-.1l1.5.7c.3.2.4.3.4.4.1.1.1.6 0 1.2Z" fill="currentColor" stroke="none" />,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke}
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {paths[name]}
    </svg>
  );
};

const TriplanioMark = ({ size = 28 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <rect width="24" height="24" rx="6" fill="var(--brand)" />
    <path d="M7 8h10M12 8v9M9 13l3-2 3 2" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
  </svg>
);

window.Icon = Icon;
window.TriplanioMark = TriplanioMark;
