// Драйвер настоящего браузера по CDP: запуск, вход, навигация, снимок, жест.
//
// Почему не Playwright MCP: тому нужен свой браузер и своя сессия, а стенду
// нужны ровно три вещи — WebGL (иначе карты нет вовсе), снимок и синтетический
// тач. Всё это даёт голый CDP поверх предустановленного Chromium.
//
// Окружение:
//   BENCH_APP        адрес приложения (по умолчанию http://127.0.0.1:5173)
//   BENCH_EMAIL / BENCH_PASSWORD   тестовый пользователь dev-Supabase
//   BENCH_PROXY      прокси для браузера (в песочнице агента — proxy-bridge.mjs)
//   BENCH_CHROME     путь к Chromium (по умолчанию из PLAYWRIGHT_BROWSERS_PATH)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const APP = process.env.BENCH_APP || 'http://127.0.0.1:5173';
const OUT = process.env.BENCH_OUT || path.join(os.tmpdir(), 'triplanio-bench');

function chromePath() {
  if (process.env.BENCH_CHROME) return process.env.BENCH_CHROME;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const dir = fs.readdirSync(root).find((d) => d.startsWith('chromium-'));
  return path.join(root, dir, 'chrome-linux', 'chrome');
}

export async function launch({ w = 430, h = 900, port = 9371, profile = 'default' } = {}) {
  fs.mkdirSync(OUT, { recursive: true });
  const args = [
    '--headless=new', '--no-sandbox',
    // Софтверный WebGL: без него Mapbox не инициализируется, и «карты нет»
    // читается как дефект вёрстки.
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--disable-background-networking', '--disable-component-update', '--disable-quic',
    '--no-first-run', '--no-default-browser-check', '--test-type',
    '--hide-scrollbars', '--force-device-scale-factor=1',
    `--user-data-dir=${path.join(OUT, `profile-${profile}`)}`,
    `--remote-debugging-port=${port}`, `--window-size=${w},${h}`, 'about:blank',
  ];
  if (process.env.BENCH_PROXY) {
    args.splice(2, 0, '--ignore-certificate-errors', `--proxy-server=${process.env.BENCH_PROXY}`,
      '--proxy-bypass-list=127.0.0.1;localhost');
  }
  const proc = spawn(chromePath(), args, { stdio: 'ignore' });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(2500);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0; const waiting = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id;
    waiting.set(i, (m) => (m.error ? rej(new Error(`${method}: ${JSON.stringify(m.error)}`)) : res(m.result)));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 });
  await send('Emulation.setTouchEmulationEnabled', { enabled: w < 700, maxTouchPoints: 5 });

  const api = {
    send, sleep,
    /** Значение выражения из страницы (через JSON, поэтому только данные). */
    async read(expr) {
      const r = await send('Runtime.evaluate', {
        expression: `(()=>{try{return JSON.stringify(${expr})}catch(e){return JSON.stringify({__err:String(e)})}})()`,
        awaitPromise: true, returnByValue: true,
      });
      try { return JSON.parse(r.result?.value); } catch { return r.result?.value; }
    },
    /** Побочное действие в странице; значение не возвращается (и не сериализуется). */
    run: (code) => send('Runtime.evaluate', { expression: `(()=>{${code}\n;return 1})()`, awaitPromise: true, returnByValue: true }),
    async goto(url) { await send('Page.navigate', { url }); await sleep(1200); },
    /** Клиентский переход: полная перезагрузка защищённого роута роняет сессию. */
    async route(pathname) {
      await api.run(`history.pushState({}, '', ${JSON.stringify(pathname)}); dispatchEvent(new PopStateEvent('popstate'))`);
      await sleep(6000);
    },
    async shot(name) {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(OUT, `${name}.png`);
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      return file;
    },
    async key(key) {
      const code = key === 'ArrowUp' ? 38 : key === 'ArrowDown' ? 40 : 13;
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code });
    },
    async swipe(x, fromY, toY, { steps = 40, pause = 40 } = {}) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: fromY }] });
      for (let i = 1; i <= steps; i++) {
        await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: fromY + ((toY - fromY) * i) / steps }] });
        await sleep(pause);
      }
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    },
    close() { try { ws.close(); } catch { /* уже закрыт */ } proc.kill(); },
  };
  return api;
}

const SET_VALUE = "(el,v)=>{const p=Object.getPrototypeOf(el);const d=Object.getOwnPropertyDescriptor(p,'value');"
  + "d.set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))}";

/** Вход тестовым пользователем. Возвращает путь, на котором оказались. */
export async function signIn(b, { email = process.env.BENCH_EMAIL, password = process.env.BENCH_PASSWORD } = {}) {
  await b.goto(`${APP}/login`);
  await b.sleep(4000);
  if (await b.read('location.pathname') !== '/login') return b.read('location.pathname');
  await b.run(`const set=${SET_VALUE};
    [...document.querySelectorAll('button')].find(x=>/Necessary only|Accept all|Только необходимые|Принять все/.test(x.innerText))?.click();
    set(document.querySelector('input[type=email]'), ${JSON.stringify(email)});
    set(document.querySelector('input[type=password]'), ${JSON.stringify(password)});`);
  await b.sleep(300);
  await b.run("[...document.querySelectorAll('button')].find(x=>/Sign in|Войти|Entrar/.test(x.innerText))?.click()");
  await b.sleep(7000);
  return b.read('location.pathname');
}

export { APP };
