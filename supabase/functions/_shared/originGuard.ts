/**
 * originGuard — общая проверка Origin для функций, которые строят ссылки возврата
 * на публичный фронт (createStripeCheckout success/cancel URL, createBillingPortal
 * return URL). Идентичный блок жил в обеих функциях.
 *
 * Возвращает { publicAppUrl } при успехе, либо готовый Response:
 *   - 500, если PUBLIC_APP_URL не задан (мисконфиг сервера);
 *   - 400, если Origin запроса задан и не совпадает с PUBLIC_APP_URL.
 * Пустой/отсутствующий Origin (server-to-server, same-origin) пропускается — как и раньше.
 */
export function originGuard(
  req: Request,
  corsHeaders: HeadersInit,
): { publicAppUrl: string } | Response {
  const publicAppUrl = (Deno.env.get('PUBLIC_APP_URL') || '').replace(/\/+$/, '');
  if (!publicAppUrl) {
    console.error('PUBLIC_APP_URL not configured');
    return Response.json(
      { error: 'Server misconfigured: PUBLIC_APP_URL missing' },
      { status: 500, headers: corsHeaders },
    );
  }
  const reqOrigin = (req.headers.get('origin') || '').replace(/\/+$/, '');
  if (reqOrigin && reqOrigin !== publicAppUrl) {
    console.error('Origin mismatch:', reqOrigin, 'vs', publicAppUrl);
    return Response.json(
      { error: 'Origin not allowed' },
      { status: 400, headers: corsHeaders },
    );
  }
  return { publicAppUrl };
}
