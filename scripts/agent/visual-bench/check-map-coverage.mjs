// Проверка, которой не может быть гардом: СВОБОДНОЕ ОКНО ЗАКРЫТО КАРТОЙ.
//
// История вопроса. Слот карты `<MapShell>` обязан равняться свободному окну
// (панель и шит — его граница, а не наложение). Если это нарушить, экран не
// падает, тесты зелёные, гарды молчат — просто глобус оказывается меньше окна,
// и вокруг него видно дымку и космос. На эту слепую зону однажды ушло полдня;
// расчёт слота с тех пор заперт `src/lib/mapShellSlot.test.js`, а РЕЗУЛЬТАТ на
// экране проверяет вот это.
//
// Гардом в CI не делается намеренно: нужен настоящий браузер с WebGL, живой
// Supabase и токен Mapbox. Это ручной стенд, а не ворота PR.
//
//   node scripts/agent/visual-bench/proxy-bridge.mjs &            # только в песочнице агента
//   VITE_SUPABASE_URL=… VITE_SUPABASE_ANON_KEY=… VITE_MAPBOX_TOKEN=… \
//     npx vite --config scripts/agent/visual-bench/vite.bench.mjs --host 127.0.0.1 --port 5173 &
//   BENCH_EMAIL=… BENCH_PASSWORD=… BENCH_PROXY=http://127.0.0.1:8899 \
//     node scripts/agent/visual-bench/check-map-coverage.mjs
import { launch, signIn } from './browser.mjs';
import { borderOffGlobe, mapCentroid } from './pixels.mjs';

const W = Number(process.env.BENCH_W || 430);
const H = Number(process.env.BENCH_H || 900);
// ★ ЧТО ИМЕННО ПРОВЕРЯЕТСЯ. «Окно закрыто картой целиком» — предикат размытый:
// на широком слоте шар законно виден целиком, и углы пустые, как на десктопе.
// Неразмытое здесь одно — СДВИГ центра карты от центра СВОБОДНОГО ОКНА. Дефект,
// ради которого стенд и написан, выглядел ровно так: шар стоял по центру
// экрана, свободным было только окно над шитом, и в нём оказывался кусок
// планеты с краю. Пустая рамка печатается справочно, ею никто не падает.
const DRIFT = Number(process.env.BENCH_DRIFT || 0.06); // доля стороны окна

// СВОБОДНОЕ ОКНО считается по DOM, а не по слоту карты: в сломанной раскладке
// слот был во весь экран, и мерить его значило бы мерить не то, что видно.
const STATE = "(()=>{var box=function(e){if(!e)return null;var r=e.getBoundingClientRect();"
  + "return [Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)];};"
  + "var m=window.__map;var slot=box(document.querySelector('.mapshell__map'));"
  + "var sheet=box(document.querySelector('.peek-sheet'));"
  + "var panel=box(document.querySelector('.mapshell__panel'));"
  + "var free=slot?slot.slice():null;"
  + "if(free&&sheet&&sheet[1]<free[1]+free[3]){free[3]=Math.max(0,sheet[1]-free[1]);}"
  + "if(free&&panel){var right=panel[0]+panel[2];if(right>free[0]){free[2]=Math.max(0,free[0]+free[2]-right);free[0]=right;}}"
  + "return {slot:slot, free:free, sheetTop:sheet?sheet[1]:null, zoom:m?+m.getZoom().toFixed(2):null};})()";

const b = await launch({ w: W, h: H, port: Number(process.env.BENCH_CDP || 9371) });
let failed = 0;
try {
  const at = await signIn(b);
  if (at === '/login') throw new Error('вход не прошёл — проверь BENCH_EMAIL/BENCH_PASSWORD');
  await b.route(process.env.BENCH_ROUTE || '/new-trip');
  await b.sleep(4000);

  for (const step of ['стартовый детент', 'детент ниже', 'детент выше']) {
    if (step === 'детент ниже') { await b.run("document.querySelector('.peek-sheet__grip')?.focus()"); await b.key('ArrowDown'); await b.sleep(1800); }
    if (step === 'детент выше') { await b.run("document.querySelector('.peek-sheet__grip')?.focus()"); await b.key('ArrowUp'); await b.sleep(1800); }
    await b.sleep(1800);
    const st = await b.read(STATE);
    if (!st.free) throw new Error('слот карты не найден — экран не тот или не отрисовался');
    const [x, y, w, h] = st.free;
    if (h < 40 || w < 40) { console.log(`${step.padEnd(18)} свободного окна нет (карта скрыта) — пропуск`); continue; }
    const file = await b.shot(`coverage-${W}x${H}-${step.replace(/\s+/g, '-')}`);
    const c = mapCentroid(file, { x, y, w, h });
    const r = borderOffGlobe(file, { x, y, w, h });
    const drift = Math.max(Math.abs(c.dx), Math.abs(c.dy));
    const bad = drift > DRIFT;
    if (bad) failed++;
    console.log(`${step.padEnd(18)} окно ${w}×${h}  zoom ${st.zoom}  сдвиг центра ${c.dx >= 0 ? '+' : ''}${c.dx}/${c.dy >= 0 ? '+' : ''}${c.dy}`
      + `  карта ${Math.round(c.coverage * 100)}% площади · рамка ${r.of - r.off}/${r.of}  ${bad ? '✗' : '✓'}  ${file}`);
  }
} finally {
  b.close();
}
if (failed) {
  console.error(`\n✗ центр карты уехал от центра свободного окна (${failed}). Это тот самый дефект: карта кадрируется не по тому прямоугольнику, который видно.`);
  process.exit(1);
}
console.log('\n✓ карта кадрируется по свободному окну на всех детентах');
