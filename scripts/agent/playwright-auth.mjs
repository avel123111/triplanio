// Готовит файл сессии для Playwright MCP: проходит Vercel Deployment Protection
// по bypass-секрету (защита остаётся включённой) и логинится в приложение
// тестовым пользователем dev. Секреты берутся из окружения и не печатаются.
//
// Запускается автоматически из scripts/agent/playwright-mcp.sh, когда файла нет
// или он старше недели. Вручную:
//   npx -y -p @playwright/mcp@0.0.78 sh -c 'NODE_PATH=$(echo "$PATH" | cut -d: -f1 | \
//     sed "s#/\.bin\$##") node scripts/agent/playwright-auth.mjs'
//
// Окружение (задаётся в Railway, рядом с остальными секретами Cyrus):
//   VERCEL_BYPASS_SECRET  Protection Bypass for Automation проекта Vercel
//   PW_TEST_EMAIL         тестовый пользователь dev-Supabase (одноразовый!)
//   PW_TEST_PASSWORD
//   PW_HOST               по умолчанию https://dev.triplanio.com
//   PW_STATE_OUT          по умолчанию /data/.cyrus-playwright-auth.json
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright-core');

const HOST = process.env.PW_HOST || 'https://dev.triplanio.com';
const OUT = process.env.PW_STATE_OUT || '/data/.cyrus-playwright-auth.json';
const { VERCEL_BYPASS_SECRET: BYPASS, PW_TEST_EMAIL: EMAIL, PW_TEST_PASSWORD: PASSWORD } = process.env;

const missing = [
  !BYPASS && 'VERCEL_BYPASS_SECRET',
  !EMAIL && 'PW_TEST_EMAIL',
  !PASSWORD && 'PW_TEST_PASSWORD',
].filter(Boolean);
if (missing.length) throw new Error(`нет переменных окружения: ${missing.join(', ')}`);

const browser = await chromium.launch({ headless: true });
try {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Переход с bypass-параметрами отдаёт Set-Cookie, дальше сайт открыт как обычно.
  await page.goto(
    `${HOST}/?x-vercel-protection-bypass=${encodeURIComponent(BYPASS)}&x-vercel-set-bypass-cookie=true`,
    { waitUntil: 'domcontentloaded' },
  );
  if (page.url().includes('vercel.com/sso-api')) throw new Error('bypass не сработал, Vercel всё ещё требует SSO');

  await page.goto(`${HOST}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#l-email', { timeout: 30000 });

  // Баннер согласия перекрывает форму - отвечаем на него, как обычный пользователь.
  const banner = page.getByRole('button', { name: /Necessary only|Только необходимые|Solo lo necesario/i });
  if (await banner.count()) await banner.first().click();

  await page.fill('#l-email', EMAIL);
  await page.fill('#l-pw', PASSWORD);
  await page.press('#l-pw', 'Enter');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30000 });

  const authed = await page.evaluate(() =>
    Object.keys(localStorage).some((k) => k.startsWith('sb-') && k.includes('auth-token')));
  if (!authed) throw new Error('форма принята, но сессии Supabase в localStorage нет');

  await ctx.storageState({ path: OUT });
  console.log(`playwright-auth: сессия сохранена в ${OUT} (вход выполнен, ${page.url()})`);
} finally {
  await browser.close();
}
