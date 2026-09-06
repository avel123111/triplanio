// Статика `dist` с SPA-фолбэком — общая для выпечки и для проверок.
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain',
  '.xml': 'application/xml', '.webmanifest': 'application/manifest+json',
};

/** @param {string} root каталог сборки @param {number} port */
export function serveDist(root, port, onMissing, fallback = 'index.html') {
  const srv = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    let file = join(root, p);
    // ★ КАТАЛОГ ОТДАЁТ СВОЙ index.html — так же, как платформа. Без этого
    // проверка выпечки врала бы: `/es` и `/` уходили бы в SPA-фолбэк, то есть
    // мы смотрели бы на оболочку и делали вывод о готовом файле.
    if (existsSync(file) && statSync(file).isDirectory() && existsSync(join(file, 'index.html'))) {
      file = join(file, 'index.html');
    }
    const missing = !existsSync(file) || statSync(file).isDirectory();
    if (missing) {
      // ★ ФОЛБЭК ТОЛЬКО ДЛЯ АДРЕСОВ, НЕ ДЛЯ ФАЙЛОВ. Отдай мы `index.html` на
      // запрос отсутствующего скрипта — браузер получил бы HTML вместо
      // JavaScript и упал бы «Unexpected token '<'» в точке, не имеющей к
      // причине никакого отношения. Ровно эта ловушка уже стоила разбора на
      // стенде прототипа (144 ложные ошибки, TRIP-455). Файлоподобное имя
      // получает честный 404, и пропажа видна там, где случилась.
      if (p.slice(p.lastIndexOf('/')).includes('.')) {
        onMissing?.(p);
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
        return;
      }
      file = join(root, fallback);
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => srv.listen(port, '127.0.0.1', () => resolve(srv)));
}
