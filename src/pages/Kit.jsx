// @ts-check
/**
 * Витрина дизайн-системы, роут `/kit` и `/kit/:object` (TRIP-344, редизайн).
 *
 * ЖИВОЙ ЭКРАН, А НЕ КАРТИНКИ. Страница импортирует `@/design` и рисует систему
 * как она есть: то, что тут видно, и есть то, что видит пользователь — тот же
 * код. Витрина отвечает за продукт, а не утверждает о нём (Р10/Р14).
 *
 * ── ЧЕМ ЭТА РЕДАКЦИЯ ОТЛИЧАЕТСЯ ОТ append-only-стены ────────────────────────
 * 1. OBJECT-BASED IA. `/kit` — индекс-каталог, СГЕНЕРИРОВАННЫЙ из реестра
 *    (`kit-objects.js`), а не набранный руками. `/kit/:object` — страница ОДНОГО
 *    объекта. Новый объект = строка реестра + рецепт, а не дописка в мегафайл:
 *    под-роут структурно не даёт стене вырасти.
 * 2. ОДИН ПРИМИТИВ ОБРАЗЦА `Specimen`. Три прежние грамматики (`Specimen` +
 *    `Sample` + bespoke-секции) схлопнуты в одну: заголовок оси + ряд
 *    экземпляров, подпись поэлементная (имя в коде под каждым образцом).
 * 3. ОБРАЗЦЫ ГЕНЕРИРУЮТСЯ ИЗ КАРТ. Значения оси едут ДАННЫМИ: карта вариантов,
 *    экспортированная примитивом (`BTN_VARIANTS` …, семья кнопки), ИЛИ
 *    CSS-производный список семьи из ЖИВЫХ `document.styleSheets` (прочие).
 *    Список, набранный руками, устаревает молча — замер не устаревает.
 *
 * ── ТЕКСТ ЕДЕТ ДАННЫМИ (`TX`), НЕ ЛИТЕРАЛАМИ В РАЗМЕТКЕ ─────────────────────
 * ОСОЗНАННОЕ ИСКЛЮЧЕНИЕ из правила 4 (i18n): страница внутренняя, `!isProdHost`,
 * в прод не едет. Гард 2d ловит текстовые узлы `>текст<`; из `TX` он их не видит.
 *
 * ── ВИТРИННЫЙ CSS ТОЛЬКО В `Kit.css`, ПОД `data-force` ─────────────────────
 * Наведение/нажатие/фокус пропом не вызвать — их зеркалит правило под
 * `data-force` в ВИТРИННОМ слое (`Kit.css`), не в проде. Своих классов витрина
 * не заводит (пол 2o не растёт): оболочка несёт АТРИБУТЫ `data-kit`/`data-force`.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useConfirm } from '@/components/common/ConfirmProvider';
import catalog from '@/design/catalog.json';
import {
  Avatar, AvatarStack, Badge, Btn, Card, CardHeader, Checkbox, Chip, Dialog, EmptyState, Field,
  FileRow, IconBtn, Input, InputGroup, NotifRow, Seg, Severity, Sheet, UnreadBadge,
  Skeleton, Stepper, Swatch, Textarea, Tile, Toggle, Tooltip, PageHead, Stat, ListRow, Donut, Cover, CoverPicker,
  BookingWarning, TimelineEmptyDay,
  CityBar, EventChip,
  BTN_VARIANTS, CARD_VARIANTS, ICON_BTN_TONES, ICON_BTN_SIZES, SEG_VARIANTS, STEPPER_VARIANTS,
  TILE_SIZES, TILE_TONES, STAT_TONES, LISTROW_VARIANTS, EVENTCHIP_VARIANTS, toast,
} from '@/design/index';
import { Icon } from '@/design/icons';
import Accordion from '@/components/common/Accordion';
import Autocomplete from '@/components/common/Autocomplete';
import { PickerSheet } from '@/components/ui/PickerSheet';
import LpSheet from '@/components/ui/LpSheet';
import { sheetScroller } from '@/components/ui/sheetShell';
import { KIT_OBJECTS, KIT_GROUPS, kitObjectById } from './kit-objects';
// Экран запуска (TRIP-478) — ровно те файлы, что подставляются в документ на
// сборке (плагин `inline-splash`). Витрина не пересобирает заставку по образу и
// подобию, а показывает ЕЁ САМУ: второй копии не существует, разойтись нечему.
// `?raw` — разметка приезжает текстом, потому что в документе она статический
// HTML, а не JSX; переписать её компонентом значило бы завести вторую правду.
import splashMarkup from '@/design/splash.html?raw';
import '@/design/splash.css';
// Витринный слой: только force-state зеркала под `data-force` (см. Kit.css).
import './Kit.css';

/* ─────────────────────────────── текст ─────────────────────────────────── */
const TX = {
  title: 'Витрина дизайн-системы',
  lead: 'Тот же код, что и в приложении: /kit импортирует @/design. Один объект — одна страница; образцы генерируются из карт вариантов компонентов и из живых стилей.',
  canon: 'канон', triage: 'на разборе', unknown: 'нет в каталоге',
  canonsLabel: '9 канонов', modsLabel: 'модификаторы (комбинируются с каноном)',
  back: '← все объекты',
  theme: 'Тема', themeLight: 'светлая', themeDark: 'тёмная',
  groups: {
    components: 'Компоненты', layout: 'Примитивы раскладки',
    scale: 'Шкала отступов', type: 'Типографика', tokens: 'Токены :root',
  },
  titles: {
    'pagehead': 'Шапка экрана', 'stat': 'Плитка-показатель', 'list-row': 'Строка списка', 'donut': 'Диаграмма-кольцо', 'btn': 'Кнопка', 'icon-btn': 'Кнопка-иконка', 'chip': 'Пилюля (Chip)',
    'seg': 'Сегмент-контрол', 'stepper': 'Степпер', 'swatch': 'Свотч',
    'badge': 'Бейдж', 'card': 'Карточка', 'field': 'Поле ввода', 'input': 'Декорации поля', 'autocomplete': 'Поисковый пикер',
    'avatar': 'Аватар', 'sev': 'Плашка сообщения', 'empty-state': 'Пустое состояние',
    'checkbox': 'Чекбокс', 'switch': 'Тумблер', 'doc-row': 'Строка документа',
    'splash': 'Экран запуска', 'skeleton': 'Скелет', 'dialog': 'Оверлеи', 'accordion': 'Аккордеон', 'cover': 'Обложка',
    'coverpicker': 'Пикер обложки', 'full-surface': 'Полноростная поверхность',
    'surface-crash': 'Граница краха окна',
    'tile': 'Плитка-иконка', 'spin': 'Кольцо загрузки', 'toast': 'Тост',
    'sheet-row': 'Строка меню/шита', 'ai-blk': 'AI-блок', 'time': 'Колонка времени',
    'row': 'Ряд (.row)', 'col': 'Колонка (.col)', 'grid': 'Сетка (.grid)',
    'spacing': 'Шкала отступов', 'typography': 'Типографика', 'tokens': 'Токены :root',
  },
  blurbs: {
    'btn': 'Основное действие. Ось — тон (variant); формы и состояния ниже.',
    'icon-btn': 'Действие без подписи. Три независимые оси: тон · размер · форма.',
    'chip': 'Кликабельная пилюля; выбранный = aria-pressed. Заливка + модификаторы.',
    'seg': 'Выбор одного из; активный = aria-pressed. auto / fill.',
    'stepper': 'Счётчик «− N +»: pill / block / bare.',
    'swatch': 'Плитка выбора: цвет · иконка · круглая обложка. Выбор = aria-pressed.',
    'badge': 'Статусная метка; тон. Роль участника = тон бейджа, а не свой класс.',
    'card': 'Поверхность: заголовок, подзаголовок, действие справа.',
    'field': 'Подпись, подсказка, обязательность; состояния prop-driven.',
    'input': 'Декорации поля, которые эмитит сам <Input>: иконка, кольцо, валюта, ряд.',
    'autocomplete': 'Поиск-по-мере-ввода: поле + выпадающий лист на Popover (лист-хром .ss-* общий с SearchSelect). Флип и «клик мимо» — от Popover.',
    'full-surface': 'Экран во весь вьюпорт. Их ТРИ и это одна вещь: шторка пикера, оболочка панелей редактора и окно с полями (<Dialog full>) — общая коробка, краска (--bg), бровь и резерв под клавиатуру у скроллера. Смотреть на 390: правила семьи живут ≤640.',
    'surface-crash': 'Граница краха в шве (TRIP-515). Краш ВНУТРИ окна закрывает окно, а не убивает приложение; промис confirm() разрешается false даже когда краш случился при busy. Приёмка — check:surfaces.',
    'avatar': 'Инициалы / фото / AI / плейсхолдер / удалён; размеры и стопка.',
    'sev': 'Тон по уровню важности (info/warning/error/success/quiet).',
    'empty-state': 'Каркас с иконкой, текстом и призывом к действию.',
    'checkbox': 'Вкл/выкл (aria-checked); disabled.',
    'switch': 'Вкл/выкл; busy (операция в полёте); locked.',
    'doc-row': 'Имя, размер, тон (обычный / ai).',
    'skeleton': 'Плейсхолдер загрузки, разной ширины.',
    'dialog': 'Диалог и шит — оверлеи (открываются кнопкой).',
    'accordion': 'Раскрывашка: шапка-кнопка (иконка · заголовок · статус) + вложенное тело; шеврон вправо→вниз.',
    'cover': 'Обложка трипа: фото ИЛИ фоллбек-картинка из бандла (градиентов больше нет).',
    'coverpicker': 'Выбор картинки: кадр листается свайпом и стрелками (scroll-snap), миниатюры под ним, своё фото — кнопкой в углу. Откуда картинки и куда девается загруженный файл, примитив не знает — это даёт вызыватель.',
    'tile': 'Квадрат под значок: тон · размер · форма · залитая.',
    'spin': 'Ступени размера (lg/xl) и тон головки (ink/onscrim).',
    'toast': 'Уведомление; тон по уровню важности красит иконный квадрат.',
    'sheet-row': 'Действие во всю ширину; danger — деструктивное.',
    'ai-blk': 'Распознавание брони. Шапка статична; тело плавно раскрывается/скрывается (grid-rows).',
    'time': 'Вылет сверху, прибытие снизу (в ленте у события-переезда).',
    'row': 'Флекс-ряд: зазор (ступени --sp-N) и оси выравнивания/потока.',
    'col': 'Флекс-колонка: зазор и оси.',
    'grid': 'Сетка: зазор и колонки.',
    'spacing': 'Ступени токена --sp-N линейками (замер из живых стилей).',
    'typography': '9 текст-стилей .t-* живым текстом.',
    'tokens': 'Имена, объявленные в :root текущей темы (замер).',
    'splash': 'Заставка запуска: знак каскадом, слово шторкой. Тот же файл, что подставляется в index.html на сборке.',
  },
  forceLabel: 'Состояние образца (наведение/нажатие/фокус — зеркало под data-force)',
  forceStates: {
    default: 'Обычная', hover: 'Наведение', active: 'Нажатие',
    focus: 'Фокус', disabled: 'Недоступна', loading: 'Загрузка',
    // Ось состояний карточки (объект 2)
    selected: 'Выбрана (aria-selected)', busy: 'Занята · проверка (aria-busy)',
    parsed: 'Разобрана', locked: 'Заблокирована (Pro)', dragover: 'Перетаскивание (data-dragover)',
  },
  save: 'Сохранить', close: 'Закрыть', placeholder: 'Введите значение',
  rates: 'Курсы', add: 'Трата',
  statLabel: 'Всего потрачено', statSub: '10 трат', statTap: 'нажми, чтобы задать',
  rowTitle: 'Проживание', rowSub: 'Будва · 10 трат', rowDate: '12 – 24 апр',
  donutTotal: 'всего',
  sample: 'Съешь ещё этих мягких булок · Sphinx of black quartz · 0123456789',
  gapDefault: 'по умолчанию', missing: 'ступени нет — молча даёт значение по умолчанию',
  // Текст образцов — данными (правило 2 этого файла): гард 2d ловит узлы `>текст<`
  // и `title=`-литералы, из `TX` он их не видит; ключи в локали заводить незачем.
  lockmsg: 'Подключает владелец', accent: 'тон из контекста', brandName: 'Найти на Booking',
  members: 'Участники', chipAll: 'Все', chipJump: 'Новые сообщения', chipRoute: 'Лиссабон → Порту',
  chipAdd: 'Добавить переезд', chipMore: '+2 ещё', chipRemove: 'Снять фильтр',
  roleOwner: 'Владелец', roleAdmin: 'Админ', roleViewer: 'Наблюдатель', rolePending: 'Ожидает',
  overnight: 'Ночной переезд', acSearchPh: 'Начните вводить город…',
  fsPicker: 'Шторка пикера', fsPanel: 'Панель редактора', fsDialog: 'Окно с полями',
  fsPickerTitle: 'Полноростная шторка', fsPanelTitle: 'Полноростная панель',
  fsDialogTitle: 'Полноростное окно', fsDialogField: 'Что случилось',
  fsDialogHint: 'То же окно без `full` — шторка по содержимому: сравнить переключателем.',
  fsDialogOn: 'Включить полный рост', fsDialogOff: 'Выключить полный рост',
  fsBack: 'Назад', fsCancel: 'Отмена', fsSave: 'Сохранить',
  fsPhaseHint: 'Вид точки', fsChange: 'Изменить', fsAdd: 'Добавить',
  // Подписи плиток — те же четыре вида точки, что у настоящего композера
  // (`cities/CityAdder`): витрина показывает ОБЪЕКТ, а не случайный текст.
  fsKinds: ['Посещение', 'Пересадка', 'Старт', 'Финиш'],
  fsDrill: 'Открыть переезд (слой поверх)', fsDrillTitle: 'Переезд',
  fsDrillBody: 'Второй слой ВНУТРИ той же шторки — как город → переезд в редакторе. Свайп вниз закрывает ПОВЕРХНОСТЬ, «Назад» снимает один слой.',
  cardTitle: 'Заголовок карточки', cardBody: 'Тело карточки: обычный текст на поверхности.',
  cardHead: 'Заголовок', sevText: 'Текст',
  sevInvite: 'Нажмите, чтобы разрешить', sevInviteTitle: 'Приглашение',
  sevBody: 'Текст сообщения на одну-две строки.', sevTitle: 'Заголовок плашки',
  emptyTitle: 'Пока пусто', emptyBody: 'Здесь появятся элементы.',
  emptyBoxTitle: 'Пусто', emptyBoxBody: 'В рамке (boxed).',
  devTitle: 'Итоги года', devBody: 'Раздел находится в разработке. Загляните чуть позже.',
  openDialog: 'Открыть диалог', openSheet: 'Открыть шит', readonly: 'Режим только для чтения.',
  warnTransfer: 'Нет переезда', warnTransferSub: 'Мадрид → Барселона',
  warnHotel: 'Нет отеля', warnHotelSub: 'Барселона · 13 мая – 16 мая · 3 ночи',
  emptyDayLbl: 'Свободный день в Мадрид', addActivity: 'Добавить активность',
  toastTitle: 'Готово', toastBody: 'Изменения сохранены.',
  toastLab: 'Появятся в правом нижнем углу (на мобиле — сверху); наведи или тапни стопку, чтобы развернуть.',
  toastDeck: 'колода',
  toastDemoSaved: 'Путешествие сохранено', toastDemoSavedSub: 'Все изменения применены',
  toastDemoLink: 'Ссылка скопирована',
  toastDemoCover: 'Обложка не сохранилась', toastDemoCoverSub: 'Попробуйте загрузить ещё раз',
  toastDemoDelFail: 'Не удалось удалить', toastDemoDraft: 'Черновик обновлён',
  sheetNormal: 'Обычное действие', sheetDanger: 'Удалить',
  aiTitle: 'Распознать бронь', aiSub: 'Вставьте текст письма',
  aiFill: 'Заполнить через ИИ', aiUpload: 'PDF / скриншот', aiPh: 'Вставьте текст письма с подтверждением, номер брони, ссылку…',
  dialogTitle: 'Диалог', sheetTitle: 'Шит', dialogBody: 'Содержимое диалога.',
};

