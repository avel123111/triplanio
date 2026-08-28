/**
 * Ужать выбранную картинку ДО того, как она попадёт куда-либо ещё.
 *
 * ЗАЧЕМ. Ни обложку трипа, ни фон share-карточки никто никогда не видит крупнее
 * 1080 px по ширине: карточка рендерится ровно в 1080 × 1920, обложку самый
 * широкий телефон показывает ~430 CSS-точек (≈1290 физических при 3×). Фото с
 * телефона приезжает 4032 px и 3–5 МБ, то есть вдвое подробнее любого экрана и
 * на порядок тяжелее нужного. Раньше вместо этого шага стоял запрет на 4 МБ:
 * пользователь с обычным айфоном упирался в «файл слишком большой» на своей же
 * фотографии. Ужимаем на входе — и потолок перестаёт быть правилом.
 *
 * ГДЕ СТОИТ. Первым действием в обеих точках выбора файла — обложка трипа
 * (`TripCoverPicker`) и фон карточки (`ShareCardDialog`). Всё, что ниже по
 * течению (заливка в Storage, base64 в SVG карточки), получает уже маленький
 * файл и ничего про этот шаг не знает. Оригинал не доезжает ни до стейта, ни до
 * хранилища.
 *
 * ЧТО С HEIC. Декодирует браузер: iOS Safari — то есть ровно те устройства, где
 * фото тяжёлое, — открывает HEIC нативно. Где не открывает (десктопный Chrome),
 * возвращаем файл КАК ЕСТЬ: тогда и срабатывает проверка размера у вызывающего,
 * выровненная на реальный `file_size_limit` бакета. Ужать не смогли — это не
 * повод не дать загрузить.
 */

/** Длинная сторона, до которой ужимаем. Выше неё пикселей никто не увидит. */
export const MAX_IMAGE_EDGE = 1920;

/** Качество WebP. 0.8 — потолок, выше которого разницы на глаз нет, а вес растёт. */
const WEBP_QUALITY = 0.8;

/**
 * Целевой размер, если картинка длиннее `max` по большей стороне, иначе `null`
 * («трогать нечего»). Пропорции сохраняются.
 *
 * @param {number} width
 * @param {number} height
 * @param {number} [max]
 * @returns {{width:number,height:number}|null}
 */
export function fitWithin(width, height, max = MAX_IMAGE_EDGE) {
  const long = Math.max(width, height);
  if (!(long > max)) return null;
  const k = max / long;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/**
 * Имя файла под новый формат: `IMG_4823.HEIC` → `IMG_4823.webp`.
 * Расширение обязано соответствовать байтам — по нему и путь в Storage, и
 * `uploadContentType` называют тип (см. `fileType.js`).
 *
 * @param {string} name
 * @param {string} ext
 * @returns {string}
 */
export function replaceExtension(name, ext) {
  const base = String(name || 'image');
  const dot = base.lastIndexOf('.');
  return `${dot > 0 ? base.slice(0, dot) : base}.${ext}`;
}

/**
 * Сообщить, чем кончилась подготовка.
 *
 * ЗАЧЕМ ВООБЩЕ. Отказ ужать НЕ ломает загрузку — наружу уходит исходник, — а
 * значит в интерфейсе он невидим: ни ошибки, ни жалобы. Без этого события мы не
 * узнаем, что механизм перестал работать на каком-то браузере, пока люди снова
 * не начнут упираться в потолок веса. `skipped` шлётся наравне с остальными,
 * потому что без знаменателя доля отказов не читается.
 *
 * ПОЧЕМУ ИМПОРТ ДИНАМИЧЕСКИЙ. Этот модуль гоняется тестами в node, где нет ни
 * браузера, ни цепочки `@/lib/analytics` → `posthog-js`. Статический импорт
 * уронил бы тест на разборе модуля — то есть чистая арифметика перестала бы
 * проверяться из-за телеметрии. Динамический вызов в node просто не резолвится и
 * гасится тут же; в сборке `analytics` и так лежит в главном куске (его тянет
 * `AuthContext`), поэтому отдельного запроса за ним не идёт.
 *
 * Имени файла в свойствах нет намеренно — это данные пользователя.
 *
 * @param {{result:'resized'|'skipped'|'failed', in_kb:number, out_kb:number, ms:number}} props
 */
function report(props) {
  import('@/lib/analytics').then((m) => m.track('image_prepared', props)).catch(() => {});
}

/**
 * Отдаёт файл, готовый к отправке: ужатую копию или исходник, если ужимать
 * нечего либо браузер картинку не открыл. Никогда не бросает.
 *
 * @param {File} file
 * @param {number} [max] - длинная сторона результата
 * @returns {Promise<File>}
 */
export async function prepareImage(file, max = MAX_IMAGE_EDGE) {
  const started = Date.now();
  const done = (result, out) => {
    report({
      result,
      in_kb: Math.round(file.size / 1024),
      out_kb: Math.round(out.size / 1024),
      ms: Date.now() - started,
    });
    return out;
  };
  try {
    const bitmap = await createImageBitmap(file);
    const size = fitWithin(bitmap.width, bitmap.height, max);
    if (!size) { bitmap.close?.(); return done('skipped', file); }
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, size.width, size.height);
    bitmap.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', WEBP_QUALITY));
    if (!blob) return done('failed', file);
    // Тип берём У БЛОБА, а не назначаем: браузер без WebP-кодировщика молча
    // отдаёт PNG, и подпись «webp» на PNG-байтах не прошла бы MIME-дверь бакета.
    const ext = blob.type === 'image/webp' ? 'webp' : 'png';
    return done('resized', new File([blob], replaceExtension(file.name, ext), { type: blob.type }));
  } catch {
    return done('failed', file);
  }
}
