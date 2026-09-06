// Браузер для выпечки — там, где идёт сборка (TRIP-520).
//
// ★ ПОЧЕМУ ЭТОТ ФАЙЛ ВООБЩЕ СУЩЕСТВУЕТ. Фронт собирается НА СТОРОНЕ VERCEL, а не
// в Actions, и это осознанное решение TRIP-134: часть переменных сборки помечена
// Sensitive и приезжает ТОЛЬКО во время сборки на платформе — собери мы локально
// с `--prebuilt`, в бандл уехали бы пустые `VITE_*` и белый экран. Значит и
// выпечка идёт там же, а в сборочном контейнере Vercel браузера нет.
//
// ★ ПОЧЕМУ НЕ ЗАВИСИМОСТЬЮ `playwright`. Полный пакет тянет chromium, firefox и
// webkit — полгигабайта на КАЖДУЮ установку, включая машину каждого
// разработчика, ради одного chromium в CI. Здесь ставится ровно он и ровно той
// версии, что уже стоит в `playwright-core`: разъехавшиеся версии — это молча
// не найденный браузер, поэтому версия читается из установленного пакета, а не
// пишется второй строкой.
//
// Идемпотентно: второй запуск ничего не качает.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Уже есть готовый браузер (наш dev-контейнер, локальная машина с playwright) —
// качать нечего. `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` ставят там же, где кладут
// браузер заранее, поэтому он и служит признаком.
if (process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD || process.env.PRERENDER_CHROMIUM) {
  console.log('ensure-chromium: браузер уже на месте, пропускаем');
} else {
  const { version } = require('playwright-core/package.json');
  console.log(`ensure-chromium: ставлю chromium для playwright ${version}`);
  execFileSync('npx', ['--yes', `playwright@${version}`, 'install', 'chromium', '--only-shell'], {
    stdio: 'inherit',
  });
}