/* ───────────────────── статус объекта из каталога ────────────────────────── */
const familyOf = (cls) => cls.replace(/(__|--).*/, '').split('-')[0];
const statusOf = (cls) => catalog.families[familyOf(cls)] ?? null;
/** Хвост варианта: `badge--brand` → `brand`, `avatar-stack--white` → `white`. */
const tailOf = (cls) => cls.slice(cls.indexOf('--') + 2);

const StatusTag = ({ cls }) => {
  const st = statusOf(cls);
  return (
    <span className={`badge badge--xs ${st === 'canon' ? 'badge--success' : 'badge--quiet'}`}>
      {st === 'canon' ? TX.canon : st === 'triage' ? TX.triage : TX.unknown}
    </span>
  );
};

/* ─────────── что читается из живых стилей, а не из списка ─────────────────── */
/** ⚠ КАЖДОЕ правило отдаётся наружу, и ПОТОМ идёт спуск внутрь: у обычного
 *  `CSSStyleRule` в Chrome тоже есть `cssRules` (пустой, но объект — истинный),
 *  поэтому форма «или само, или потомки» пропускала бы всё вне `@media`. */
function eachRule(fn) {
  const visit = (rules) => {
    for (const rule of Array.from(rules ?? [])) {
      fn(rule);
      if (rule.cssRules?.length) visit(rule.cssRules);
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try { visit(sheet.cssRules); } catch { /* сторонний лист другого домена */ }
  }
}

/** Объявленные классы, сгруппированные по семье (`familyOf`) — та же нарезка,
 *  что у теста дрейфа, поэтому составные имена (`avatar-stack--white` в семье
 *  `avatar`, `input-unit--lead` в семье `input`) попадают куда надо, а не мимо.
 *  Плюс ступени зазора row/col/grid тем же проходом. */
function readDeclared() {
  const classes = new Set();
  const steps = { row: new Set(), col: new Set(), grid: new Set() };
  eachRule((rule) => {
    const sel = rule.selectorText;
    if (!sel) return;
    for (const m of sel.matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)) classes.add(m[1]);
  });
  const byFamily = {};
  for (const c of classes) {
    if (!c.includes('--') || c.includes('__')) continue;
    (byFamily[familyOf(c)] ||= []).push(c);
    const g = c.match(/^(row|col|grid)--g(\d)$/);
    if (g) steps[g[1]].add(Number(g[2]));
  }
  for (const k of Object.keys(byFamily)) byFamily[k].sort();
  return { byFamily, steps };
}

/** Имена в `:root` (предикат Р8 гарда 2o); значение — от ТЕКУЩЕЙ темы. */
function readRootTokens() {
  const names = new Set();
  eachRule((rule) => {
    if (!rule.selectorText || !/^(:root|html|body)\b/.test(rule.selectorText)) return;
    for (const prop of Array.from(rule.style ?? [])) if (prop.startsWith('--')) names.add(prop);
  });
  const cs = getComputedStyle(document.documentElement);
  return [...names].sort().map((name) => ({ name, value: cs.getPropertyValue(name).trim() }));
}

/* ─────────────────────────── примитив образца ────────────────────────────── */
/** ЕДИНСТВЕННАЯ грамматика образца (схлопнула прежние `Specimen`+`Sample`+bespoke).
 *  Заголовок оси (`label`) + ряд экземпляров; под каждым — его имя В КОДЕ
 *  (проп-вариант / состояние / модификатор) моно-шрифтом. `full` — полноширинный
 *  экземпляр (block, плашка, строка файла): колонка тянет ребёнка на всю строку.
 *  @param {{ label?: any, items: Array<{ name: string, node: any, full?: boolean }> }} p */
const Specimen = ({ label, items }) => (
  <div className="col col--g3">
    {label && <span className="t-meta">{label}</span>}
    <div className="row row--g4 row--wrap">
      {items.map(({ name, node, full }, i) => (
        <div key={name + i} className={full ? 'col col--g1 grow' : 'col col--g1 col--a-start'}>
          {node}
          <span className="t-mono">{name}</span>
        </div>
      ))}
    </div>
  </div>
);

/** Живое демо поискового пикера для витрины: контролируемый <Autocomplete> с
 *  локальным мок-поиском (без сети/атрибуции LocationIQ). Показывает поле; лист
 *  на Popover + `.ss-*` появляется по вводу. */
/* ⚠️ СПИСОК ДЛИННЕЕ ЭКРАНА — ЭТО ТРЕБОВАНИЕ, А НЕ ЩЕДРОСТЬ (TRIP-494). Их было
   четыре, и такой лист не переполняется физически: «скроллер ровно один» и
   «резерв под клавиатуру достаётся скроллеру» на нём НЕДОКАЗУЕМЫ — оба гейта
   зелены при сломанном скролле. i18n-ignore: демо-данные витрины /kit. */
const KIT_CITIES = [
  { id: 'lis', name: 'Лиссабон', sub: 'Португалия' },
  { id: 'por', name: 'Порту', sub: 'Португалия' },
  { id: 'mad', name: 'Мадрид', sub: 'Испания' },
  { id: 'bcn', name: 'Барселона', sub: 'Испания' },
  { id: 'val', name: 'Валенсия', sub: 'Испания' },
  { id: 'sev', name: 'Севилья', sub: 'Испания' },
  { id: 'bil', name: 'Бильбао', sub: 'Испания' },
  { id: 'mal', name: 'Малага', sub: 'Испания' },
  { id: 'gra', name: 'Гранада', sub: 'Испания' },
  { id: 'ali', name: 'Аликанте', sub: 'Испания' },
  { id: 'ber', name: 'Берлин', sub: 'Германия' },
  { id: 'mun', name: 'Мюнхен', sub: 'Германия' },
  { id: 'ham', name: 'Гамбург', sub: 'Германия' },
  { id: 'kel', name: 'Кёльн', sub: 'Германия' },
  { id: 'mil', name: 'Милан', sub: 'Италия' },
  { id: 'rom', name: 'Рим', sub: 'Италия' },
  { id: 'nap', name: 'Неаполь', sub: 'Италия' },
  { id: 'tur', name: 'Турин', sub: 'Италия' },
  { id: 'ven', name: 'Венеция', sub: 'Италия' },
  { id: 'bol', name: 'Болонья', sub: 'Италия' },
];
/* floor-exempt: dsshare +14 — стенд семьи поверхностей (TRIP-494), апрув Pavel
   («делай всё чисто системно» + решение по трём пунктам 31.08.2026). Замер:
   4266 → 4252 bp. Из них 4 bp добавила ВТОРАЯ ФАЗА стенда (ряд выбранного
   города + плитки вида): без неё дефект «шторка проигрывает появление второй раз
   после выбора города» на витрине невидим — у обоих движков выбора поле живёт всю
   жизнь поверхности, и менять на них нечего. Причина известная и названа в самой метрике: `components/ui/**`
   она считает легаси — в знаменателе, но не в числителе, — а стенд ОБЯЗАН звать
   `<PickerSheet>` и `<LpSheet>` НАСТОЯЩИЕ (иначе он показывает не те поверхности,
   что живут в приложении). Плюс разметка панели (`.lp-h`/`.lp-b`/`.lp-f`) —
   host-теги: компонента-панели в ДС нет, есть доменные обёртки. Числитель при
   этом ВЫРОС (Btn/Card/IconBtn/Input стенда), просто знаменатель вырос сильнее.
   Лечится переездом семьи в `src/design/` — отдельная задача, в этот PR она не
   входит осознанно (замер: весь слой `components/ui/**` = 14 элементов из 3343,
   потолок переезда +41 bp; тронет всех вызывателей и сделает дифф хрома
   нечитаемым). */
/**
 * ОБЕ ПОЛНОРОСТНЫЕ ПОВЕРХНОСТИ РЯДОМ (TRIP-494).
 *
 * ★ ЗАЧЕМ СТЕНД. У этой семьи не было ни одного: `check-picker-behaviour` знает
 * только шторку пикера, а панель редактора живёт за логином. Поэтому и краска с
 * бровью разъехались молча, и скролл композера доехал до человека сломанным.
 * Здесь они стоят рядом и открываются анонимно — на них можно СМОТРЕТЬ.
 *
 * ⚠️ СПИСОК ЗАВЕДОМО ДЛИННЕЕ ЭКРАНА. Прежняя витрина показывала четыре города —
 * такой лист не переполняется физически, и «скроллер ровно один» на нём
 * недоказуем: именно это и пропустило дефект, при котором лист переставал
 * скроллиться совсем.
 */
