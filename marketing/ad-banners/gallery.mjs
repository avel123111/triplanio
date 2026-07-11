/* Собирает все отрендеренные PNG из out/ в один самодостаточный
   gallery.html (картинки встроены base64) - для просмотра/шеринга одним файлом.
   Запуск: node gallery.mjs  (после render.mjs) */
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, 'out');
const img = f => `data:image/png;base64,${readFileSync(join(OUT, f)).toString('base64')}`;

const GOOGLE = {
  g1: 'Отель забронирован. А остальной план? (next-step)',
  g2: 'Брони тонут в почте (избегание потери)',
  g3: 'Перешли письмо - AI соберёт маршрут (USP: AI-распознавание)',
  g4: 'Бесплатная отмена сгорает тихо (USP: дедлайны отмены)',
  g5: 'Едете компанией? Один маршрут на всех (совместность)',
};
const INSTA = {
  i1: 'Хаос-чипы → «А мог бы так»',
  i2: 'Чек-лист «Где твой план поездки?» → «Целиком - нигде»',
  i3: 'Письмо → AI → готовые карточки',
  i4: 'Вся компания - в одном маршруте',
  i5: 'Пуш о дедлайне отмены → «Забыл? Мы - нет.»',
};

let h = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Triplanio - рекламные баннеры v1</title><style>
body{margin:0;background:#14161f;color:#e8eaf2;font-family:system-ui,sans-serif;padding:40px 4vw 80px}
h1{font-size:26px;margin:0 0 6px}
.meta{color:#9aa0b5;font-size:14px;margin-bottom:34px}
h2{font-size:20px;margin:46px 0 4px;padding-top:22px;border-top:1px solid #2a2e40}
.note{color:#9aa0b5;font-size:13px;margin:0 0 18px}
h3{font-size:15px;font-weight:600;margin:26px 0 10px;color:#c9cede}
h3 code{background:#232636;border-radius:6px;padding:2px 8px;margin-right:10px;color:#8ab4f8}
.row{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start}
img{display:block;border-radius:10px;box-shadow:0 6px 22px rgba(0,0,0,.45);max-width:100%;height:auto}
.g-land{width:640px}.g-sq{width:336px}.insta{width:340px}
.lang{font-size:11px;letter-spacing:.08em;color:#7d8299;text-transform:uppercase;margin:10px 0 6px}
</style></head><body>
<h1>Triplanio - рекламные баннеры v1</h1>
<div class="meta">10 концептов × RU/EN. Google: 1200×628 + 1200×1200 (Responsive Display Ads). Instagram: 1080×1350.</div>`;

h += `<h2>Google Display</h2><p class="note">Контекст показа: человек уже бронирует отель / ищет билеты на travel-сайте.</p>`;
for (const [id, t] of Object.entries(GOOGLE)) {
  h += `<h3><code>${id}</code>${t}</h3>`;
  for (const l of ['ru', 'en']) {
    h += `<div class="lang">${l}</div><div class="row">
    <img class="g-land" src="${img(`${id}_landscape_${l}.png`)}" alt="${id} ${l} 1200x628">
    <img class="g-sq" src="${img(`${id}_square_${l}.png`)}" alt="${id} ${l} 1200x1200"></div>`;
  }
}
h += `<h2>Instagram</h2><p class="note">Посыл: «всё разбросано по разным местам - в Triplanio всё в одном месте» + напоминания + совместность.</p>`;
for (const [id, t] of Object.entries(INSTA)) {
  h += `<h3><code>${id}</code>${t}</h3><div class="row">`;
  for (const l of ['ru', 'en'])
    h += `<div><div class="lang">${l}</div><img class="insta" src="${img(`${id}_portrait_${l}.png`)}" alt="${id} ${l} 1080x1350"></div>`;
  h += `</div>`;
}
h += `</body></html>`;

writeFileSync(join(ROOT, 'gallery.html'), h);
console.log('gallery.html written');
