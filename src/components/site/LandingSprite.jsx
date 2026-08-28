import React from 'react';

/* =========================================================
   LandingSprite — the v5.7 prototype's icon sprite (TRIP-460).
   An off-canvas SVG defs block carrying every symbol id the site zone
   references through use-href — chrome (SiteHeader's #tl-logo/#i-chev) AND
   the landing sections. Lives in components/site (not pages/Landing) because
   SiteChrome renders it once inside SiteHeader — every zone page that mounts
   the shared header (landing, public-trip) gets working symbols for free, no
   per-page plumbing. Verbatim from the prototype sprite, HTML attributes
   converted to JSX (stroke-width to strokeWidth, …). No external assets, no
   hotlinks.
========================================================= */
export default function LandingSprite() {
  return (
    <svg
      width="0" height="0" aria-hidden="true"
      style={{ position: 'absolute' }} // inline-style-exempt: off-canvas sprite defs, декоративный
    >
      <defs>
        <symbol id="i-check" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" d="M4 12.5 9.5 18 20 6.5" /></symbol>
        <symbol id="i-plane" viewBox="0 0 24 24"><path fill="currentColor" d="M21.4 2.6c.5.5.6 1.2.3 1.8l-3.2 6.6 2.6 2.6c.4.4.4 1 0 1.4l-.7.7c-.3.3-.8.4-1.2.2l-3.5-1.5-3.4 3.4.7 2.4c.1.4 0 .8-.3 1.1l-.6.6c-.5.5-1.3.4-1.6-.2l-1.8-3.3-3.3-1.8c-.6-.4-.7-1.2-.2-1.6l.6-.6c.3-.3.7-.4 1.1-.3l2.4.7 3.4-3.4-1.5-3.5c-.2-.4-.1-.9.2-1.2l.7-.7c.4-.4 1-.4 1.4 0l2.6 2.6 6.6-3.2c.6-.3 1.3-.2 1.8.3Z" /></symbol>
        <symbol id="i-map" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4Zm0 0v14m6-12v14" /></symbol>
        <symbol id="i-cal" viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="2" /><path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M8 3v4m8-4v4M3.5 10h17" /></symbol>
        <symbol id="i-doc" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" /><path fill="none" stroke="currentColor" strokeWidth="2" d="M14 3v5h5" /></symbol>
        <symbol id="i-wallet" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" d="M3.5 7.5A2.5 2.5 0 0 1 6 5h11a2 2 0 0 1 2 2v1" /><rect x="3.5" y="8" width="17" height="11" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" /><circle cx="16" cy="13.5" r="1.4" fill="currentColor" /></symbol>
        <symbol id="i-spark" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2.5 14 9l6.5 2L14 13l-2 6.5L10 13l-6.5-2L10 9l2-6.5ZM19 15.5l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3Z" /></symbol>
        <symbol id="i-bell" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M18 9a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9Zm-4.3 10a2 2 0 0 1-3.4 0" /></symbol>
        <symbol id="i-users" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M16.5 20v-1.8a3.6 3.6 0 0 0-3.6-3.6H6.6A3.6 3.6 0 0 0 3 18.2V20" /><circle cx="9.75" cy="7.5" r="3.5" fill="none" stroke="currentColor" strokeWidth="2" /><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M21 20v-1.8a3.6 3.6 0 0 0-2.7-3.48M15.2 4.2a3.5 3.5 0 0 1 0 6.6" /></symbol>
        <symbol id="i-chat" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" d="M21 12a8.5 8.5 0 0 1-12.4 7.5L3.5 21l1.5-5.1A8.5 8.5 0 1 1 21 12Z" /></symbol>
        <symbol id="i-globe" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="2" /><path fill="none" stroke="currentColor" strokeWidth="2" d="M3.5 12h17M12 3.5c2.4 2.3 3.6 5.2 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.2-3.6-8.5s1.2-6.2 3.6-8.5Z" /></symbol>
        <symbol id="i-pin" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" /><circle cx="12" cy="10" r="2.6" fill="none" stroke="currentColor" strokeWidth="2" /></symbol>
        <symbol id="i-shield" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" d="M12 3 5 6v5.5c0 4.5 3 8 7 9.5 4-1.5 7-5 7-9.5V6l-7-3Z" /><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="m9 12 2 2 4-4.5" /></symbol>
        <symbol id="i-tg" viewBox="0 0 24 24"><path fill="currentColor" d="M21.7 4.4 2.9 11.6c-.9.35-.85 1.6.05 1.9l4.7 1.5 1.8 5.6c.25.8 1.3 1 1.85.4l2.6-2.85 4.9 3.6c.7.5 1.7.1 1.85-.75l3-15.1c.2-1-.75-1.8-1.95-1.5ZM8.7 14.55l9.3-6.9c.25-.2.5.15.3.35l-7.6 7.3-.3 3.2-1.7-3.95Z" /></symbol>
        <symbol id="i-chev" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" /></symbol>
        <symbol id="i-arrow-r" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" d="M4 12h15m-6-7 7 7-7 7" /></symbol>
        <symbol id="i-ticks" viewBox="0 0 18 12"><g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M1 6.4 4.3 9.8 11.2 2" /><path d="M6.6 6.4 9.9 9.8 16.8 2" /></g></symbol>
        <symbol id="i-bed" viewBox="0 0 24 24"><path fill="currentColor" d="M3.4 5.5a1.4 1.4 0 0 0-1.4 1.4V19a1.4 1.4 0 0 0 2.8 0v-2.2h14.4V19a1.4 1.4 0 0 0 2.8 0v-4.4a4.6 4.6 0 0 0-4.6-4.6h-7.6v4.2H4.8V6.9a1.4 1.4 0 0 0-1.4-1.4Z" /><circle cx="7.4" cy="10.6" r="2.6" fill="currentColor" /></symbol>
        <symbol id="i-train" viewBox="0 0 24 24"><path fill="currentColor" d="M8 2.5h8A4.5 4.5 0 0 1 20.5 7v8a4.5 4.5 0 0 1-4.5 4.5H8A4.5 4.5 0 0 1 3.5 15V7A4.5 4.5 0 0 1 8 2.5Zm-2 4.9v2.9h12V7.4H6Zm2.6 5.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Zm6.8 0a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z" /><path fill="currentColor" d="M7.9 20.6 6.3 22.9a1 1 0 1 1-1.6-1.2l1.4-2h1.8Zm8.2 0 1.6 2.3a1 1 0 1 0 1.6-1.2l-1.4-2h-1.8Z" /></symbol>
        <symbol id="i-print" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6.5 9V3.5h11V9" /><rect x="3.5" y="9" width="17" height="7.5" rx="2" /><path d="M6.5 14h11v6.5h-11z" /></symbol>
        <symbol id="i-flag" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3v18" /><path d="M5 4h12l-2 4 2 4H5" /></symbol>
        <symbol id="i-swap" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 7h13l-4-4M17 17H4l4 4" /></symbol>
        <symbol id="i-route" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="19" r="2.4" /><circle cx="18" cy="5" r="2.4" /><path d="M8.4 19h6.1a3.5 3.5 0 0 0 0-7H9.5a3.5 3.5 0 0 1 0-7h6.1" /></symbol>
        <symbol id="i-globe2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.6" fill="currentColor" fillOpacity=".22" /><circle cx="12" cy="12" r="8.6" /><path d="M3.4 12h17.2M12 3.4a14 14 0 0 1 0 17.2a14 14 0 0 1 0-17.2z" /></symbol>
        <symbol id="i-cal2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="5" width="17" height="16" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /></symbol>
        <symbol id="i-pin2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z" /><circle cx="12" cy="10" r="2.6" /></symbol>
        <symbol id="i-pinoff" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s7-6.3 7-11a7 7 0 0 0-11.6-5.3" /><path d="M5.6 7.4A7 7 0 0 0 5 10c0 4.7 7 11 7 11" /><path d="M3 3l18 18" /></symbol>
        <symbol id="i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.6 6.6 0 0 0 10.5 10.5z" /></symbol>
        <symbol id="i-bus" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="13" rx="2.5" /><path d="M4 10h16M7 20v1M17 20v1M8 16h.01M16 16h.01" /></symbol>
        <symbol id="i-car" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 17h14M4 17v-4l2-5h12l2 5v4" /><circle cx="7.5" cy="17.5" r="1.6" /><circle cx="16.5" cy="17.5" r="1.6" /></symbol>
        <symbol id="i-ferry" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 18.5c1.6 0 1.6 1.2 3.2 1.2s1.6-1.2 3.2-1.2 1.6 1.2 3.2 1.2 1.6-1.2 3.2-1.2 1.6 1.2 3.2 1.2" /><path d="M5 15l1.6-5.2h10.8L19 15" /><path d="M12 9.8V5M9 5h6" /></symbol>
        <symbol id="i-walk" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="13" cy="4.5" r="1.8" /><path d="M11 21l1.6-5.4L10 13l1-5 3.5 2 2.5 1M10 8l-3 2-1 3M12.6 15.6 16 21" /></symbol>
        <symbol id="i-lock" viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" /><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></symbol>
        {/* Бренд-марка (TRIP-479) — единственная копия геометрии логотипа в коде.
            Мастер = public/triplanio-logo.svg (он же favicon и источник растров);
            здесь его rect+path перенесены как есть, причёсано только обрамление
            тегов под стиль остального спрайта. Значения (координаты, rx, `white`
            вместо `#fff`) НЕ править руками — они едут вслед за мастером.
            viewBox символа продублирован у тех потребителей, кто его указывает
            (SiteChrome ×2, LandingPage ×3) — менять вместе; AuthShell и строка
            landing.pn.divider viewBox не задают и берут его отсюда. */}
        <symbol id="tl-logo" viewBox="0 0 192 192">
          <rect x="0.0800781" width="191.92" height="192" rx="26" fill="#2173C8" />{/* design-token-exempt: бренд-лого Triplanio, синий плитки задан мастером public/triplanio-logo.svg */}
          <path d="M53.2658 191.999C47.2075 185.614 43.0626 178.555 42.2345 169.764C41.1672 158.435 44.5256 148.248 50.4785 138.86C53.2175 134.541 56.5994 130.629 59.8989 126.255C56.3831 123.705 52.7568 121.088 49.1467 118.45C45.918 116.091 45.9916 115.647 48.943 113.099C51.9852 110.472 55.0573 109.897 58.7377 111.764C61.7318 113.283 64.8998 114.477 68.0512 115.653C68.705 115.897 69.9652 115.715 70.3725 115.239C76.9489 107.55 83.4339 99.7834 89.9295 92.0256C90.0973 91.8252 90.1505 91.5286 90.2581 91.2747C77.8783 78.9646 65.5295 66.6853 53.2073 54.4324C58.84 48.022 65.7986 47.6452 71.3307 53.1655C94.2998 76.0857 117.255 99.0198 140.176 121.989C145.947 127.772 145.852 135.139 140.067 140.481C127.768 128.161 115.466 115.838 102.942 103.293C101.232 104.763 99.7778 106.029 98.3062 107.274C92.0806 112.541 85.8738 117.831 79.6013 123.042C78.2509 124.164 77.8641 125.109 78.6835 126.825C80.3743 130.365 81.8867 134.001 83.2803 137.671C84.4344 140.71 82.1727 146.012 79.2168 147.185C78.6184 147.423 77.3038 146.824 76.8183 146.213C74.4281 143.208 72.2151 140.062 69.9197 136.981C69.1515 135.95 68.3244 134.963 67.4475 133.859C58.6227 142.894 52.3907 152.907 52.3899 165.733C52.3892 178.133 60.2744 187.973 72.317 191.079C73.132 191.29 74.0324 191.59 74.9342 191.999C67.899 191.999 60.6703 191.999 53.2658 191.999Z" fill="white" />
          <path d="M0.0799632 120.871C0.353192 121.05 0.727088 121.461 0.885108 121.942C6.70177 139.65 22.0306 147.122 39.5881 140.781C40.9625 140.285 42.3146 139.726 44.0592 139.048C42.3655 143.28 40.9016 147.156 39.2168 150.934C38.9324 151.571 37.7378 151.978 36.8919 152.163C22.8284 155.245 10.4002 151.958 0.0796956 141.451C-0.0999856 134.624 0.0799632 127.903 0.0799632 120.871Z" fill="white" />
          <path d="M116.065 68.1987C130.422 82.4981 144.421 96.8842 158.939 110.726C167.039 118.449 166.723 125.439 160.577 133.892C127.065 100.366 93.5061 66.7943 59.8477 33.1226C62.3184 30.7024 65.8109 28.8707 69.8827 28.2857C73.515 27.7638 76.6361 28.7633 79.3245 31.4713C91.4779 43.713 103.716 55.8702 116.065 68.1987Z" fill="white" />
          <path d="M134.356 49.9223C136.448 49.3488 138.326 48.6228 140.25 48.4688C144.059 48.164 145.868 50.0916 145.511 53.8847C145.079 58.4704 143.347 62.6296 140.556 66.2313C137.874 69.6918 134.87 72.9032 131.729 76.548C129.278 74.0501 127.074 71.8048 124.871 69.5594C122.647 67.293 120.424 65.0265 117.976 62.5311C122.735 57.5603 127.59 52.7165 134.356 49.9223Z" fill="white" />
        </symbol>
        {/* Demo-trip section icons (TRIP-462) — extend the zone sprite so the
            demo page reuses the shared header's sprite, no per-page plumbing. */}
        <symbol id="i-buildings" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" d="M3.5 20.5V9.2l6-3.4v14.7M9.5 20.5V4l7 3.6v12.9M16.5 20.5V11l4 2v7.5M2 20.5h20" /></symbol>
        <symbol id="i-card-sim" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" d="M5.5 3.8h8.1L18.5 8.7V20.2a1 1 0 0 1-1 1h-12a1 1 0 0 1-1-1V4.8a1 1 0 0 1 1-1Z" /><rect x="8" y="11.4" width="8" height="6.4" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.8" /></symbol>
        <symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" strokeWidth="2" /><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M12 7.2V12l3.4 2" /></symbol>
        <symbol id="i-crown" viewBox="0 0 24 24"><path fill="currentColor" d="M3 8.2 6.6 11l3.6-5.4a2 2 0 0 1 3.6 0L17.4 11 21 8.2c.9-.7 2.1.1 1.8 1.2l-2 8a2 2 0 0 1-2 1.5H5.2a2 2 0 0 1-1.9-1.5l-2-8C1 8.3 2.1 7.5 3 8.2Z" /></symbol>
        <symbol id="i-food" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M6.4 3.4v7.2a2.6 2.6 0 0 0 5.2 0V3.4M9 3.4v7M17.6 3.4c-1.4 1.1-2.1 3-2.1 5.2 0 1.7.7 2.6 2.1 2.8V3.4Zm0 7.8V20.6M9 13.2V20.6" /></symbol>
        <symbol id="i-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" /><path stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" d="M12 11v5.4" /><circle cx="12" cy="7.7" r="1.2" fill="currentColor" /></symbol>
        <symbol id="i-mail" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.9" /><path fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" d="m4 7.6 8 5.8 8-5.8" /></symbol>
        <symbol id="i-plus" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" d="M12 5.5v13M5.5 12h13" /></symbol>
        <symbol id="i-send" viewBox="0 0 24 24"><path fill="currentColor" d="M3.6 11.1 20 3.4c.9-.4 1.8.5 1.4 1.4l-7.7 16.4c-.4.9-1.7.8-2-.2l-1.8-5.6-5.6-1.8c-1-.3-1.1-1.6-.2-2Z" /></symbol>
        <symbol id="i-ticket" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" d="M3 8.4V6.5a1.5 1.5 0 0 1 1.5-1.5h15A1.5 1.5 0 0 1 21 6.5v1.9a2.6 2.6 0 0 0 0 5.2v3.9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-3.9a2.6 2.6 0 0 0 0-5.2Z" /><path stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeDasharray="1.6 3.2" d="M14.4 5.6v12.8" /></symbol>
        <symbol id="i-warning" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" d="M12 3.6 1.9 20.4h20.2L12 3.6Z" /><path stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" d="M12 10v4" /><circle cx="12" cy="17.2" r="1.2" fill="currentColor" /></symbol>
      </defs>
    </svg>
  );
}