// ── Стенд ГРАНИЦЫ КРАХА ПОВЕРХНОСТИ (TRIP-515) ───────────────────────────────
// Грепом недоказуемо: краш ВНУТРИ окна закрывает окно, а не приложение; промис
// confirm() разрешается false даже в async-ветке, где busy-guard глотает
// закрытие. Здесь это можно потрогать и снять check:surfaces-ом. Разметка — из
// ДС (Btn/Badge/Sheet), чтобы стенд не занижал долю ДС; приёмка локерит по тексту.
// Бросает при рендере, когда взведён — моделирует отцепленный переводчиком узел.
function BoomWhenArmed({ armed }) {
  if (armed) throw new Error('kit: surface boom');
  return <Badge>живое содержимое окна{/* i18n-ignore: витрина /kit, приёмка локерит по тексту */}</Badge>;
}
// ★ КРАХ ПРИ busy ЧЕРЕЗ ВНЕШНИЙ СТОР, А НЕ «ВТОРОЙ РЕНДЕР» (ревью Pavel).
// `content` кладётся в состояние ConfirmProvider ОДИН раз; при setBusy(true)
// React видит тот же объект элемента → bail-out по ссылке, поддерево content НЕ
// перерисовывается, и «упасть на втором рендере» не наступает НИКОГДА (промис
// приходил true — штатное завершение, а не отмена). useSyncExternalStore
// перерисовывает подписчика МИМО bail-out: `arm(true)` из onConfirm роняет узел
// именно во время busy — тогда onOpenChange глотается busy-guard'ом и работает
// ТОЛЬКО жёсткая отмена через SurfaceCrashContext. Это и есть инвариант п.4.
let boomBusy = false;
const boomSubs = new Set();
const boomStore = {
  arm(v) { boomBusy = v; boomSubs.forEach((fn) => fn()); },
  subscribe(fn) { boomSubs.add(fn); return () => boomSubs.delete(fn); },
  get() { return boomBusy; },
};
function BoomOnBusy() {
  const busy = useSyncExternalStore(boomStore.subscribe, boomStore.get);
  if (busy) throw new Error('kit: busy boom');
  return <Badge>содержимое (упадёт при busy){/* i18n-ignore: витрина /kit */}</Badge>;
}
function SurfaceCrashDemo() {
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [promiseResult, setPromiseResult] = useState('—');

  // async-ветка: красная кнопка ставит busy=true, onConfirm арм-ит внешний стор →
  // содержимое роняется ВО ВРЕМЯ busy. Граница обязана закрыть окно И разрешить
  // промис false (жёсткая отмена мимо busy-guard). Действие живёт 400 мс — поздний
  // settle(true) обязан быть no-op.
  const runBusyConfirm = async () => {
    boomStore.arm(false);
    setPromiseResult('ждём…');
    const ok = await confirm({
      title: 'Крах при busy',
      content: <BoomOnBusy />,
      variant: 'destructive',
      confirmLabel: 'Уронить окно',
      onConfirm: async () => { boomStore.arm(true); await new Promise((r) => setTimeout(r, 400)); },
    });
    setPromiseResult(ok ? 'true' : 'false');
    boomStore.arm(false);
  };

  return (
    <div className="col col--g4">
      {/* Сосед вне окна: жив после краха = приложение не упало (не крах-экран).
          Строки стенда — демо-данные витрины, под t() не идут: приёмка
          check:surfaces локерит стенд ровно по этому тексту (has-text). */}
      <Badge>сосед жив{/* i18n-ignore: витрина /kit, приёмка локерит по тексту */}</Badge>

      {/* Сценарий 1: краш внутри шита закрывает ШИТ, а не приложение. */}
      <Btn variant="secondary" onClick={() => { setArmed(false); setOpen(true); }}>Открыть шит{/* i18n-ignore: витрина /kit */}</Btn>
      <Sheet open={open} onOpenChange={setOpen} title="Стенд краха"/* i18n-ignore: витрина /kit */>
        <Btn variant="danger-solid" onClick={() => setArmed(true)}>Сломать содержимое{/* i18n-ignore: витрина /kit */}</Btn>
        <BoomWhenArmed armed={armed} />
      </Sheet>

      {/* Сценарий 2: краш при busy — промис confirm() обязан разрешиться false. */}
      <Btn variant="secondary" onClick={runBusyConfirm}>Confirm с крахом при busy{/* i18n-ignore: витрина /kit */}</Btn>
      <Badge>промис: {promiseResult}</Badge>
    </div>
  );
}

function FullSurfaceDemo() {
  const [picker, setPicker] = useState(false);
  const [q, setQ] = useState('');
  /* ★ ВТОРАЯ ФАЗА — ЧАСТЬ СТЕНДА, А НЕ УКРАШЕНИЕ. Композер города меняет
     содержимое ОДНОЙ открытой поверхности: поле и лист уходят, приходят плитки
     вида. Ровно на этой смене и сломался въезд (условие стояло живым запросом по
     содержимому, и перебивание vaul отваливалось вместе с полем — шторка
     проигрывала появление второй раз). Без фазы на стенде дефект невидим: у
     обоих движков выбора поле живёт всю жизнь поверхности. */
  const [picked, setPicked] = useState(null);
  /* ★ СТОПКА СЛОЁВ ВНУТРИ ОДНОЙ ШТОРКИ — модель редактора (TRIP-496). Именно на
     ней ломалось закрытие: свайп вниз vaul считает закрытием ПОВЕРХНОСТИ, а
     обработчик снимал только верхний слой — поверхность оставалась «открытой» и
     залипала там, где её бросил палец. Стенд держит стопку затем, чтобы это
     проверялось жестом, а не рассуждением. */
  const [layers, setLayers] = useState(/** @type {string[]} */ ([]));
  /* ★ ТРЕТЬЯ ПОВЕРХНОСТЬ СЕМЬИ — ОКНО (TRIP-499), и роль у него ПЕРЕКЛЮЧАЕМАЯ.
     Стенд показывает не «как выглядит полный рост» (это видно и на одной кнопке),
     а РАЗНИЦУ: то же окно, то же содержимое, отличается один проп. Без сравнения
     рядом «92% против 100%» на глаз не читается — а именно им роль и меряют. */
  const [dlgFull, setDlgFull] = useState(/** @type {boolean|null} */ (null));
  const top = layers[layers.length - 1] || null;
  const rows = KIT_CITIES.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));
  return (
    /* ★ ПЕРЕНОС — НЕ УКРАШЕНИЕ. Третья кнопка увела ряд за край: замер на 390 —
       ряд 437 px, правая кнопка кончалась на 476, переполнение 86 px, и движок
       отзумивал страницу целиком (`innerWidth` 477 вместо 390). Стенд, который
       сам просит смотреть на 390, обязан на 390 помещаться. Класс канонный
       (`.row--wrap`), это та же семья ряда. */
    <div className="row row--g4 row--wrap">
      <Btn variant="secondary" onClick={() => setPicker(true)}>{TX.fsPicker}</Btn>
      <Btn variant="secondary" onClick={() => setLayers(['city'])}>{TX.fsPanel}</Btn>
      <Btn variant="secondary" onClick={() => setDlgFull(true)}>{TX.fsDialog}</Btn>

      <PickerSheet
        open={picker}
        onOpenChange={(o) => { setPicker(o); if (!o) setPicked(null); }}
        title={TX.fsPickerTitle}
        full
        pinned
        /* Поле — в слоте, пока фаза первая. На второй его нет ВОВСЕ: коробка та
           же, содержимое другое. `pinned` при этом не мигает — способ въезда
           объявлен поверхностью на всю её жизнь. */
        search={picked ? null : (
          <div className="ss-search">
            <Input icon="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={TX.acSearchPh} />
          </div>
        )}
      >
        {picked ? (
          <div className="col col--g4">
            <div className="row row--g3 te-add-city">
              <span className="te-add-cityname">{picked.name}</span>
              <Btn variant="link" icon="edit" onClick={() => setPicked(null)}>{TX.fsChange}</Btn>
            </div>
            <span className="eyebrow">{TX.fsPhaseHint}</span>
            <div className="te-add-grid">
              {['bed', 'arrowSwap', 'flag', 'flag'].map((ic, i) => (
                <button key={i} type="button" className="te-add-type"><Icon name={ic} size={17} /><span className="t-label">{TX.fsKinds[i]}</span></button>
              ))}
            </div>
            <Btn variant="primary" onClick={() => setPicker(false)}>{TX.fsAdd}</Btn>
          </div>
        ) : (
          <div className="ss-list scrollbar-thin" role="listbox" {...sheetScroller}>
            {rows.map((c) => (
              <button key={c.id} type="button" className="ss-opt" onClick={() => setPicked(c)}>
                <span className="col col--g1"><span className="t-strong">{c.name}</span><span className="t-meta">{c.sub}</span></span>
              </button>
            ))}
          </div>
        )}
      </PickerSheet>

      {/* ★ ВЛОЖЕННОСТЬ — ОТДЕЛЬНЫЙ СЛУЧАЙ СТЕНДА (TRIP-496). В приложении шторка
          поверх шторки — обычное дело (панель города → бронь/переезд), а приёмки
          у этой пары не было: витрина показывала поверхности поодиночке. */}
      {/* Открытость — ФАКТ (`open={!!top}`), а дисмисс закрывает ПОВЕРХНОСТЬ
          (`setLayers([])`), а не снимает слой: свайп и тап по фону — жесты про всю
          шторку. «Назад» снимает ровно один слой. */}
      <LpSheet open={!!top} onClose={() => setLayers([])} title={TX.fsPanelTitle}>
        <div className="lp">
          <div className="lp-h">
            <IconBtn icon="chevL" tone="soft" round ariaLabel={TX.fsBack}
              onClick={() => setLayers((l) => l.slice(0, -1))} />
            <div className="lp-ti"><b>{top === 'transfer' ? TX.fsDrillTitle : TX.fsPanel}</b></div>
          </div>
          <div className="lp-b scrollbar-thin" {...sheetScroller}>
            {top === 'transfer'
              ? <p className="t-body">{TX.fsDrillBody}</p>
              : KIT_CITIES.map((c) => (
                <Card key={c.id} recessed radius="md"><div className="t-strong">{c.name}</div><div className="t-meta muted">{c.sub}</div></Card>
              ))}
          </div>
          <div className="lp-f">
            {top === 'transfer'
              ? <Btn variant="secondary" onClick={() => setLayers((l) => l.slice(0, -1))}>{TX.fsBack}</Btn>
              : <Btn variant="secondary" onClick={() => setLayers((l) => [...l, 'transfer'])}>{TX.fsDrill}</Btn>}
            <Btn variant="primary" onClick={() => setLayers([])}>{TX.fsSave}</Btn>
          </div>
        </div>
      </LpSheet>

      {/* Окно берёт у семьи коробку, краску, бровь и резерв под клавиатуру; своё у
          него — карточка `.dlg` между поверхностью и телом. `pinned` не даётся
          намеренно: приём ключуется на слотах пикера, которых тут нет. */}
      {dlgFull !== null && (
        <Dialog
          title={TX.fsDialogTitle}
          icon="headset"
          full={dlgFull}
          onClose={() => setDlgFull(null)}
          foot={(
            <>
              <Btn variant="quiet" onClick={() => setDlgFull(!dlgFull)}>
                {dlgFull ? TX.fsDialogOff : TX.fsDialogOn}
              </Btn>
              <Btn variant="primary" onClick={() => setDlgFull(null)}>{TX.fsSave}</Btn>
            </>
          )}
        >
          <div className="col">
            <Field label={TX.fsDialogField}>
              <Textarea rows={5} placeholder={TX.acSearchPh} />
            </Field>
            <span className="t-meta muted">{TX.fsDialogHint}</span>
            {KIT_CITIES.map((c) => (
              <Card key={c.id} recessed radius="md"><div className="t-strong">{c.name}</div><div className="t-meta muted">{c.sub}</div></Card>
            ))}
          </div>
        </Dialog>
      )}
    </div>
  );
}

function AutocompleteDemo() {
  const [q, setQ] = useState('');
  return (
    <Autocomplete
      inputValue={q}
      onInputChange={setQ}
      search={(query) => KIT_CITIES.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))}
      getKey={(c) => c.id}
      renderRow={(c) => (<span className="col col--g1"><span className="t-strong">{c.name}</span><span className="t-meta">{c.sub}</span></span>)}
      onPick={(c) => setQ(c.name)}
      placeholder={TX.acSearchPh}
      icon="search"
      minChars={1}
      attribution={false}
    />
  );
}

/** Force-state харнесс как ОСЬ «состояние» одного образца: переключатель (Chip,
 *  выбор = aria-pressed) флипает ОДИН экземпляр через состояния, которые примитив
 *  реально поддерживает. hover/active/focus зеркалит `data-force` в Kit.css;
 *  disabled/loading — настоящие пропы. Оболочка несёт АТРИБУТЫ (не классы —
 *  иначе завёлся бы витринный CSS-неймспейс), внутри ровно один `<button>`.
 *  @param {{ kind: string, states: string[], render: (s: string) => any }} p */
function ForceHarness({ kind, states, render }) {
  const [force, setForce] = useState('default');
  return (
    <div className="col col--g3">
      <span className="t-meta">{TX.forceLabel}</span>
      <div className="row row--g3 row--wrap">
        {states.map((s) => (
          <Chip key={s} on={force === s} onClick={() => setForce(s)}>{TX.forceStates[s]}</Chip>
        ))}
      </div>
      <div data-kit={kind} data-force={force}>{render(force)}</div>
    </div>
  );
}

/** Живая витрина тоста: кнопки фаярят настоящие `toast()` через глобальный
 *  <Toaster>, так что видно и появление, и уход, и наслоение колоды. Каждый
 *  вариант — свой тон; «колода» шлёт пачку, чтобы карты встали стопкой. */
const TOAST_DEMO = [
  { variant: 'success', title: TX.toastDemoSaved, description: TX.toastDemoSavedSub },
  { variant: 'info', title: TX.toastDemoLink },
  { variant: 'warning', title: TX.toastDemoCover, description: TX.toastDemoCoverSub },
  { variant: 'error', title: TX.toastDemoDelFail },
  { variant: 'neutral', title: TX.toastDemoDraft },
];
function ToastLab() {
  return (
    <div className="col col--g3">
      <div className="row row--g3 row--wrap">
        {TOAST_DEMO.map((d) => (
          <Btn key={d.variant} variant="secondary" size="sm" onClick={() => toast(d)}>{d.variant}</Btn>
        ))}
        <Btn variant="primary" size="sm" onClick={() => TOAST_DEMO.forEach((d, i) => setTimeout(() => toast(d), i * 140))}>{TX.toastDeck}</Btn>
      </div>
      <span className="t-meta">{TX.toastLab}</span>
    </div>
  );
}

