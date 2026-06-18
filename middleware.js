// Vercel Edge Middleware — custom link preview (Open Graph) for /join/* links.
//
// Crawlers (Telegram, WhatsApp, Facebook, Twitter/X, Slack, Discord, …) get a
// tiny HTML page with the invite OG tags. Real users get nothing special here
// (the function returns undefined → the request continues to the SPA as usual).
//
// No matcher is used on purpose — the middleware runs on every request and
// guards by pathname internally, which is the most robust setup.

const BOT_RE = /(bot|crawl|spider|facebookexternalhit|facebot|whatsapp|telegram|slack|discord|linkedin|pinterest|vkshare|embedly|skypeuripreview|twitter|googlebot|bingbot|yandex|applebot|redditbot|preview)/i;

const OG_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>You've been invited to a Triplanio trip</title>
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Triplanio">
  <meta property="og:title" content="You've been invited to a Triplanio trip">
  <meta property="og:description" content="See the route, split the budget, and plan together.">
  <meta property="og:image" content="https://www.triplanio.com/og-join.jpg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="You've been invited to a Triplanio trip">
  <meta name="twitter:description" content="See the route, split the budget, and plan together.">
  <meta name="twitter:image" content="https://www.triplanio.com/og-join.jpg">
</head>
<body>You've been invited to a Triplanio trip.</body>
</html>`;

export default function middleware(request) {
  try {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith('/join/')) return; // not an invite link → continue
    const ua = request.headers.get('user-agent') || '';
    if (!BOT_RE.test(ua)) return; // real user → let the SPA load normally
    return new Response(OG_HTML, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'public, max-age=300, s-maxage=300',
      },
    });
  } catch (e) {
    return; // never block a request on an error
  }
}