/* ─────────────────────────── рецепты рендера ─────────────────────────────── */
/** Один рецепт = `(ctx) => Array<{ label?, items:[{name,node,full?}] }>`. Значения
 *  оси едут из карты (импортированные `*_VARIANTS`) или из CSS-производного
 *  списка семьи (`ctx.declared` — полные имена классов). Рецепт знает, КАК
 *  показать вариант; ЧТО показать — данные. */
const it = (name, node, full) => ({ name, node, full });
const glyph = 'Ag';

const RECIPES = {
  'booking-warning': () => [
    {
      label: 'kind (тинт типа + иконка)', items: [
        it('kind="transfer"', <BookingWarning kind="transfer" title={TX.warnTransfer} sub={TX.warnTransferSub} onAdd={() => {}} onDismiss={() => {}} />, true),
        it('kind="hotel"', <BookingWarning kind="hotel" title={TX.warnHotel} sub={TX.warnHotelSub} onAdd={() => {}} onDismiss={() => {}} />, true),
      ],
    },
    { label: 'пустой день (.tl3-empty — намеренно не варнинг)', items: [it('<TimelineEmptyDay>', <TimelineEmptyDay label={TX.emptyDayLbl} actionLabel={TX.addActivity} onAdd={() => {}} />, true)] },
  ],
  pagehead: () => [
    { items: [it('title + actions', <PageHead title="Бюджет" actions={<><Btn variant="secondary" icon="arrowSwap">{TX.rates}</Btn><Btn variant="primary" icon="plus">{TX.add}</Btn></>} />, true)] },
    { label: 'title + subtitle', items: [it('subtitle', <PageHead title="Бюджет" subtitle="12 трат · 3 категории" />, true)] },
    { label: 'только title', items: [it('title', <PageHead title="Заголовок" />, true)] },
    { label: 'flush — без нижнего отступа', items: [it('className="pagehead--flush"', <PageHead className="pagehead--flush" title={TX.rowTitle} subtitle={TX.rowSub} />, true)] },
  ],
  stat: () => [
    { label: 'tone (карта STAT_TONES)', items: STAT_TONES.map((t) => it(`tone="${t}"`, <Stat tone={t} icon={t === 'transfer' ? 'arrowSwap' : t === 'activity' ? 'user' : 'wallet'} label={TX.statLabel} value="724,9 тыс ₽" sub={TX.statSub} />, true)) },
    { items: [it('clickable (onClick)', <Stat tone="transfer" icon="arrowSwap" label={TX.rates} value="3 валюты" sub={TX.statTap} onClick={() => {}} />, true)] },
  ],
  donut: () => [
    { items: [it('segments + center', <Donut total={100} center="₽724,9т" label={TX.donutTotal} segments={[{ id: 'a', color: 'var(--brand)', value: 55 }, { id: 'b', color: 'var(--ev-transfer)', value: 25 }, { id: 'c', color: 'var(--muted-2)', value: 20 }]} />, true)] },
  ],
  'list-row': () => [
    { label: 'variant (карта LISTROW_VARIANTS)', items: LISTROW_VARIANTS.map((v) => it(`variant="${v}"`, <ListRow variant={v} lead={v === 'add' ? <Tile tone="quiet" icon="plus" /> : <Tile size="xl" icon="bed" />} title={v === 'add' ? TX.chipAdd : TX.rowTitle} sub={TX.rowSub} trail={v === 'add' ? <Icon name="plus" size={16} /> : <span className="t-strong">₽1 234</span>} onClick={v === 'raised' || v === 'select' || v === 'add' ? () => {} : undefined} />, true)) },
    { items: [it('selected (on)', <ListRow variant="select" selected lead={<Tile size="xl" icon="bed" />} title={TX.rowTitle} sub={TX.rowSub} trail={<span className="t-strong">₽1 234</span>} onClick={() => {}} />, true)] },
    {
      label: 'muted — приглушённая строка (архив/неактивное): гаснет вся строка, вместе с лидом и бейджами',
      items: [it('muted', <ListRow variant="raised" muted lead={<Cover />} title={TX.rowTitle} sub={TX.rowSub} trail={<Icon name="chev" className="muted" />} onClick={() => {}} />, true)],
    },
    {
      label: 'trailSub — второстепенная половина трейла: прячется ≤600px, тогда как основной трейл (действие/шеврон) остаётся',
      items: [it('trailSub + trail', <ListRow variant="raised" lead={<Cover />} title={TX.rowTitle} sub={TX.rowSub} trailSub={<><span className="t-meta tab">{TX.rowDate}</span><Badge variant="pro" icon="pro">PRO</Badge></>} trail={<Icon name="chev" className="muted" />} onClick={() => {}} />, true)],
    },
  ],
  btn: () => [
    { items: [it('force', <ForceHarness kind="btn" states={['default', 'hover', 'active', 'focus', 'disabled', 'loading']} render={(s) => <Btn variant="primary" disabled={s === 'disabled'} loading={s === 'loading'}>{TX.save}</Btn>} />, true)] },
    { label: 'variant (карта BTN_VARIANTS)', items: BTN_VARIANTS.map((v) => it(`variant="${v}"`, <Btn variant={v}>{v}</Btn>)) },
    {
      label: 'формы и состояния', items: [
        it('loading', <Btn variant="primary" loading>{TX.save}</Btn>),
        it('disabled', <Btn variant="primary" disabled>{TX.save}</Btn>),
        it('icon="check"', <Btn variant="secondary" icon="check">{TX.save}</Btn>),
        it('iconRight="chevronRight"', <Btn variant="secondary" iconRight="chevronRight">{TX.save}</Btn>),
        it('block', <Btn variant="primary" block>{TX.save}</Btn>, true),
        it('aria-pressed', <Btn variant="secondary" ariaPressed>{TX.save}</Btn>),
        it('secondary icon="lock" (lockmsg)', <Btn variant="secondary" icon="lock" block>{TX.lockmsg}</Btn>, true),
      ],
    },
    {
      label: 'тон из контекста (--a) · размер (btn--sm) · тень (btn--brand)', items: [
        it('variant="link"', <span style={{ '--a': 'var(--ai-ink)' }}><Btn variant="link">{TX.accent}</Btn></span>), // inline-style-exempt: канал --a ставит владелец контекста (AI-карточка), класса «задать акцент» в системе нет
        it('variant="dashed" block', <span style={{ '--a': 'var(--ai-ink)' }}><Btn variant="dashed" block icon="plus">{TX.accent}</Btn></span>, true), // inline-style-exempt: канал --a ставит владелец контекста
        it('size="sm"', <Btn variant="secondary" size="sm">{TX.save}</Btn>),
        it('size="sm" icon+iconRight', <Btn variant="dashed" size="sm" icon="bed" iconRight="plus" ariaLabel="Добавить" />),
        // btn--brand — аддитивный класс тени под заливку --bg (партнёрская кнопка).
        it('btn--brand', <Btn variant="secondary" className="btn--brand" block style={{ '--bg': 'var(--brand)', '--fg': 'var(--primary-fg)' }}><span className="btn__brandlogo" />{TX.brandName}</Btn>, true), // inline-style-exempt: заливка партнёра каналом --bg из данных, тон ЕСТЬ содержимое
        // locked — действие недоступно роли: приглушён + замок + тултип-причина (TRIP-274 Ф2.2).
        it('locked (замок+тултип)', <Btn variant="secondary" locked lockedHint={TX.lockmsg}>{TX.save}</Btn>, true),
      ],
    },
    {
      family: 'tt',
      items: [
        // Tooltip — глобальный текст-хинт на ховере/фокусе (наведи на триггер).
        it('content (ховер/фокус)', <Tooltip content={TX.lockmsg}><Btn variant="secondary">{TX.save}</Btn></Tooltip>, true),
      ],
    },
    {
      // ★TRIP-344: solid-тон и мягкий тон берут заливку ИЗ КАНАЛА (--hl / --hl-soft),
      // а не из инлайна итогового свойства — поэтому наведи на образец: заливка
      // темнеет (light) / светлеет (dark), ховер жив. Инлайн здесь — ВХОД канала.
      label: 'заливка из канала (--hl = тон контекста) · полу-disabled', items: [
        it('primary в контексте категории', <span style={{ '--hl': 'var(--ev-hotel)' }}><Btn variant="primary" icon="check">{TX.save}</Btn></span>), // inline-style-exempt: вход канала --hl (тон категории) ставит владелец контекста — панель/диалог события
        it('soft тёплый (личные доки)', <Btn variant="soft" icon="plus" style={{ '--hl-soft': 'var(--warm-soft)', '--hl-ink': 'var(--warm-ink)' }}>{TX.chipAdd}</Btn>), // inline-style-exempt: вход канала --hl-soft/--hl-ink (тёплый тон), ровно как DocsLens
        it('aria-disabled (полу-disabled, кликабельна)', <Btn variant="primary" ariaDisabled>{TX.save}</Btn>),
      ],
    },
  ],

  'icon-btn': () => [
    { items: [it('force', <ForceHarness kind="icon" states={['default', 'hover', 'focus', 'disabled']} render={(s) => <IconBtn icon="plus" tone="soft" disabled={s === 'disabled'} ariaLabel="Кнопка" />} />, true)] },
    {
      label: 'tone (карта ICON_BTN_TONES) — база = quiet', items: [
        it('tone="quiet" (база)', <IconBtn icon="close" ariaLabel={TX.close} />),
        ...ICON_BTN_TONES.filter((t) => t !== 'warning' && t !== 'success').map((t) => it(`tone="${t}"`, <IconBtn icon="close" tone={t} ariaLabel={TX.close} />)),
      ],
    },
    {
      label: 'size (карта ICON_BTN_SIZES) + fab-тоны severity', items: [
        ...ICON_BTN_SIZES.map((s) => it(`size="${s}"`, <IconBtn icon="plus" size={s} ariaLabel="Размер" />)),
        ...ICON_BTN_TONES.filter((t) => t === 'warning' || t === 'success').map((t) => it(`size="fab" tone="${t}"`,
          <IconBtn size="fab" tone={t} icon={t === 'warning' ? 'warning' : 'check'} ariaLabel={t}>
            {t === 'warning' && <Badge variant="count">3</Badge>}
          </IconBtn>)),
      ],
    },
    {
      label: 'форма (icon-btn--round) · метка · нажато · счётчик', items: [
        it('round tone="soft"', <IconBtn icon="arrow" round tone="soft" ariaLabel="Форма" />),
        it('tone="outline" round', <IconBtn icon="close" tone="outline" round ariaLabel={TX.close} />),
        it('непрочитанное (.badge--unread)', <IconBtn icon="bell" ariaLabel="Непрочитанное"><UnreadBadge count={7} /></IconBtn>),
        it('disabled', <IconBtn icon="close" disabled ariaLabel={TX.close} />),
        it('aria-pressed', <IconBtn icon="globe" ariaPressed ariaLabel="Нажато" />),
        it('sliders · outline · .badge--count', <IconBtn icon="sliders" tone="outline" ariaLabel="Фильтры"><Badge variant="count">2</Badge></IconBtn>),
      ],
    },
  ],

  chip: (ctx) => [
    { items: [it('force', <ForceHarness kind="chip" states={['default', 'hover', 'focus', 'disabled']} render={(s) => <Chip disabled={s === 'disabled'}>{TX.members}</Chip>} />, true)] },
    {
      label: 'variant (карта CHIP_VARIANTS) — база = neutral', items: [
        it('neutral (база) count', <Chip on={ctx.chipFilter === 'all'} onClick={() => ctx.setChipFilter('all')} count={12}>{TX.chipAll}</Chip>),
        it('neutral count iconRight', <Chip count={3} iconRight="chevD">{TX.chipJump}</Chip>),
        it('variant="tone" (--hl оболочки)', <span className="te-cell--hotel"><Chip variant="tone" icon="plane">{TX.chipRoute}</Chip></span>),
        it('variant="placeholder"', <span className="te-cell--hotel"><Chip variant="placeholder" icon="plus">{TX.chipAdd}</Chip></span>),
        it('variant="soft"', <Chip variant="soft">{TX.chipMore}</Chip>),
      ],
    },
    {
      label: 'модификаторы (extras): square · sm · avatars · dismiss', items: [
        it('square', <Chip square>12 300 ₽</Chip>),
        it('variant="tone" square', <span className="te-cell--act"><Chip variant="tone" square icon="ticket">3</Chip></span>),
        ...[1, 2, 3].map((p) => it(`sm square${ctx.chipPage === p ? ' on' : ''}`, <Chip sm square on={ctx.chipPage === p} onClick={() => ctx.setChipPage(p)}>{p}</Chip>)),
        it('sm square variant="soft"', <Chip sm square variant="soft">{TX.chipMore}</Chip>),
        it('avatars', <Chip avatars><AvatarStack people={[{ name: 'А' }, { name: 'М' }, { name: 'К' }]} />{TX.members}</Chip>),
        it('onRemove — тег со снятием (активный фильтр)', <Chip variant="soft" onRemove={() => {}} removeLabel={TX.chipRemove}>EUR до 20</Chip>),
      ],
    },
  ],

  seg: (ctx) => [
    { label: 'variant="auto" (база)', items: [it('auto', <Seg ariaLabel="Вид" value={ctx.segView} onChange={ctx.setSegView} options={[{ value: 'month', label: 'Месяц' }, { value: 'week', label: 'Неделя' }]} />)] },
    { label: 'variant (карта SEG_VARIANTS)', items: SEG_VARIANTS.map((v) => it(`variant="${v}"`, <Seg variant={v} ariaLabel="Формат" value={ctx.segTone} onChange={ctx.setSegTone} options={[{ value: 'story', label: 'Сторис' }, { value: 'post', label: 'Пост' }]} />, true)) },
    { label: 'тон активного из контекста (--hl на оболочке)', items: [it('--hl (оболочка)', <span className="te-cell--hotel"><Seg ariaLabel="Тон" value={ctx.segTone} onChange={ctx.setSegTone} options={[{ value: 'story', label: 'Сторис' }, { value: 'post', label: 'Пост' }]} /></span>, true)] },
  ],

  stepper: () => [
    { label: 'variant="pill" (база)', items: [it('pill', <Stepper value={3} onMinus={() => {}} onPlus={() => {}} minusLabel="−" plusLabel="+" />)] },
    { label: 'variant (карта STEPPER_VARIANTS)', items: STEPPER_VARIANTS.map((v) => it(`variant="${v}"`, <Stepper variant={v} value={v === 'block' ? '14 авг' : 2} onMinus={() => {}} onPlus={() => {}} minusLabel="−" plusLabel="+" />, v === 'block')) },
    // `readOnly` — СОСТОЯНИЕ, а не ось: в `STEPPER_VARIANTS` его нет и быть не
    // должно (карта оси типизирует `variant`), поэтому строка собрана руками.
    // Смысл показа — разница между «значением без контрола» и «контролом с
    // выключенными кнопками»: она видна только сравнением с базой выше, а
    // перепутать легко, и тогда вернутся disabled-кнопки, которые всё ещё
    // обещают нажатие.
    //
    // `block` тут НЕ показан намеренно. У этого варианта центр держит не сам
    // степпер, а потомок вызывателя (`.ts-startctl__date` с `flex: 1`), поэтому
    // синтетический образец со строкой вместо него нарисовал бы облик, которого
    // у варианта нет — витрина врала бы. Живого сочетания `block + readOnly`
    // сегодня не существует: read-only ставит только «Маршрут», и он инлайновый.
    {
      label: 'readOnly — ЗНАЧЕНИЕ без контрола (наблюдатель на «Маршруте»)',
      items: [
        it('pill · readOnly', <Stepper readOnly value={3} />),
        it('bare · readOnly (ряд маршрута)', <Stepper variant="bare" readOnly value={<>3<span className="muted">н</span></>} />),
      ],
    },
  ],

  swatch: (ctx) => [
    {
      label: 'variant="color" (база) — выбор = aria-pressed',
      items: ctx.swColors.map((c) =>
        it(ctx.swColor === c ? 'color aria-pressed' : 'color', <Swatch on={ctx.swColor === c} onClick={() => ctx.setSwColor(c)} style={{ background: c }} />)), // inline-style-exempt: цвет ЕСТЬ содержимое свотча (BudgetLens), классом не выразить
    },
    {
      label: 'variant (карта SWATCH_VARIANTS): icon · round',
      items: [
        ...['bed', 'plane', 'ticket'].map((ic) =>
          it(ctx.swIcon === ic ? 'icon aria-pressed' : 'icon', <Swatch variant="icon" icon={ic} on={ctx.swIcon === ic} tint={ctx.swColor} onClick={() => ctx.setSwIcon(ic)} />)),
        ...ctx.swCovers.map((g, i) =>
          it(ctx.swCover === i ? 'round aria-pressed' : 'round', <Swatch variant="round" on={ctx.swCover === i} onClick={() => ctx.setSwCover(i)} style={{ background: g }} />)), // inline-style-exempt: градиент обложки ЕСТЬ содержимое свотча (TripCoverPicker)
      ],
    },
  ],
  // floor-exempt: inline +5 — образцы витрины /kit для CityBar/EventChip: размер полосы и позиционирование block-варианта задаёт ячейка/тайм-грид, в галерее их даёт обёртка; апрув Pavel
  'city-bar': () => [
    {
      // Оси у полосы нет — обличье одно. Показываем его на двух тонах палитры:
      // витрина иллюстрирует ТОН (данные), а не выбор облика.
      label: 'полоса города (обличье одно, ось снята): тон из CITY_TONES',
      items: [
        it('tone={0}', <span style={{ display: 'flex', width: 120, height: 22 }}><CityBar tone={0} label="Рим" /></span>), // inline-style-exempt: размер образца полосы (в календаре высоту даёт ячейка)
        it('tone={1}', <span style={{ display: 'flex', width: 120, height: 22 }}><CityBar tone={1} label="Витербо" /></span>), // inline-style-exempt: размер образца полосы
      ],
    },
  ],
  'event-chip': () => [
    {
      label: 'variant (карта EVENTCHIP_VARIANTS): inline · allday · block',
      items: EVENTCHIP_VARIANTS.map((v) => it(`variant="${v}"`,
        v === 'block'
          ? <span style={{ position: 'relative', display: 'block', width: 130, height: 44 }}><EventChip variant="block" type="activity" time="10:00" title="Музеи" style={{ inset: 0 }} /></span> // inline-style-exempt: block позиционируется координатами тайм-грида · i18n-ignore: демо-данные витрины /kit
          // у `allday` времени НЕТ по построению (событие без часа) — образец
          // витрины обязан показывать примитив таким, каким его зовёт экран
          : <span style={{ display: 'flex', width: 130 }}><EventChip variant={v} type="activity" time={v === 'allday' ? undefined : '10:00'} title="Музеи" /></span>)), // inline-style-exempt: ширина образца токена события · i18n-ignore: демо-данные витрины /kit
    },
  ],

  badge: (ctx) => [
    { label: 'variant (CSS-производный список семьи)', items: ctx.declared.map((c) => it(`variant="${tailOf(c)}"`, <Badge variant={tailOf(c)}>{tailOf(c)}</Badge>)) },
    {
      label: 'роль участника = тон бейджа (не свой класс)', items: [
        it('variant="warning"', <Badge variant="warning">{TX.roleOwner}</Badge>),
        it('variant="brand"', <Badge variant="brand">{TX.roleAdmin}</Badge>),
        it('variant="outline"', <Badge variant="outline">{TX.roleViewer}</Badge>),
        it('variant="quiet"', <Badge variant="quiet">{TX.rolePending}</Badge>),
      ],
    },
    {
      // Признак-отметка = обычный бейдж ДС с иконкой (например «ночной переезд»
      // в редакторе трансфера), а не свой тинтованный бокс.
      label: 'с иконкой (icon) — признак-отметка', items: [
        it('variant="brand" icon="moon"', <Badge variant="brand" icon="moon">{TX.overnight}</Badge>),
      ],
    },
    {
      // Канон НЕПРОЧИТАННОГО (TRIP-354): красный `<UnreadBadge count>` — единый
      // счётчик для уведомлений и чата (колокольчик, FAB чата, пункты дока, шит,
      // аккаунт). Число, свыше 99 → «99+», 0 → ничего. Оверлеем садится
      // ко-селектором владельца (`.icon-btn > .badge--unread`).
      label: 'непрочитанное — <UnreadBadge count> (красный канон)', items: [
        it('count={3}', <UnreadBadge count={3} />),
        it('count={128} → 99+', <UnreadBadge count={128} />),
        it('на кнопке-иконке (оверлей)', <IconBtn icon="bell" tone="outline" ariaLabel="Уведомления"><UnreadBadge count={5} /></IconBtn>),
      ],
    },
  ],

  card: () => {
    // Проп-набор на каждый суффикс `.card--*`: витрина ПОЛНА ПО ПОСТРОЕНИЮ -
    // рисует ровно то, что объявляет карта `CARD_VARIANTS` (тест дрейфа сверяет
    // её ↔ живой CSS в обе стороны). radius/tone эмитятся своими пропами; булевы
    // формы - одноимённым пропом; danger - `danger`; до-края - `pad="none"`.
    const P = {
      'r-lg': { radius: 'lg' }, 'r-md': { radius: 'md' }, 'r-card': { radius: 'card' }, 'r-btn': { radius: 'btn' }, featured: { featured: true }, raised: { raised: true },
      interactive: { as: 'button', radius: 'md', interactive: true },
      'tone-brand': { tone: 'brand', radius: 'md' },
      'tone-ai': { tone: 'ai' },
      add: { as: 'button', variant: 'add', radius: 'md', interactive: true },
      recessed: { recessed: true }, locked: { locked: true }, parsed: { parsed: true },
      flush: { pad: 'none' }, danger: { danger: true },
    };
    const body = (v) =>
      v === 'danger' ? <Severity level="error" title={TX.cardHead}>{TX.sevText}</Severity>
        : v === 'flush' ? <Skeleton h={64} r={0} />
          : v === 'add' ? <b>{TX.cardHead}</b>
            : <><CardHeader title={TX.cardHead} /><p className="t-body">{TX.cardBody}</p></>;
    // Ось СОСТОЯНИЙ карточки (TRIP-343 объект 2): невоспроизводимые в статике
    // состояния под ПЕРЕКЛЮЧАТЕЛЯМИ, как у кнопки (:243). Каждое несёт РЕАЛЬНЫЙ
    // проп/атрибут (закон 5: состояние = данные, не класс), приёмка — свой
    // переключатель + подпись именем:
    //   hover    → data-hovered на обёртке-поведении → канон [data-hovered] > .card--interactive
    //   selected → aria-selected на обёртке          → канон [aria-selected] > .card--interactive
    //   focus    → зеркало data-force в Kit.css (:focus-visible не форсится), как у кнопки
    //   parsed / locked → пропы (свой канон .card--parsed/.card--locked)
    //   busy     → ariaBusy → aria-busy (несущий атрибут ai-blk «проверяю/занята»; облик — канон покоя, нового скина не заводим)
    //   dragover → dataDragover → data-dragover (несущий атрибут дропзоны; облик — канон покоя)
    const cardState = (s) => (
      <div
        data-hovered={s === 'hover' ? '' : undefined}
        aria-selected={s === 'selected' ? 'true' : undefined}
      >
        <Card
          as="button"
          radius="md"
          interactive
          parsed={s === 'parsed'}
          locked={s === 'locked'}
          ariaBusy={s === 'busy'}
          dataDragover={s === 'dragover'}
        >
          <CardHeader title={TX.cardHead} />
          <p className="t-body">{TX.cardBody}</p>
        </Card>
      </div>
    );
    return [
      {
        items: [it('force', <ForceHarness kind="card" states={['default', 'hover', 'focus', 'selected', 'busy', 'parsed', 'locked', 'dragover']} render={cardState} />, true)],
      },
      {
        label: 'слот CardHeader (заголовок · подзаголовок · действие справа)',
        items: [it('CardHeader', <div className="grow"><Card radius="lg"><CardHeader title={TX.cardTitle} subtitle="Подзаголовок" action={<Badge variant="quiet">{TX.canon}</Badge>} /><p className="t-body">{TX.cardBody}</p></Card></div>, true)],
      },
      {
        label: 'формы (карта CARD_VARIANTS) — .card--*',
        items: CARD_VARIANTS.map((v) => it(`card--${v}`, <div className="grow"><Card {...P[v]}>{body(v)}</Card></div>, true)),
      },
    ];
  },

  field: (ctx) => [{
    items: [it('field + field-row', (
      <div className="col col--g4 grow">
        <Field label="Название" hint="Подсказка под полем" required><Input placeholder={TX.placeholder} /></Field>
        <Field label="Многострочное поле"><Textarea rows={2} placeholder={TX.placeholder} /></Field>
        <InputGroup><Input placeholder={TX.placeholder} /><Btn variant="secondary" icon="search" ariaLabel={TX.placeholder} /></InputGroup>
        <Field label="Невалидное"><Input placeholder={TX.placeholder} aria-invalid="true" /></Field>
        <Field label="Предупреждение"><Input placeholder={TX.placeholder} data-warning="" /></Field>
        <Field label="Недоступно (disabled)"><Input placeholder={TX.placeholder} disabled /></Field>
        <Field label="Только чтение (readOnly)"><Input readOnly defaultValue="Можно выделить и скопировать" /></Field>
        {ctx.declared.filter((c) => c.startsWith('field-row')).map((c) => (
          <div key={c} className={`field-row ${c}`}>
            <Field label="Город вылета"><Input placeholder={TX.placeholder} /></Field>
            <Field label="Дата"><Input placeholder={TX.placeholder} /></Field>
          </div>
        ))}
      </div>
    ), true)],
  }],

  input: (ctx) => [{
    items: [it('декорации эмитит сам <Input>', (
      <div className="col col--g4 grow">
        <Field label="Иконка слева (проп icon → input-affix--ic)"><Input icon="search" placeholder={TX.placeholder} /></Field>
        <Field label="Кольцо справа (проп loading → input-affix--end)"><Input loading placeholder={TX.placeholder} /></Field>
        {ctx.declared.filter((c) => c.startsWith('input-unit')).map((c) => (
          <Field key={c} label={c}>
            <InputGroup><span className={`input-unit ${c}`}>₽</span><Input num placeholder={TX.placeholder} /></InputGroup>
          </Field>
        ))}
      </div>
    ), true)],
  }],

  'full-surface': () => [{
    items: [it('три поверхности семьи — открыть и сравнить', <FullSurfaceDemo />, true)],
  }],

  'surface-crash': () => [{
    items: [it('краш внутри окна закрывает окно, а не приложение', <SurfaceCrashDemo />, true)],
  }],

  autocomplete: () => [{
    items: [it('поиск-по-мере-ввода (Popover + .ss-list) — введите «ли» / «ма»', (
      <div className="grow" style={{ maxWidth: 360 }}>
        <AutocompleteDemo />
      </div>
    ), true)],
  }],

  avatar: (ctx) => [
    {
      label: 'размеры (CSS) + вид (эмитит компонент)', items: [
        ...['sm', undefined, 'lg'].map((s) => it(s ? `size="${s}"` : 'size (md)', <Avatar name="Pavel M" size={s} />)),
        it('kind="ai"', <Avatar name="AI" kind="ai" />),
        it('kind="placeholder"', <Avatar name="?" kind="placeholder" />),
        it('deleted', <Avatar name="X" deleted />),
      ],
    },
    {
      label: 'стопка', items: [
        it('AvatarStack', <AvatarStack people={[{ name: 'A B' }, { name: 'C D' }, { name: 'E F' }, { name: 'G H' }, { name: 'I J' }]} />),
        ...ctx.declared.filter((c) => c.startsWith('avatar-stack')).map((c) => it(c,
          // подложка = условие видимости белого кольца (в проде — фото-обложка)
          <div className="tile tile--lg tile--solid tile--ai" style={{ width: 'auto', padding: '0 8px' }}>{/* inline-style-exempt: подложка = условие видимости белого кольца (в проде фото-обложка) */}
            <AvatarStack className={c} people={[{ name: 'A B' }, { name: 'C D' }, { name: 'E F' }]} />
          </div>)),
      ],
    },
  ],

  sev: (ctx) => [{
    items: [it('уровни', (
      <div className="col col--g4 grow">
        {ctx.declared.map((c) => {
          const t = tailOf(c);
          return t === 'dashed'
            ? <Severity key={c} level="info" dashed title={TX.sevInviteTitle}>{TX.sevInvite}</Severity>
            : <Severity key={c} level={t} title={TX.sevTitle}>{TX.sevBody}</Severity>;
        })}
      </div>
    ), true)],
  }],

  'empty-state': (ctx) => [{
    items: [
      it('base', <div className="grow"><EmptyState title={TX.emptyTitle} body={TX.emptyBody} action={<Btn variant="primary">{TX.save}</Btn>} /></div>, true),
      // Канон «раздел в разработке» (TRIP-302): тот же EmptyState с иконкой-молотком
      // и тоном warning — вид, который показывается модалкой на неготовом разделе.
      it('в разработке', <div className="grow"><EmptyState icon="hammer" kind="warning" title={TX.devTitle} body={TX.devBody} /></div>, true),
      ...ctx.declared.filter((c) => c.startsWith('empty-state')).map((c) => it(c, <div className="grow"><EmptyState boxed title={TX.emptyBoxTitle} body={TX.emptyBoxBody} /></div>, true)),
    ],
  }],

  checkbox: (ctx) => [{
    items: [
      it('checked', <Checkbox checked={ctx.checked} onChange={ctx.setChecked} label="Название" />),
      it('disabled', <Checkbox checked={false} onChange={() => {}} label="Название" disabled />),
    ],
  }],

  switch: (ctx) => [{
    items: [
      it('on', <Toggle on={ctx.toggled} onChange={ctx.setToggled} label="Название" />),
      it('busy', <Toggle on={ctx.toggled} onChange={() => {}} busy label="Название" />),
      it('locked', <Toggle on={false} onChange={() => {}} locked label="Название" />),
    ],
  }],

  'doc-row': () => [{
    items: [
      it('default', <FileRow name="documents-2026.pdf" size="178 КБ" />, true),
      it('tone="ai" (doc-row--ai)', <FileRow name="documents-2026.pdf" size="178 КБ" tone="ai" />, true),
    ],
  }],

  skeleton: () => [{
    items: [
      it('w="60%" h={18}', <Skeleton w="60%" h={18} />, true),
      it('default', <Skeleton />, true),
      it('w="80%"', <Skeleton w="80%" />, true),
    ],
  }],

  dialog: (ctx) => [{
    items: [
      it('Dialog', <Btn variant="secondary" onClick={() => ctx.setDialogOpen(true)}>{TX.openDialog}</Btn>),
      it('Sheet', <Btn variant="secondary" onClick={() => ctx.setSheetOpen(true)}>{TX.openSheet}</Btn>),
      ...ctx.declared.map((c) => { const sz = tailOf(c); return it(`size="${sz}"`, <Btn variant="secondary" onClick={() => ctx.setDlgSize(sz)}>{TX.openDialog}</Btn>); }),
    ],
  }],

  accordion: () => [{
    items: [
      it('icon + subtitle + badge-нода (статус) · раскрыт',
        <Accordion icon="telegram" tone="info" title={'Telegram'} subtitle={'Аккаунты для уведомлений по путешествиям'} badge={<Badge variant="success" size="tiny">{'подключён'}</Badge>} defaultOpen>{/* i18n-ignore: витрина /kit, dev-only */}
          <div className="t-meta muted">{'Вложенное тело: любой контент (строки, поля, список).'/* i18n-ignore: витрина /kit */}</div>
        </Accordion>, true),
      it('title + count badge (число)',
        <Accordion title={'Детали брони'} subtitle={'рейс · отель · трансфер'} badge={3}>{/* i18n-ignore: витрина /kit, dev-only */}
          <div className="t-meta muted">{'Поля брони…'/* i18n-ignore: витрина /kit */}</div>
        </Accordion>, true),
      it('свёрнут (шеврон вправо), без иконки',
        <Accordion title={'Документы и заметки'/* i18n-ignore: витрина /kit */}>
          <div className="t-meta muted">{'…'}</div>
        </Accordion>, true),
    ],
  }],

  cover: () => [
    {
      label: 'обложка трипа (<Cover>): фоллбек-картинка из бандла, когда фото нет',
      items: [it('без image (фоллбек)', <Cover />)],
    },
    {
      items: [it('image (фото поверх фоллбека)', <Cover image="/flags/es.svg" />)],
    },
    {
      label: 'fill — обложка во всю площадь родителя, а не своя миниатюра 62×46; показана в своём вызывателе — постере трипа (.tc__bg под скримом)',
      items: [it('fill', (
        <span className="tc tc--live">
          <span className="tc__bg"><Cover fill image="/flags/es.svg" /></span>
          <span className="tc__scrim" />
        </span>
      ))],
    },
  ],

  coverpicker: (ctx) => [
    {
      label: 'кадр 4:3 (дефолт) + лента миниатюр; свайп/стрелки листают сам кадр',
      items: [it('slides + value + onChange', (
        <CoverPicker
          slides={ctx.cpSlides}
          value={ctx.cpValue}
          onChange={ctx.setCpValue}
          onUpload={() => {}}
          ariaLabel={'Галерея обложек'/* i18n-ignore: витрина /kit */}
          uploadLabel={'Загрузить своё фото'/* i18n-ignore: витрина /kit */}
        />
      ), true)],
    },
    {
      label: 'disabled — свайп ленты выключен, кнопок нет (read-only)',
      items: [it('disabled', (
        /* Значение — НЕ первый слайд намеренно: read-only показывает выбранную
           миниатюру, а лента при открытии обязана быть доведена до неё. */
        <CoverPicker
          slides={ctx.cpSlides}
          value={ctx.cpSlides[9]}
          disabled
          ariaLabel={'Галерея обложек'/* i18n-ignore: витрина /kit */}
        />
      ), true)],
    },
    {
      label: 'loading — источник картинок ещё отвечает: ряд дорисован заглушками',
      items: [it('loading', (
        <CoverPicker
          slides={[ctx.cpSlides[1]]}
          value={ctx.cpSlides[1]}
          loading
          ariaLabel={'Галерея обложек'/* i18n-ignore: витрина /kit */}
        />
      ), true)],
    },
    {
      label: 'пустой слайд (\'\') — «без обложки», рисуется фоллбеком <Cover>',
      items: [it("slides={['']}", (
        <CoverPicker
          slides={['']}
          value=""
          ariaLabel={'Галерея обложек'/* i18n-ignore: витрина /kit */}
        />
      ), true)],
    },
  ],


  // Строка уведомления — один компонент на все типы и обе поверхности. Показана
  // КАК В ПРИЛОЖЕНИИ: строки стопкой на реалистичной ширине, с теми же кнопками
  // (accept/decline, «Открыть трип», бейджи) — статикой, без интерактива. Глиф по
  // ТИПУ события: аватар (человек) · плитка (аккаунт/доступ/оплата) · pro.
  notif: () => {
    // Демо-контент витрины (dev-only, НЕ UI-строки): как `TX`, живёт в ДАННЫХ, а
    // не JSX-литералами — i18n-гард 2d не считает это хардкодом (флагает JSX-props/
    // текст, не свойства объектов). Ярлыки кнопок/бейджей — JSX-константы, помечены
    // `// i18n-ignore` (демо-подписи /kit, показывают слоты действий строки).
    const link = <Btn variant="link" icon="pin">Открыть трип</Btn>; // i18n-ignore: демо-подпись витрины /kit
    const inviteActs = <><Btn variant="primary" icon="check">Принять</Btn><Btn variant="secondary">Отклонить</Btn></>; // i18n-ignore: демо-подписи витрины /kit
    const acceptedActs = <><Badge variant="success" icon="check">Ты в путешествии</Badge>{link}</>; // i18n-ignore: демо-подпись витрины /kit
    const declinedActs = <Badge variant="quiet">Отклонил</Badge>; // i18n-ignore: демо-подпись витрины /kit
    const goTrips = <Btn variant="primary" icon="plus" block>Перейти к путешествиям</Btn>; // i18n-ignore: демо-подпись витрины /kit
    const inbox = [
      { unread: true, glyph: { mode: 'avatar', name: 'Женя Соколов' }, title: 'Женя Соколов зовёт в путешествие', message: 'Токио, весна · роль наблюдателя', time: '5 мин', actions: inviteActs },
      // Бронь добавлена — 4 вида (TRIP-284): заголовок «{автор} добавил(а) <вид>»,
      // тело «<Вид> в «{трип}»». activity — новый тип (раньше не уведомлялся вовсе).
      { unread: true, glyph: { mode: 'avatar', name: 'Костя Марков' }, title: 'Костя Марков добавил(а) отель', message: 'Отель в «Токио, весна»', time: '2 ч', actions: link },
      { glyph: { mode: 'avatar', name: 'Костя Марков' }, title: 'Костя Марков добавил(а) переезд', message: 'Переезд в «Токио, весна»', time: '3 ч', actions: link },
      { glyph: { mode: 'avatar', name: 'Костя Марков' }, title: 'Костя Марков добавил(а) активность', message: 'Активность в «Токио, весна»', time: '3 ч', actions: link },
      { glyph: { mode: 'avatar', name: 'Костя Марков' }, title: 'Костя Марков добавил(а) услугу', message: 'Услуга в «Токио, весна»', time: '3 ч', actions: link },
      { glyph: { mode: 'avatar', name: 'Марк Лебедев' }, title: 'Марк Лебедев теперь в путешествии', message: 'Токио, весна', time: '4 ч', actions: link },
      { glyph: { mode: 'tile', icon: 'shield', tone: 'brand' }, title: 'Теперь ты администратор', message: 'Лиссабон · можно менять маршрут и бюджет', time: '2 дн', actions: link },
      { glyph: { mode: 'avatar', name: 'Ира Волкова' }, title: 'Ира Волкова зовёт в путешествие', message: 'Токио, весна', time: '2 дн', actions: acceptedActs },
      { glyph: { mode: 'avatar', name: 'Костя Марков' }, title: 'Костя Марков не поедет', message: 'Грузия, октябрь · приглашение отклонено', time: 'вчера', actions: declinedActs },
      { glyph: { mode: 'tile', icon: 'lock', tone: 'danger' }, title: 'Ты больше не участник', message: 'Исландия · доступ закрыт', time: '1 мес', actions: link },
      { glyph: { mode: 'avatar', deleted: true }, title: 'Участник больше не в путешествии', message: 'Грузия, октябрь', time: '6 дн', actions: link },
      { glyph: { mode: 'pro' }, title: 'Pro активирован', message: 'Все функции уже доступны', time: '14 дн' },
      { glyph: { mode: 'tile', icon: 'card', tone: 'danger' }, title: 'Оплата Pro не прошла', message: 'Обнови способ оплаты, чтобы сохранить Pro', time: '3 ч' },
    ];
    const popover = [
      { unread: true, glyph: { mode: 'avatar', name: 'Женя Соколов' }, title: 'Женя Соколов зовёт в путешествие', message: 'Токио, весна', time: '5 мин', actions: inviteActs },
      { unread: true, glyph: { mode: 'avatar', name: 'Костя Марков' }, title: 'Костя Марков добавил(а) отель', message: 'Отель в «Токио, весна»', time: '2 ч', actions: link },
      { glyph: { mode: 'avatar', name: 'Марк Лебедев' }, title: 'Марк Лебедев теперь в путешествии', message: 'Токио, весна', time: '4 ч', actions: link },
      { glyph: { mode: 'tile', icon: 'card', tone: 'danger' }, title: 'Оплата Pro не прошла', message: 'Обнови способ оплаты', time: '3 ч' },
    ];
    const emptyRows = [
      { icon: 'users', title: 'Приглашения', sub: 'Когда тебя позовут в путешествие' },
      { icon: 'refresh', title: 'Обновления', sub: 'Изменения в общих планах' },
      { icon: 'file', title: 'Что нового', sub: 'Новые функции Triplanio' },
    ];
    const emptyTitle = 'Пока пусто'; // i18n-ignore: демо-заголовок витрины /kit
    const emptyBody = 'Здесь появятся приглашения и обновления по твоим путешествиям.'; // i18n-ignore: демо-текст витрины /kit
    return [
      {
        label: 'экран «Входящие» — как в приложении (реалистичная ширина, стопкой)',
        items: [it('inbox', (
          <div style={{ maxWidth: 640, width: '100%' }}>
            {/* inline-style-exempt: витрина — ширина инбокса как в приложении; kit по конвенции своих классов не заводит (Kit.css: только force-state) */}
            {inbox.map((n, i) => <NotifRow key={i} {...n} />)}
          </div>
        ), true)],
      },
      {
        label: 'вариант --compact — поповер колокольчика (уже, плотнее)',
        items: [it('popover', (
          <div style={{ maxWidth: 384, width: '100%' }}>
            {/* inline-style-exempt: витрина — ширина поповера колокольчика как в приложении; kit своих классов не заводит */}
            {popover.map((n, i) => <NotifRow key={i} compact {...n} />)}
          </div>
        ), true)],
      },
      {
        label: 'пустое состояние — что появится (EmptyState + ListRow variant divider)',
        items: [it('empty', (
          <div style={{ maxWidth: 640, width: '100%' }}>
            {/* inline-style-exempt: витрина — ширина инбокса как в приложении; kit своих классов не заводит */}
            <EmptyState
              icon="bell"
              title={emptyTitle}
              body={emptyBody}
              action={(
                <div className="col col--g6 grow--fit">
                  <div>
                    {emptyRows.map((r) => <ListRow key={r.icon} variant="divider" lead={<Tile icon={r.icon} />} title={r.title} sub={r.sub} />)}
                  </div>
                  {goTrips}
                </div>
              )}
            />
          </div>
        ), true)],
      },
    ];
  },

  // TRIP-391 объект 3: витрина рисует ЧЕРЕЗ <Tile>, а не сырым `.tile`, и
  // итерирует карты примитива (TILE_SIZES/TILE_TONES) — полнота по построению,
  // тест дрейфа сверяет карты ↔ живой CSS. Размер плитки и кегль иконки — РАЗНЫЕ
  // оси: ступень несёт и то и другое (--tile / --tile-ic), иконка размера не
  // задаёт (её бьёт `.tile > svg`).
  tile: () => [
    {
      label: 'размер (ось --tile/--tile-ic): дефолт 34 · sm 28 · lg 40 · xl 46 · 2xl 62',
      items: [
        it('base (34)', <Tile icon="star" tone="brand" />),
        ...TILE_SIZES.map((s) => it(`size="${s}"`, <Tile icon="star" tone="brand" size={s} />)),
      ],
    },
    {
      label: 'тон (мягкий оттенок цвета значка — роль-токен, Р7)',
      items: TILE_TONES.map((t) => it(`tone="${t}"`, <Tile icon="sparkles" tone={t} />)),
    },
    {
      label: 'форма и залитая (тоны warm/pro — только залитые, канон)',
      items: [
        it('round', <Tile icon="star" tone="brand" round />),
        it('solid (+brand)', <Tile icon="star" tone="brand" solid />),
        it('solid (+ai)', <Tile icon="sparkles" tone="ai" solid />),
        it('solid (+success)', <Tile icon="check" tone="success" solid />),
        it('solid (+warm)', <Tile icon="star" tone="warm" solid />),
        it('solid (+pro, фирменный --pro-gradient)', <Tile icon="pro" tone="pro" solid />),
        it('children (число вместо иконки)', <Tile tone="quiet" round>3</Tile>),
      ],
    },
    {
      // TRIP-391 объект 3: остатки семей плитки, что НЕ сводятся к плоскому <Tile>
      // (рамка / состояние / контрол / аватар / градиент-глубина). Причины —
      // surface-registry.json _tileFamilyResidual. Показаны здесь, чтобы каждый
      // индивидуальный/уникальный элемент был виден в витрине, а не терялся.
      label: 'вне канона <Tile> — осознанные остатки семей (рамка/состояние/контрол/аватар; не плоская плитка)',
      items: [
        it('.fork-si (рич-медальон: градиент+рамка+glow+угловой spark)', (
          <Card raised className="fork-state fork-state--nomatch">
            <div className="fork-state__art">
              <span className="fork-state__glow" aria-hidden="true" />
              <span className="fork-si"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 21h18M5 21V7l7-4 7 4v14" /></svg><span className="fork-state__spark"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M12 5v14M5 12h14" /></svg></span></span>
            </div>
          </Card>
        )),
        it('.te-step (степпер-контрол, дом <IconBtn>)', <button type="button" className="te-step te-step--del"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg></button>),
        it('.acct-hero__av (аватар, дом Avatar — bg-image / градиент)', <div className="acct-hero__av" style={{ background: 'linear-gradient(135deg, var(--brand), var(--ai))' }} />), // i18n-ignore: подпись демо-образца витрины /kit (dev-only, не UI-строка); inline-style-exempt: демо-фон-градиент — форма аватара видна в витрине (в проде bg-image из данных)
      ],
    },
  ],

  spin: (ctx) => [{
    items: [
      it('spin--ring (база)', <span className="spin spin--ring" />),
      ...ctx.declared.filter((c) => tailOf(c) !== 'ring').map((c) => (
        tailOf(c) === 'onscrim'
          ? it('spin--onscrim', <span className="tile tile--lg tile--solid tile--ai"><span className="spin spin--ring spin--onscrim" /></span>)
          : it(c, <span className={`spin spin--ring ${c}`} />)
      )),
    ],
  }],

  toast: (ctx) => [
    { label: 'живьём — нажми, покажет появление, стопку и уход', items: [it('toast(…)', <ToastLab />, true)] },
    {
      label: 'тон (карта осей)',
      items: ctx.declared.map((c) => it(c, (
        // Kit-only: `.toast` is position:absolute in the deck; `data-kit="toast"`
        // (Kit.css) puts the static swatch back in flow so it renders in its cell.
        <div className={`toast ${c}`} data-kit="toast">
          <span className="tic" />
          <div className="toast__body"><b>{TX.toastTitle}</b><span>{TX.toastBody}</span></div>
        </div>
      ), true)),
    },
  ],

  'sheet-row': (ctx) => [{
    items: [
      it('sheet-row (база)', <button type="button" className="sheet-row">{TX.sheetNormal}</button>, true),
      ...ctx.declared.filter((c) => c.startsWith('sheet-row') && c !== 'sheet-row--tile').map((c) => it(c, <button type="button" className={`sheet-row ${c}`}>{TX.sheetDanger}</button>, true)),
      // TRIP-350: строка «+»-меню — ведущая цветная плитка (тон события) + шеврон.
      // Тон, обычное и disabled состояния (hover/active — CSS-псевдо на самой строке).
      it('--tile (tone=hotel)', <button type="button" className="sheet-row sheet-row--tile"><Tile tone="hotel" icon="file" /><span className="grow">{TX.sheetNormal}</span><Icon name="chev" size={18} /></button>, true),
      it('--tile (tone=activity)', <button type="button" className="sheet-row sheet-row--tile"><Tile tone="activity" icon="users" /><span className="grow">{TX.sheetNormal}</span><Icon name="chev" size={18} /></button>, true),
      it('--tile (disabled)', <button type="button" disabled className="sheet-row sheet-row--tile"><Tile tone="brand" icon="wallet" /><span className="grow">{TX.sheetNormal}</span><Icon name="chev" size={18} /></button>, true),
    ],
  }],

  'ai-blk': () => {
    // TRIP-343 объект 2 (F): скин ai-блока живёт на <Card tone="ai"> (как в проде
    // EventAiBlock). Витрина рисует ЧЕРЕЗ Card, а не сырым <button> — иначе образец
    // показывал бы ai-blk без его поверхности (ровно класс дыры, что был у трансфера).
    // TRIP-337 visual-fixes: шапка структурно НЕИЗМЕННА между свёрнутым и развёрнутым
    // (плитка + заголовок + шеврон стоят всегда), тело всегда в DOM, высота grid-rows.
    const head = (
      <div className="ai-blk-hd">
        <Tile tone="ai" solid size="sm"><Icon name="sparkles" size={15} /></Tile>
        <div className="ai-blk-ti"><b>{TX.aiFill}</b><span>{TX.aiSub}</span></div>
        <span className="ai-blk-x" aria-hidden="true"><Icon name="chevU" size={14} /></span>
      </div>
    );
    const body = (
      <div className="ai-blk__reveal">
        <div className="ai-blk__reveal-inner">
          <div className="ai-blk-body">
            <InputGroup className="ai-input">
              <Textarea rows={2} placeholder={TX.aiPh} readOnly />
              <div className="ai-input-row">
                <Btn variant="secondary" icon="upload">{TX.aiUpload}</Btn>
                <div className="grow" />
                <Btn variant="ai" icon="sparkles">{TX.aiTitle}</Btn>
              </div>
            </InputGroup>
          </div>
        </div>
      </div>
    );
    return [{
      label: 'свёрнуто · развёрнуто (шапка статична; тело всегда в DOM, высота едет grid-rows 0fr→1fr — плавно, в свёрнутом схлопнуто в 0)',
      items: [
        it('ai-blk (свёрнуто — тело схлопнуто в 0)', <Card tone="ai" pad="none" className="ai-blk">{head}{body}</Card>, true),
        it('ai-blk ai-blk--open (развёрнуто)', <Card tone="ai" pad="none" className="ai-blk ai-blk--open">{head}{body}</Card>, true),
      ],
    }];
  },

  time: (ctx) => [{
    items: ctx.declared.filter((c) => c.startsWith('time')).map((c) => it(c, (
      <div className="tl3-ev tl3-ev--tr"><div className={`time ${c}`}><span>08:00</span><span>12:30</span></div></div>
    ))),
  }],

  row: (ctx) => layoutRecipe('row', ctx),
  col: (ctx) => layoutRecipe('col', ctx),
  grid: (ctx) => layoutRecipe('grid', ctx),
};

/** Ступени зазора (замер) + оси. Общая для row/col/grid. */
function layoutRecipe(base, ctx) {
  const declaredG = ctx.steps[base] || new Set();
  const wanted = base === 'grid' ? [2, 3, 4, 5, 6, 7, 8] : [1, 2, 3, 4, 6, 7, 8];
  const gaps = {
    label: 'зазор (ступени --sp-N; отсутствующая ПОМЕЧЕНА, а не выкинута)',
    items: [null, ...wanted].map((step) => {
      const exists = step === null || declaredG.has(step);
      const name = step === null ? `.${base} · ${TX.gapDefault}` : `.${base}--g${step}${exists ? '' : ` · ${TX.missing}`}`;
      return it(name, (
        <div className={step === null ? base : `${base} ${base}--g${step}`}>
          {[0, 1, 2].map((i) => <span key={i} className="tile tile--brand" />)}
        </div>
      ), true);
    }),
  };
  const axisTails = ctx.declared.filter((c) => !/--g\d$/.test(c));
  const axes = {
    label: 'оси выравнивания/потока/колонок',
    items: axisTails.map((c) => it(c, <AxisDemo base={base} ax={tailOf(c)} />, true)),
  };
  return axisTails.length ? [gaps, axes] : [gaps];
}

/** Демо ОДНОЙ оси своим контентом, обнажающим её поведение. */
function AxisDemo({ base, ax }) {
  const cls = `${base} ${base}--${ax}`;
  if (base === 'row' && ax === 'a-baseline') {
    return <div className={cls}><span className="t-display">{glyph}</span><span className="t-heading">{glyph}</span><span className="t-body">{glyph}</span></div>;
  }
  if (base === 'row' && ax === 'inline') {
    return <div><span className={cls}><span className="tile tile--sm tile--brand" /><span className="tile tile--sm tile--brand" /></span>{' '}<span className={cls}><span className="tile tile--sm tile--brand" /><span className="tile tile--sm tile--brand" /></span></div>;
  }
  if (base === 'row' && ax === 'j-between') {
    return <div className={cls}><span className="tile tile--sm tile--brand" /><span className="tile tile--brand" /><span className="tile tile--lg tile--brand" /></div>;
  }
  if (base === 'row' && (ax === 'div' || ax === 'flush')) {
    const rows = ax === 'div' ? ['Уведомления', 'Язык', 'Тема'] : ['Уведомления', 'Язык'];
    return <div className="card">{rows.map((l) => <div key={l} className={cls}><span className="grow t-body">{l}</span><span className="tile tile--sm tile--brand" /></div>)}</div>;
  }
  if (base === 'grid' && ax === '2') {
    return <div className={`${cls} grid--g4`}>{[0, 1, 2, 3].map((i) => <span key={i} className="tile tile--brand" />)}</div>;
  }
  // col-оси (a-end/j-center) и запас: высота — условие демо main-axis.
  return (
    <div className={`${cls} col--g3`} style={{ minHeight: 80 }}>{/* inline-style-exempt: у оси main-axis без высоты центрировать нечего — высота ЕСТЬ условие демо */}
      <span className="tile tile--sm tile--brand" />
      <span className="tile tile--lg tile--brand" />
    </div>
  );
}

/* ─────────────────────── страница одного объекта ─────────────────────────── */
function KitObjectView({ obj, ctx }) {
  const specimens = obj.special ? [] : (RECIPES[obj.id]?.(ctx) ?? []);
  return (
    <Card radius="lg">
      <CardHeader title={TX.titles[obj.id] || obj.id} />
      <div className="col col--g8">
        <div className="col col--g1">
          <div className="row row--g3 row--j-center">
            {obj.family && <span className="t-mono trunc">{`.${obj.family}`}</span>}
            {obj.family && <StatusTag cls={obj.family} />}
          </div>
          {TX.blurbs[obj.id] && <span className="t-meta">{TX.blurbs[obj.id]}</span>}
        </div>
        {obj.special === 'spacing' && <SpacingSection ctx={ctx} />}
        {obj.special === 'typography' && <TypographySection />}
        {obj.special === 'tokens' && <TokensSection ctx={ctx} />}
        {obj.special === 'splash' && <SplashSection />}
        {specimens.map((s, i) => <Specimen key={i} label={s.label} items={s.items} />)}
      </div>
    </Card>
  );
}

/**
 * Образец экрана запуска (TRIP-478).
 *
 * Разметка вставляется КАК ЕСТЬ из `@/design/splash.html` — того самого файла,
 * который сборка подставляет в документ. Собрать её тут заново на JSX значило
 * бы завести вторую правду: витрина показывала бы похожее, а человек при
 * запуске видел бы другое — ровно та поломка, ради которой витрина и заведена.
 * Источник статический, из репозитория, пользовательских данных в нём нет.
 *
 * `key` перезапускает анимацию: CSS-анимации проигрываются на монтировании, и
 * пересоздание узла — единственный способ увидеть их снова, не перезагружая
 * страницу.
 */
function SplashSection() {
  const [run, setRun] = useState(0);
  return (
    <div className="col col--g3">
      <div className="row row--j-center">
        <Btn variant="quiet" size="sm" onClick={() => setRun((n) => n + 1)}>{TX.splashReplay}</Btn>
      </div>
      <div
        data-kit="splash"
        key={run}
        // eslint-disable-next-line react/no-danger -- статический файл ДС, не пользовательский ввод
        dangerouslySetInnerHTML={{ __html: splashMarkup }}
      />
    </div>
  );
}

const SP_SCALE = ['--sp-1', '--sp-2', '--sp-3', '--sp-4', '--sp-5', '--sp-6', '--sp-7', '--sp-8'];
function SpacingSection({ ctx }) {
  return (
    <div className="col col--g3">
      {SP_SCALE.map((name) => (
        <div key={name} className="row row--g4 row--j-center">
          <span className="col col--g1">
            <span className="t-mono trunc">{name}</span>
            <span className="t-micro trunc">{ctx.cs?.getPropertyValue(name).trim()}</span>
          </span>
          {/* ширина линейки ЕСТЬ сам замер — класс её выразить не может */}
          <span className="tile tile--brand" style={{ width: `var(${name})`, minWidth: `var(${name})` }} />{/* inline-style-exempt: ширина линейки ЕСТЬ сам замер токена, класс её выразить не может */}
        </div>
      ))}
    </div>
  );
}

const TYPE_CANONS = ['t-display', 't-title', 't-heading', 't-subheading', 't-label', 't-body', 't-support', 't-meta', 't-micro', 't-tiny', 't-tiny-caps', 't-mono'];
/* Санкционированные орто-модификаторы канона (TRIP-410): комбинируются с любым
   каноном, НЕ каноны сами по себе. Прежний sans-оверлей удалён (мета-ярус — Geologica).
   `base` — канон, на котором эффект модификатора виден нагляднее. */
const TYPE_MODS = [
  { cls: 't-strong', base: 't-body', sample: 'Съешь ещё · Sphinx of black quartz' },
  { cls: 't-flush', base: 't-display', sample: '0123456789' },
  { cls: 'tp-caption', base: 't-mono', sample: 'caption · эйбрау' },
];
function TypographySection() {
  return (
    <div className="col col--g6">
      <span className="t-micro">{TX.canonsLabel}</span>
      {TYPE_CANONS.map((cls) => (
        <div key={cls} className="col col--g2">
          <div className="row row--g3 row--j-center">
            <span className="t-mono trunc">{`.${cls}`}</span>
            <StatusTag cls={cls} />
          </div>
          <span className={cls}>{TX.sample}</span>
        </div>
      ))}
      <span className="t-micro">{TX.modsLabel}</span>
      {TYPE_MODS.map(({ cls, base, sample }) => (
        <div key={cls} className="col col--g2">
          <span className="t-mono trunc">{`.${base}.${cls}`}</span>
          <span className={`${base} ${cls}`}>{sample}</span>
        </div>
      ))}
    </div>
  );
}

function TokensSection({ ctx }) {
  return (
    <div className="col col--g3">
      <span className="t-meta">{`${ctx.tokens.length} имён`}</span>
      <div className="grid grid--2 grid--g4">
        {ctx.tokens.map(({ name, value }) => (
          <div key={name} className="row row--g3 row--j-center">
            {/* образец ПОКАЗЫВАЕТ значение токена — оно и есть содержимое */}
            <span className="tile" style={{ background: /color|#|rgb|hsl/i.test(value) ? `var(${name})` : undefined }} />{/* inline-style-exempt: образец ПОКАЗЫВАЕТ значение токена — оно и есть содержимое */}
            <span className="col col--g1 grow">
              <span className="t-mono trunc">{name}</span>
              <span className="t-micro trunc">{value}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────────── индекс `/kit` ─────────────────────────────── */
function KitIndex() {
  return (
    <div className="col col--g8">
      {KIT_GROUPS.map((group) => {
        const objs = KIT_OBJECTS.filter((o) => o.group === group);
        if (!objs.length) return null;
        return (
          <Card key={group} radius="lg">
            <CardHeader title={TX.groups[group]} />
            <div className="grid grid--2 grid--g4">
              {objs.map((o) => (
                <Link key={o.id} to={`/kit/${o.id}`} className="card row row--g3 row--j-center">
                  <span className="col col--g1 grow">
                    <span className="t-mono trunc">{o.family ? `.${o.family}` : o.id}</span>
                    <span className="t-micro">{TX.blurbs[o.id]}</span>
                  </span>
                  {o.family && <StatusTag cls={o.family} />}
                </Link>
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────── shell ───────────────────────────────────── */
export default function Kit() {
  const { object } = useParams();
  const obj = object ? kitObjectById(object) : null;

  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'light');
  const [tokens, setTokens] = useState([]);
  const [declaredAll, setDeclaredAll] = useState({});
  const [steps, setSteps] = useState({ row: new Set(), col: new Set(), grid: new Set() });

  // Оверлеи и интерактивные состояния (нужны только некоторым объектам).
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dlgSize, setDlgSize] = useState(null);
  const [checked, setChecked] = useState(true);
  const [toggled, setToggled] = useState(true);
  const [segView, setSegView] = useState('month');
  const [segTone, setSegTone] = useState('story');
  const [chipFilter, setChipFilter] = useState('new');
  const [chipPage, setChipPage] = useState(2);
  const swColors = ['var(--ev-hotel)', 'var(--ev-activity)', 'var(--ev-car)'];
  const swCovers = ['linear-gradient(135deg, var(--ev-hotel), var(--brand))', 'linear-gradient(135deg, var(--ev-activity), var(--warm))', 'linear-gradient(135deg, var(--ev-car), var(--ai))'];
  const [swColor, setSwColor] = useState(swColors[0]);
  const [swIcon, setSwIcon] = useState('bed');
  const [swCover, setSwCover] = useState(0);
  // Демо-слайды пикера обложки — картинки из бандла (флаги), чтобы витрина не
  // ходила в сеть; пустая строка первой = слайд «без обложки». Их СПЕЦИАЛЬНО
  // много: у пикера лента миниатюр прокручиваемая, и витрина из трёх плиток
  // показывала бы его в состоянии, которого на экране не бывает — прокрутку и
  // доводку к выбранной миниатюре на ней увидеть было нельзя.
  const cpSlides = ['', '/flags/es.svg', '/flags/fr.svg', '/flags/it.svg', '/flags/pt.svg',
    '/flags/gr.svg', '/flags/de.svg', '/flags/nl.svg', '/flags/at.svg', '/flags/ch.svg',
    '/flags/cz.svg', '/flags/hu.svg'];
  const [cpValue, setCpValue] = useState('');

  // Значения токенов/семей зависят от темы — перечитываем при переключении.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    setTokens(readRootTokens());
    const { byFamily, steps: st } = readDeclared();
    setDeclaredAll(byFamily);
    setSteps(st);
  }, [theme]);

  const cs = useMemo(() => (tokens.length ? getComputedStyle(document.documentElement) : null), [tokens]);

  const ctx = {
    declared: obj?.family ? (declaredAll[obj.family] ?? []) : [], steps, tokens, cs,
    dialogOpen, setDialogOpen, sheetOpen, setSheetOpen, dlgSize, setDlgSize,
    checked, setChecked, toggled, setToggled, segView, setSegView, segTone, setSegTone,
    chipFilter, setChipFilter, chipPage, setChipPage,
    swColors, swCovers, swColor, setSwColor, swIcon, setSwIcon, swCover, setSwCover,
    cpSlides, cpValue, setCpValue,
  };

  return (
    <div className="col col--g8" style={{ padding: 'var(--sp-8)', maxWidth: 1120, margin: '0 auto' }}>
      {/* inline-style-exempt: примитива «страница» в системе нет — единственный
          контейнер на 1120 это .acct-shell, экранный грид семейства acct. */}
      <div className="col col--g3">
        <div className="row row--g3 row--j-center row--wrap">
          {obj && <Link to="/kit" className="btn btn--quiet">{TX.back}</Link>}
          <h1 className="t-display grow">{obj ? (TX.titles[obj.id] || obj.id) : TX.title}</h1>
          <span className="t-meta">{TX.theme}</span>
          <Btn variant={theme === 'light' ? 'primary' : 'quiet'} onClick={() => setTheme('light')}>{TX.themeLight}</Btn>
          <Btn variant={theme === 'dark' ? 'primary' : 'quiet'} onClick={() => setTheme('dark')}>{TX.themeDark}</Btn>
        </div>
        {!obj && <p className="t-body">{TX.lead}</p>}
      </div>

      {obj ? <KitObjectView obj={obj} ctx={ctx} /> : <KitIndex />}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen} title={TX.dialogTitle} icon="info"
        foot={<Btn variant="primary" onClick={() => setDialogOpen(false)}>{TX.close}</Btn>}>
        <p className="t-body">{TX.dialogBody}</p>
      </Dialog>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen} title={TX.sheetTitle} titleText={TX.sheetTitle}>
        <p className="t-body">{TX.dialogBody}</p>
      </Sheet>
      <Dialog open={dlgSize !== null} onOpenChange={(o) => { if (!o) setDlgSize(null); }}
        size={dlgSize || undefined} title={TX.dialogTitle} icon="info"
        foot={<Btn variant="primary" onClick={() => setDlgSize(null)}>{TX.close}</Btn>}>
        <p className="t-body">{TX.dialogBody}</p>
      </Dialog>
    </div>
  );
}
