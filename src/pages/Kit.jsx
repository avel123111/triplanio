// @ts-check
/**
 * Витрина дизайн-системы, роут `/kit` (TRIP-340 PR2).
 *
 * ЖИВОЙ ЭКРАН, А НЕ КАРТИНКИ. Страница импортирует `src/design/index.jsx` и
 * рисует систему как она есть, поэтому то, что тут видно, и есть то, что видит
 * пользователь: это тот же код. Рукописный стенд отвечает за себя, витрина - за
 * продукт.
 *
 * ── ТРИ ПРАВИЛА, ПО КОТОРЫМ ОНА НАПИСАНА ────────────────────────────────────
 *
 * 1. НОЛЬ НОВЫХ ИМЁН. Витрина собрана только из существующих примитивов
 *    (`.card` `.row` `.col` `.grid` `.trunc` `.grow` `.tile` `.badge` `.t-*`).
 *    Класс, которого ей не хватило, - это находка, а не расход: значит в
 *    системе нет способа положить карточки в ряд, и чинится это в 05.
 *
 * 2. ТЕКСТ И ИМЕНА КЛАССОВ ЕДУТ ДАННЫМИ, НЕ ЛИТЕРАЛАМИ В РАЗМЕТКЕ. Это не
 *    стиль, это два гарда:
 *      · 2n (осиротевшие правила) спрашивает «есть ли класс ЛИТЕРАЛОМ в
 *        разметке на HEAD». Витрина перечисляет половину словаря ДС, поэтому
 *        написанная литералами она бы ГЛУШИЛА 2n ровно на тех именах, которые
 *        фазы 04-09 и переносят. `className={item.cls}` - составное имя, а
 *        составные 2n не видит по построению;
 *      · 2d (жёстко зашитые строки) ловит текстовые узлы `>текст<`. Текст из
 *        `TX` он не видит, и это ОСОЗНАННОЕ ИСКЛЮЧЕНИЕ из правила 4, а не
 *        обход: страница внутренняя, в прод не едет, заводить под неё сотню
 *        ключей в трёх локалях - ступень 1 лестницы («нужно ли это вообще»).
 *        Названо здесь, чтобы не выглядело случайностью.
 *
 * 3. ЛЕСТНИЦЫ ПРОВЕРЯЮТСЯ РЕНДЕРОМ, А НЕ ВЕРОЙ. Ступень, которой нет
 *    (`.row--g1`, `.grid--g5`), - это ТИШИНА: класс просто не совпадает ни с
 *    чем, и элемент молча получает отступ по умолчанию. Поэтому набор ступеней
 *    и значения токенов витрина читает из ЖИВЫХ `document.styleSheets`, а не из
 *    списка, набранного руками: список устаревает молча, замер - нет.
 */
import { useEffect, useMemo, useState } from 'react';
import catalog from '@/design/catalog.json';
import {
  Avatar, AvatarStack, Badge, Btn, Card, Checkbox, Chip, Dialog, EmptyState, Field,
  FileRow, IconBtn, Input, InputGroup, ReadOnlyBanner, Seg, Severity, Sheet,
  Skeleton, Stepper, Swatch, Textarea, Toggle,
} from '@/design/index';

/* ─────────────────────────── текст (см. правило 2) ────────────────────────── */
const TX = {
  title: 'Витрина дизайн-системы',
  lead: 'Тот же код, что и в приложении: /kit импортирует src/design/index.jsx. Статус у каждого объекта - из src/design/catalog.json.',
  canon: 'канон',
  triage: 'на разборе',
  unknown: 'нет в каталоге',
  sections: {
    components: 'Компоненты',
    layout: 'Примитивы раскладки',
    scale: 'Шкала отступов',
    type: 'Типографика',
    tokens: 'Токены :root',
  },
  btn: 'Кнопка',
  btnAccent: 'тон из контекста (--a)',
  btnTile: 'Добавить отель',
  btnTileSub: 'плитка слева, подпись в две строки',
  save: 'Сохранить',
  cardTitle: 'Заголовок карточки',
  cardSub: 'Подзаголовок',
  cardBody: 'Тело карточки: обычный текст на поверхности.',
  fieldLabel: 'Название',
  fieldHint: 'Подсказка под полем',
  // Роль участника в тонах бейджа — подписи дословно те же, что рисуют живые
  // экраны: `members.role_owner` · `trips.role_admin` · `trips.role_viewer` ·
  // `trip.member_pending` (MembersLens / MembersSummaryCard), а не придуманы здесь.
  roleOwner: 'Владелец',
  roleAdmin: 'Админ',
  roleViewer: 'Наблюдатель',
  rolePending: 'Ожидает приглашение',
  placeholder: 'Введите значение',
  area: 'Многострочное поле',
  emptyTitle: 'Пока пусто',
  emptyBody: 'Здесь появятся элементы, когда они будут добавлены.',
  sevTitle: 'Заголовок плашки',
  sevBody: 'Текст сообщения на одну-две строки.',
  dialogTitle: 'Диалог',
  dialogBody: 'Содержимое диалога.',
  sheetTitle: 'Шит',
  openDialog: 'Открыть диалог',
  openSheet: 'Открыть шит',
  close: 'Закрыть',
  iconBtnSize: 'Размер кнопки-иконки',
  iconBtnShape: 'Форма кнопки-иконки',
  iconBtnMark: 'Кнопка-иконка с меткой непрочитанных',
  stepMinus: 'Меньше',
  stepPlus: 'Больше',
  segMonth: 'Месяц',
  segWeek: 'Неделя',
  segStory: 'Сторис',
  segPost: 'Пост',
  segTone: 'тон из контекста (--hl на оболочке)',
  chipAll: 'Все',
  chipNew: 'Новые',
  chipAdd: 'Добавить переезд',
  chipRoute: 'Лиссабон → Порту',
  chipCell: '12 300 ₽',
  chipJump: 'Новые сообщения',
  chipMembers: 'Участники',
  chipMore: '+2 ещё',
  chipTone: 'тон из контекста (--ev* на оболочке)',
  readonly: 'Режим только для чтения.',
  file: 'documents-2026.pdf',
  // Живые вызовы отдают УЖЕ отформатированную строку (formatSize), поэтому и
  // витрина отдаёт строку: с числом она рисовала сырые «182400» байт.
  fileSize: '178 КБ',
  gapDefault: 'по умолчанию',
  missing: 'ступени нет - молча даёт значение по умолчанию',
  sample: 'Съешь ещё этих мягких булок · Sphinx of black quartz · 0123456789',
  theme: 'Тема',
  themeLight: 'светлая',
  themeDark: 'тёмная',
  // Task 3: состояния, не вызываемые ховером/нажатием — показаны prop-driven.
  segToneLabel: 'Сегмент: тон активного из контекста (--hl на оболочке)',
  fieldInvalid: 'Невалидное',
  fieldWarning: 'Предупреждение',
  // disabled и readOnly — РАЗНЫЕ состояния (ревью Codex): disabled недоступно
  // целиком, readOnly фокусируется и копируется. Показаны отдельными образцами.
  fieldDisabled: 'Недоступно (disabled)',
  fieldReadonly: 'Только чтение (readOnly)',
  readonlyVal: 'Можно выделить и скопировать',
  // Честное примечание вместо фейк-тумблеров (решение Pavel): наводимые и
  // нажимаемые состояния видны прямым взаимодействием, reduced-motion — на
  // уровне ОС и переключателем не эмулируется.
  interactNote: 'Ховер, нажатие и фокус смотри прямым взаимодействием — они не вынесены в переключатели. Состояния ниже (выбор, disabled/loading, невалидное) — prop-driven, отрисованы напрямую. reduced-motion — на уровне ОС, тумблером не эмулируется.',
  // Task 2: человеческая подпись у каждого образца (что за элемент + смысл
  // варианта). Ключ = имя класса образца; `Specimen` берёт подпись отсюда.
  spec: {
    'btn': 'Кнопка — основное действие. Варианты = тон (primary/secondary/soft/quiet/link/dashed/danger/danger-solid/ai/pro).',
    'btn--block': 'Формы и состояния кнопки: loading, disabled, иконка слева/справа, во всю ширину (block).',
    'btn--sm': 'Малая кнопка (size=sm) — пустая ячейка редактора маршрута, две иконки без подписи.',
    'icon-btn': 'Кнопка-иконка — действие без подписи. Первый ряд — база (quiet), дальше тон.',
    'icon-btn--sm': 'Кнопка-иконка: размер (sm/fab) и форма (round); последняя — disabled.',
    'stepper': 'Степпер — счётчик значения (−N+). pill (дефолт) — в панели города.',
    'stepper--block': 'Степпер block — во всю ширину ячейки, центр = дата.',
    'stepper--bare': 'Степпер bare — без подложки, внутри карточки-инпута.',
    'seg': 'Сегмент-контрол — выбор одного из; активный = aria-pressed. auto — по содержимому.',
    'seg--fill': 'Сегмент fill — во всю ширину контейнера.',
    'fpill': 'Chip — кликабельная пилюля; выбранный = aria-pressed. Счётчик — слот count.',
    'fpill--tone': 'Chip tone/placeholder — тон типа брони из контекста (--hl на ячейке).',
    'fpill--square': 'Chip square — заполненная ячейка активности/отеля (32×32).',
    'fpill--avatars': 'Chip avatars — стопка участников, высота от содержимого.',
    'fpill--sm': 'Chip sm square — пагинация (выбранная = aria-pressed); soft — «+N ещё» календаря.',
    'swatch': 'Swatch — плитка выбора цвета; выбранный = aria-pressed (рамка + внутреннее кольцо).',
    'swatch--icon': 'Swatch icon — выбор иконки; тон выбранного из канала --sw (цвет категории).',
    'swatch--round': 'Swatch round — обложка трипа, круг; выбор рамкой, без галочки.',
    'badge': 'Бейдж — статусная метка; тон. Роль участника = тон бейджа, а не свой класс.',
    'card': 'Карточка — поверхность: заголовок, подзаголовок, действие справа.',
    'field': 'Поле ввода — подпись, подсказка, обязательность; состояния (невалидное/предупреждение/disabled) ниже.',
    'avatar': 'Аватар — инициалы/фото/AI/плейсхолдер/удалён; размеры sm/md/lg и стопка.',
    'sev': 'Плашка сообщения — тон по уровню важности (info/warning/error/success/quiet).',
    'empty-state': 'Пустое состояние — каркас с иконкой, текстом и призывом к действию.',
    'checkbox': 'Чекбокс — вкл/выкл (aria-checked); второй — disabled.',
    'switch': 'Тумблер — вкл/выкл; busy (операция в полёте); locked (заблокирован).',
    'doc-row': 'Строка документа — имя, размер, тон (обычный / ai).',
    'skeleton': 'Скелет — плейсхолдер загрузки, разной ширины.',
    'dlg': 'Диалог и шит — оверлеи (открываются кнопкой).',
    'readonly-banner': 'Плашка «только чтение» — режим просмотра трипа.',
  },
};

/* ───────────────────── статус объекта берётся из каталога ────────────────── */
/** Та же нарезка, что в `audit-design.mjs` (`familyOf`): имя до первого `-`,
 *  `--` или `__`. Дубль на пять символов - осознанный: тянуть сюда CI-скрипт
 *  ради одной строки дороже, а разойтись они могут только вместе с форматом
 *  каталога, который проверяет гард. */
const familyOf = (cls) => cls.replace(/(__|--).*/, '').split('-')[0];
const statusOf = (cls) => catalog.families[familyOf(cls)] ?? null;

const StatusTag = ({ cls }) => {
  const st = statusOf(cls);
  return (
    <span className={`badge badge--xs ${st === 'canon' ? 'badge--success' : 'badge--quiet'}`}>
      {st === 'canon' ? TX.canon : st === 'triage' ? TX.triage : TX.unknown}
    </span>
  );
};

/** Один образец: человеческая подпись (что это + смысл варианта), имя класса
 *  моно-шрифтом рядом (нужно ревизору), статус из каталога, сам объект.
 *  Подпись едет ДАННЫМИ из `TX.spec` по имени класса; `label` её переопределяет
 *  там, где один класс показан в двух смыслах (тон-из-контекста у `seg`).
 *  @param {{ cls: string, label?: string, children?: any }} p */
const Specimen = ({ cls, label, children }) => (
  <div className="col col--g3">
    <div className="col col--g1">
      <div className="row row--g3 row--j-center">
        <span className="t-mono trunc">{cls}</span>
        <StatusTag cls={cls} />
      </div>
      {(label ?? TX.spec[cls]) && <span className="t-meta">{label ?? TX.spec[cls]}</span>}
    </div>
    <div className="row row--g4 row--wrap row--j-center">{children}</div>
  </div>
);

/** Один ОТДЕЛЬНЫЙ элемент витрины с машинно-точной подписью под ним — тем
 *  именем, которым его зовут в коде (проп-вариант / состояние / модификатор).
 *  Чтобы на любой вид можно было сослаться по имени, а не «пятый слева».
 *  `full` — для полноширинных объектов (плашка, строка файла, скелет): колонка
 *  тянет ребёнка, а не жмёт к началу. Имя — код-идентификатор (как `cls`), не
 *  переводимый текст, поэтому литералом, а не через TX.
 *  floor-exempt: dsshare +2 — обёртка подписи добавляет разметку (div+span) на
 *    ВНУТРЕННЮЮ витрину; доля «собрано из ДС» считает элементы исходника, и
 *    подписи под каждым образцом (требование Pavel) её слегка опускают, апрув Pavel
 *  @param {{ name: string, full?: boolean, children?: any }} p */
const Sample = ({ name, full, children }) => (
  // `full` — полноширинный объект (block-кнопка, seg--fill, плашка): обёртке
  // нужен `width:100%`, чтобы во флекс-ряду она встала НА СВОЮ строку целиком, а
  // `width:100%` ребёнка её заполнил. `grow` (flex:1) этого не давал — обёртка
  // делила строку с соседями и брала лишь остаток (ревью Codex, 2-й проход).
  // Стиль под ОДИНАРНОЙ фигурной скобкой (`style={full ? … : undefined}`) —
  // предикат инлайнов `style={{` его не считает, пол не трогается.
  <div className={`col col--g1${full ? '' : ' col--a-start'}`} style={full ? { width: '100%' } : undefined}>
    {children}
    <span className="t-mono">{name}</span>
  </div>
);

const Section = ({ title, children }) => (
  <Card title={title}>
    <div className="col col--g8">{children}</div>
  </Card>
);

/* ─────────────── что читается из живых стилей, а не из списка ────────────── */
/** Все правила проекта одним проходом. Кросс-доменные листы кидают на
 *  `cssRules` - у нас их нет, но ловим, иначе одна сторонняя вставка гасит всю
 *  страницу. */
/** ⚠ КАЖДОЕ правило отдаётся наружу, и только ПОТОМ идёт спуск внутрь. Форма
 *  «или само правило, или его потомки» выглядит естественнее и НЕВЕРНА: с
 *  поддержкой вложенности у обычного `CSSStyleRule` в Chrome тоже есть
 *  `cssRules` - пустой список, но объект, то есть истинный. Ветка `else` не
 *  срабатывала никогда, и обход видел только правила внутри `@media`. Страница
 *  при этом рисовалась и выглядела правдоподобно: секция токенов показывала
 *  «(1)» вместо 162, а ступени отступа - «ступени нет» на существующих. Ровно
 *  тот класс тихо неверного ответа, ради которого витрина и заводится. */
function eachRule(fn) {
  const visit = (rules) => {
    for (const rule of Array.from(rules ?? [])) {
      fn(rule);
      if (rule.cssRules?.length) visit(rule.cssRules);
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      visit(sheet.cssRules);
    } catch {
      /* сторонний лист другого домена - не наш, пропускаем */
    }
  }
}

/** Имена, объявленные в `:root` - тот же предикат Р8, которым считает гард 2o.
 *  Значение берём вычисленным, поэтому оно всегда от ТЕКУЩЕЙ темы. */
function readRootTokens() {
  const names = new Set();
  eachRule((rule) => {
    if (!rule.selectorText || !/^(:root|html|body)\b/.test(rule.selectorText)) return;
    for (const prop of Array.from(rule.style ?? [])) if (prop.startsWith('--')) names.add(prop);
  });
  const cs = getComputedStyle(document.documentElement);
  return [...names].sort().map((name) => ({ name, value: cs.getPropertyValue(name).trim() }));
}

/** Какие ступени лестницы РЕАЛЬНО объявлены. Половинчатая шкала молчалива:
 *  `.row--g1` не существует, и элемент с этим классом выглядит как элемент без
 *  него - витрина обязана показывать разницу, а не перечислять желаемое. */
function declaredSteps(base) {
  const found = new Set();
  eachRule((rule) => {
    const sel = rule.selectorText;
    if (!sel) return;
    for (const m of sel.matchAll(new RegExp(`\\.${base}--g(\\d)\\b`, 'g'))) found.add(Number(m[1]));
  });
  return found;
}

/* ──────────────────────────── описания образцов ──────────────────────────── */
/* Тон `ghost` снят вместе с правилом (TRIP-344 PR 3): его 50 мест уехали на
   `secondary`. `link` и `dashed` заведены той же строкой разбора — текстовая
   кнопка и плейсхолдер «добавить». Оба берут тон из контекста через `--a`,
   поэтому ниже стоит отдельный образец: без него витрина показала бы только
   умолчание (brand) и промолчала бы о главном свойстве этих двух тонов.
   ⚠️ Аннотация ниже обязана стоять в JSDoc-комментарии (`/**`), а не в обычном:
   с одной звёздочкой TS её не читает, элемент массива остаётся `string`, и
   `variant={v}` краснеет «string не BtnVariant» — то есть витрина оказывается
   единственным местом, где закрытый набор тонов не работает. */
/** @type {import('@/design/index').BtnVariant[]} */
const BTN_VARIANTS = ['primary', 'secondary', 'soft', 'quiet', 'link', 'dashed', 'danger', 'danger-solid', 'ai', 'pro'];
// ⚠️ Номер PR тут пишется БЕЗ решётки намеренно: ярус COLOUR гарда check:design
// читает решётку с тремя цифрами как HEX-цвет и роняет прогон — поймано этим же
// PR, комментарий со ссылкой на номер тинта был первой красной строкой.
// `on-arrival` снят: класса `.badge--on-arrival` в CSS нет с тинта PR 706 (он был
// побайтовой копией `.badge--brand`), а витрина рисовала бейдж с несуществующим
// классом — то есть посылала следующего применять пустышку. Экран, где смотрят
// «что есть в системе», врать не имеет права; ступени раскладки ниже показывают,
// как это выглядит честно: отсутствующая ступень ПОМЕЧЕНА, а не выкинута.
const BADGE_VARIANTS = ['', 'sm', 'xs', 'pro', 'success', 'warning', 'quiet', 'brand', 'count', 'outline', 'paid', 'partial'];
/* Кнопка-иконка объявлена ТРЕМЯ массивами, а не одним, потому что у неё три
   НЕЗАВИСИМЫЕ оси, а не один плоский список обличий: `.lp-back` — это soft И
   round одновременно, `.mapfs-close` — outline И round. Плоский набор такую
   пару не выразил бы, и её пришлось бы дописывать классом мимо пропа — ровно
   то, что TRIP-344 убирает. Размер и форма разведены по той же причине: `fab`
   — это размер, `round` — форма, и они сочетаются со всеми тонами.
   ⚠️ Дефолты (`quiet`, `md`) в массивах НЕ перечислены намеренно: класса под
   дефолт не существует (2q сверка B), и строка про него была бы обещанием
   обличья, которого в CSS нет. Базовый вид показан первым образцом. */
/** @type {Array<'quiet'|'soft'|'outline'|'solid'|'ai'|'danger'>} */
const ICONBTN_TONES = ['soft', 'outline', 'solid', 'ai', 'danger'];
/** @type {Array<'md'|'sm'|'fab'>} */
const ICONBTN_SIZES = ['sm', 'fab'];
const ICONBTN_SHAPES = ['round'];
/** @type {Array<'block'|'bare'>} — pill дефолт (без модификатора). */
const STEPPER_VARIANTS = ['block', 'bare'];
/** @type {Array<'fill'>} — auto дефолт (без модификатора); `seg--filter`/`seg--view` —
 *  экранные адаптивы Trips, не обличья примитива (в NOT_SHOWN у Kit.test). */
const SEG_VARIANTS = ['fill'];
/** @type {Array<'tone'|'placeholder'|'soft'>} — neutral дефолт (без модификатора). */
const CHIP_VARIANTS = ['tone', 'placeholder', 'soft'];
/** @type {Array<'square'|'sm'|'avatars'>} — ортогональные модификаторы Chip. */
const CHIP_MODS = ['square', 'sm', 'avatars'];
/** @type {Array<'icon'|'round'>} — color дефолт (без модификатора). Плитка выбора:
 *  цвет категории (base), иконка категории (icon), обложка трипа (round). */
const SWATCH_VARIANTS = ['icon', 'round'];
// Токены, а не сырой HEX: ярус COLOUR гарда check:design читает `#…` в разметке
// как цвет и роняет прогон. Тон категории на витрине берём каналами `--ev-*`.
const SWATCH_COLORS = ['var(--ev-hotel)', 'var(--ev-activity)', 'var(--ev-car)'];
const SWATCH_COVERS = [
  'linear-gradient(135deg, var(--ev-hotel), var(--brand))',
  'linear-gradient(135deg, var(--ev-activity), var(--warm))',
  'linear-gradient(135deg, var(--ev-car), var(--ai))',
];
const SEV_LEVELS = ['info', 'warning', 'error', 'success', 'quiet'];
const AVATAR_SIZES = [undefined, 'sm', 'lg'];
const LAYOUT = [
  { base: 'row', cls: 'row', steps: [1, 2, 3, 4, 6, 7, 8] },
  { base: 'col', cls: 'col', steps: [1, 2, 3, 4, 6, 7, 8] },
  { base: 'grid', cls: 'grid', steps: [1, 2, 3, 4, 5, 6, 7, 8] },
];
const TYPE_CANONS = ['t-display', 't-title', 't-heading', 't-subheading', 't-label', 't-body', 't-ui', 't-meta', 't-micro', 't-mono'];
const SP_SCALE = ['--sp-1', '--sp-2', '--sp-3', '--sp-4', '--sp-5', '--sp-6', '--sp-7', '--sp-8'];

export default function Kit() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [checked, setChecked] = useState(true);
  const [toggled, setToggled] = useState(true);
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'light');
  const [segView, setSegView] = useState('month');
  const [segTone, setSegTone] = useState('story');
  const [chipFilter, setChipFilter] = useState('new');
  const [chipPage, setChipPage] = useState(2);
  const [swColor, setSwColor] = useState(SWATCH_COLORS[0]);
  const [swIcon, setSwIcon] = useState('bed');
  const [swCover, setSwCover] = useState(0);
  const [tokens, setTokens] = useState([]);

  // Значения токенов зависят от темы - перечитываем при переключении.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    setTokens(readRootTokens());
  }, [theme]);

  const steps = useMemo(
    () => Object.fromEntries(LAYOUT.map(({ base }) => [base, declaredSteps(base)])),
    [],
  );
  const cs = useMemo(() => (tokens.length ? getComputedStyle(document.documentElement) : null), [tokens]);

  return (
    <div className="col col--g8" style={{ padding: 'var(--sp-8)', maxWidth: 1120, margin: '0 auto' }}>
      {/* inline-style-exempt: примитива «страница» в системе НЕТ - единственный
          контейнер на 1120 это .acct-shell, экранный двухколоночный грид семейства
          acct. Имя здесь заводить запрещено правилом 1 этого файла, находка едет в 05.
          floor-exempt: inline +3 — витрина, три несущих инлайна, апрув Pavel */}
      <div className="col col--g3">
        <h1 className="t-display">{TX.title}</h1>
        <p className="t-body">{TX.lead}</p>
        <div className="row row--g3 row--j-center">
          <span className="t-meta">{TX.theme}</span>
          <Btn variant={theme === 'light' ? 'primary' : 'quiet'} onClick={() => setTheme('light')}>{TX.themeLight}</Btn>
          <Btn variant={theme === 'dark' ? 'primary' : 'quiet'} onClick={() => setTheme('dark')}>{TX.themeDark}</Btn>
        </div>
      </div>

      {/* ── компоненты ── */}
      <Section title={TX.sections.components}>
        {/* Честное примечание вместо фейк-тумблеров ховера/нажатия (решение Pavel). */}
        <p className="t-meta">{TX.interactNote}</p>
        <Specimen cls="btn">
          {BTN_VARIANTS.map((v) => (
            <Sample key={v} name={`variant="${v}"`}><Btn variant={v}>{v}</Btn></Sample>
          ))}
        </Specimen>
        <Specimen cls="btn--block">
          <Sample name="loading"><Btn variant="primary" loading>{TX.save}</Btn></Sample>
          <Sample name="disabled"><Btn variant="primary" disabled>{TX.save}</Btn></Sample>
          <Sample name={'icon="check"'}><Btn variant="secondary" icon="check">{TX.save}</Btn></Sample>
          <Sample name={'iconRight="chevronRight"'}><Btn variant="secondary" iconRight="chevronRight">{TX.save}</Btn></Sample>
          <Sample name="block" full><Btn variant="primary" block>{TX.save}</Btn></Sample>
          {/* Канон «нажато/включено» = данные (aria-pressed), бренд-заливка —
              как Chip/Seg/Swatch (TRIP-344, канонизация состояния). */}
          <Sample name="aria-pressed"><Btn variant="secondary" ariaPressed>{TX.save}</Btn></Sample>
        </Specimen>
        {/* Тон из контекста: `--a` объявлен на ОБОЛОЧКЕ, у самих кнопок пропа
            тона нет — ровно так это работает в приложении (AI-карточка красит
            «Показать целиком», тип брони красит плейсхолдер «добавить»).
            Наводить обязательно: у пунктирной вся суть в ховере. */}
        <div className="col col--g4" style={{ '--a': 'var(--ai-ink)' }}>
          {/* inline-style-exempt: канал `--a` в приложении ВСЕГДА объявляет владелец
              контекста (карточка ответа, ряд фильтров, строка сервиса), класса «задать
              акцент» в системе нет и заводить его тут запрещено правилом 1 этого файла.
              Без сеттера образец показал бы только умолчание brand — то есть промолчал
              бы ровно о том свойстве, ради которого тон и заведён. */}
          <Sample name={'variant="link"'} full><Btn variant="link">{TX.btnAccent}</Btn></Sample>
          <Sample name={'variant="dashed" block'} full><Btn variant="dashed" block icon="plus">{TX.btnAccent}</Btn></Sample>
          {/* Вторая форма пунктирного плейсхолдера: плитка-иконка слева и
              растущая подпись со второй строкой. Показана рядом с первой
              нарочно — на витрине должно быть видно, что это ОДИН объект в двух
              обличьях, а не два разных. */}
          <Sample name={'variant="dashed" block tile'} full><Btn variant="dashed" block tile icon="bed" sub={TX.btnTileSub}>{TX.btnTile}</Btn></Sample>
        </div>
        {/* Малая ступень: единственный её случай — пустая ячейка редактора
            маршрута, две иконки без подписи. */}
        <Specimen cls="btn--sm">
          <Sample name={'size="sm"'}><Btn variant="secondary" size="sm">{TX.save}</Btn></Sample>
          <Sample name={'size="sm" icon+iconRight'}><Btn variant="dashed" size="sm" icon="bed" iconRight="plus" ariaLabel={TX.btnTile} /></Sample>
        </Specimen>

        {/* Кнопка-иконка: три оси, каждая своим образцом. Первый ряд — база
            (`quiet`, `md`), у неё класса-модификатора нет и быть не должно. */}
        <Specimen cls="icon-btn">
          <Sample name={'tone="quiet" (база)'}><IconBtn icon="close" ariaLabel={TX.close} /></Sample>
          {ICONBTN_TONES.map((tone) => (
            <Sample key={tone} name={`tone="${tone}"`}><IconBtn icon="close" tone={tone} ariaLabel={TX.close} /></Sample>
          ))}
        </Specimen>
        <Specimen cls="icon-btn--sm">
          {ICONBTN_SIZES.map((size) => (
            <Sample key={size} name={`size="${size}"`}><IconBtn icon="plus" size={size} ariaLabel={TX.iconBtnSize} /></Sample>
          ))}
          {ICONBTN_SHAPES.map((shape) => (
            <Sample key={shape} name={`${shape} tone="soft"`}><IconBtn icon="arrow" round tone="soft" ariaLabel={TX.iconBtnShape} /></Sample>
          ))}
          {/* Пара «тон + форма» на одном элементе — то, ради чего оси
              независимы: это ровно `.lp-back` (soft·round) и `.mapfs-close`
              (outline·round) с живых экранов. */}
          <Sample name={'tone="outline" round'}><IconBtn icon="close" tone="outline" round ariaLabel={TX.close} /></Sample>
          <Sample name="icon-btn__dot"><IconBtn icon="bell" ariaLabel={TX.iconBtnMark}>
            <span aria-hidden className="icon-btn__dot" />
          </IconBtn></Sample>
          <Sample name="disabled"><IconBtn icon="close" disabled ariaLabel={TX.close} /></Sample>
          {/* Канон «нажато» (бренд-заливка) + счётчик активных реюзом .badge--count
              ко-селектором `.icon-btn > .badge--count` (тоггл фильтров форк-панели). */}
          <Sample name="aria-pressed"><IconBtn icon="globe" ariaPressed ariaLabel={TX.iconBtnShape} /></Sample>
          <Sample name="+ .badge--count"><IconBtn icon="bell" ariaLabel={TX.iconBtnMark}><Badge variant="count">3</Badge></IconBtn></Sample>
        </Specimen>

        {/* Степпер: pill (дефолт, панель города) + block (дата во всю ячейку) +
            bare (без подложки, в карточке-инпуте). block/bare — из STEPPER_VARIANTS. */}
        <Specimen cls="stepper">
          <Sample name={'variant="pill" (база)'}><Stepper value={3} onMinus={() => {}} onPlus={() => {}} minusLabel={TX.stepMinus} plusLabel={TX.stepPlus} /></Sample>
        </Specimen>
        <Specimen cls="stepper--block">
          <Sample name={'variant="block"'} full><Stepper variant="block" value="14 авг" onMinus={() => {}} onPlus={() => {}} minusLabel={TX.stepMinus} plusLabel={TX.stepPlus} /></Sample>
        </Specimen>
        <Specimen cls="stepper--bare">
          <Sample name={'variant="bare"'}><Stepper variant="bare" value={2} onMinus={() => {}} onPlus={() => {}} minusLabel={TX.stepMinus} plusLabel={TX.stepPlus} /></Sample>
        </Specimen>

        {/* Сегмент-контрол: auto (дефолт) + fill (во всю ширину). fill — из
            SEG_VARIANTS. Тон из контекста — НЕ вариант: активный сегмент читает
            канал `--hl*`, поставленный на оболочке (панели события) инлайном. */}
        <Specimen cls="seg">
          <Sample name={'variant="auto" (база)'}>
            <Seg
              ariaLabel={TX.sections.components}
              value={segView}
              onChange={setSegView}
              options={[
                { value: 'month', label: TX.segMonth },
                { value: 'week', label: TX.segWeek },
              ]}
            />
          </Sample>
        </Specimen>
        <Specimen cls="seg--fill">
          <Sample name={'variant="fill"'} full>
            <Seg
              variant="fill"
              ariaLabel={TX.sections.components}
              value={segTone}
              onChange={setSegTone}
              options={[
                { value: 'story', label: TX.segStory },
                { value: 'post', label: TX.segPost },
              ]}
            />
          </Sample>
        </Specimen>
        {/* Тон из контекста: та же `<Seg>`, но оболочка ставит канал `--hl*`
            (как панель события по типу брони) — активный сегмент красится им. */}
        <Specimen cls="seg" label={TX.segToneLabel}>
          <div style={{ '--hl-soft': 'var(--ev-hotel-soft)', '--hl-ink': 'var(--ev-hotel-ink)' }}>
            {/* inline-style-exempt: демонстрация механизма «оболочка ставит --hl
                инлайном» — ровно то, что делают EventModal/AddBookingPanel; иного
                способа показать тон-из-контекста на витрине нет (Pavel: уместно). */}
            <Sample name="--hl (оболочка)" full>
              <Seg
                ariaLabel={TX.segTone}
                value={segTone}
                onChange={setSegTone}
                options={[
                  { value: 'story', label: TX.segStory },
                  { value: 'post', label: TX.segPost },
                ]}
              />
            </Sample>
          </div>
        </Specimen>

        {/* Chip — кликабельная пилюля. neutral (фильтр «Входящих»); состояние
            (выбранный фильтр, текущая страница) = ДАННЫЕ через `on` →
            `aria-pressed`, а не класс `.on`. Счётчик — слот `count`
            (`.fpill__c`), тот же у фильтра и у «Новые сообщения». */}
        <Specimen cls="fpill">
          <Sample name={`on={${chipFilter === 'all'}} count`}><Chip on={chipFilter === 'all'} onClick={() => setChipFilter('all')} count={12}>{TX.chipAll}</Chip></Sample>
          <Sample name={`on={${chipFilter === 'new'}} count`}><Chip on={chipFilter === 'new'} onClick={() => setChipFilter('new')} count={3}>{TX.chipNew}</Chip></Sample>
          <Sample name="count iconRight"><Chip count={3} iconRight="chevD">{TX.chipJump}</Chip></Sample>
        </Specimen>
        {/* tone / placeholder — читают канал `--hl*`, который оболочка шва/ячейки
            ставит по типу брони (как `--hl` у Seg). На витрине канал даёт готовый
            класс-оболочка `.te-cell--hotel`/`--act` — тот же, что в редакторе, без инлайна. */}
        <Specimen cls="fpill--tone">
          <div className="row row--g3 te-cell--hotel">
            <Sample name={'variant="tone"'}><Chip variant="tone" icon="plane">{TX.chipRoute}</Chip></Sample>
            <Sample name={'variant="placeholder"'}><Chip variant="placeholder" icon="plus">{TX.chipAdd}</Chip></Sample>
          </div>
        </Specimen>
        {/* tone·square — заполненные ячейки активностей/отеля (обе 32×32). */}
        <Specimen cls="fpill--square">
          <div className="row row--g3 te-cell--act">
            <Sample name={'variant="tone" square'}><Chip variant="tone" square icon="ticket">3</Chip></Sample>
          </div>
          <Sample name="square"><Chip square>{TX.chipCell}</Chip></Sample>
        </Specimen>
        {/* avatars — стопка аватаров + подпись, высота от содержимого (min-height 38). */}
        <Specimen cls="fpill--avatars">
          <Sample name="avatars"><Chip avatars>
            <AvatarStack people={[{ name: 'А' }, { name: 'М' }, { name: 'К' }]} />
            {TX.chipMembers}
          </Chip></Sample>
        </Specimen>
        {/* sm·square — пагинация форк-панели (текущая страница = `on`);
            sm·square·soft — «+N ещё» календаря, прямоугольная во всю ширину. */}
        <Specimen cls="fpill--sm">
          {[1, 2, 3].map((p) => (
            <Sample key={p} name={`sm square${chipPage === p ? ' on' : ''}`}><Chip sm square on={chipPage === p} onClick={() => setChipPage(p)}>{p}</Chip></Sample>
          ))}
          <Sample name={'sm square variant="soft"'}><Chip sm square variant="soft">{TX.chipMore}</Chip></Sample>
        </Specimen>

        {/* Swatch — плитка выбора. color (цвет категории бюджета) · icon (иконка
            категории, тон выбранного берётся из канала `--sw`, что оболочка
            ставит по цвету) · round (обложка трипа, круг). Выбор = ДАННЫЕ через
            `on` → aria-pressed, а не класс `.on`/`.is-active`; галочки-оверлея
            у обложки больше нет — выбор виден рамкой. */}
        <Specimen cls="swatch">
          {SWATCH_COLORS.map((c) => (
            <Sample key={c} name={swColor === c ? 'color aria-pressed' : 'color'}>
              <Swatch on={swColor === c} onClick={() => setSwColor(c)} style={{ background: c }} />
              {/* inline-style-exempt: цвет ЕСТЬ содержимое свотча (как фон-инлайн у
                  свотча цвета в BudgetLens); класс его выразить не может.
                  floor-exempt: inline +2 — витрина: фон свотча цвета и обложки
                  динамический (цвет/градиент из данных), апрув Pavel */}
            </Sample>
          ))}
        </Specimen>
        <Specimen cls="swatch--icon">
          {['bed', 'plane', 'ticket'].map((ic) => (
            <Sample key={ic} name={swIcon === ic ? 'icon aria-pressed' : 'icon'}>
              <Swatch variant="icon" icon={ic} on={swIcon === ic} tint={swColor} onClick={() => setSwIcon(ic)} />
            </Sample>
          ))}
        </Specimen>
        <Specimen cls="swatch--round">
          {SWATCH_COVERS.map((g, i) => (
            <Sample key={i} name={swCover === i ? 'round aria-pressed' : 'round'}>
              <Swatch variant="round" on={swCover === i} onClick={() => setSwCover(i)} style={{ background: g }} />
              {/* inline-style-exempt: градиент обложки ЕСТЬ содержимое свотча (как
                  фон-инлайн градиента в TripCoverPicker). */}
            </Sample>
          ))}
        </Specimen>

        <Specimen cls="badge">
          {BADGE_VARIANTS.map((v) => (
            <Sample key={v || 'base'} name={v ? `variant="${v}"` : 'base'}><Badge variant={v}>{v || 'base'}</Badge></Sample>
          ))}
          {/* Роль участника — это тон бейджа, а не свой компонент (TRIP-344 PR 1,
              на месте удалённого `RoleBadge`). Стоит здесь, а не отдельным
              образцом, ровно потому, что своего класса у неё нет и не должно
              быть: `.badge--warning` / `--brand` / `--outline` / `--quiet` —
              те же, что строкой выше. Прежний образец назывался `rb`, такого
              класса в системе нет, и витрина честно печатала над ним
              «нет в каталоге». Тона owner/admin/viewer берутся с живых экранов
              (MembersLens, MembersSummaryCard); `quiet` под «ожидает» — только
              с MembersSummaryCard: MembersLens показывает состояние приглашения
              отдельной колонкой `.m-status--pending`, а не бейджем. */}
          <Sample name={'variant="warning" (роль)'}><Badge variant="warning">{TX.roleOwner}</Badge></Sample>
          <Sample name={'variant="brand" (роль)'}><Badge variant="brand">{TX.roleAdmin}</Badge></Sample>
          <Sample name={'variant="outline" (роль)'}><Badge variant="outline">{TX.roleViewer}</Badge></Sample>
          <Sample name={'variant="quiet" (роль)'}><Badge variant="quiet">{TX.rolePending}</Badge></Sample>
        </Specimen>

        <Specimen cls="card">
          <div className="grow">
            <Card title={TX.cardTitle} subtitle={TX.cardSub} action={<Badge variant="quiet">{TX.canon}</Badge>}>
              <p className="t-body">{TX.cardBody}</p>
            </Card>
          </div>
        </Specimen>

        <Specimen cls="field">
          <div className="col col--g4 grow">
            <Field label={TX.fieldLabel} hint={TX.fieldHint} required>
              <Input placeholder={TX.placeholder} />
            </Field>
            <Field label={TX.area}>
              <Textarea rows={2} placeholder={TX.placeholder} />
            </Field>
            <InputGroup>
              <Input placeholder={TX.placeholder} />
              <Btn variant="secondary" icon="search" ariaLabel={TX.placeholder} />
            </InputGroup>
            {/* Task 3: состояния поля не вызвать ховером — показаны prop-driven,
                теми же атрибутами, что вешает `fieldState()` в приложении. */}
            <Field label={TX.fieldInvalid}>
              <Input placeholder={TX.placeholder} aria-invalid="true" />
            </Field>
            <Field label={TX.fieldWarning}>
              <Input placeholder={TX.placeholder} data-warning="" />
            </Field>
            <Field label={TX.fieldDisabled}>
              <Input placeholder={TX.placeholder} disabled />
            </Field>
            {/* readOnly ≠ disabled: поле фокусируется и копируется, но не
                редактируется. defaultValue (неконтролируемое) — иначе React
                просит onChange у value. */}
            <Field label={TX.fieldReadonly}>
              <Input readOnly defaultValue={TX.readonlyVal} />
            </Field>
          </div>
        </Specimen>

        <Specimen cls="avatar">
          {AVATAR_SIZES.map((s) => (
            <Sample key={s || 'md'} name={s ? `size="${s}"` : 'size (md)'}><Avatar name="Pavel M" size={s} /></Sample>
          ))}
          <Sample name={'kind="ai"'}><Avatar name="AI" kind="ai" /></Sample>
          <Sample name={'kind="placeholder"'}><Avatar name="?" kind="placeholder" /></Sample>
          <Sample name="deleted"><Avatar name="X" deleted /></Sample>
          <Sample name="AvatarStack"><AvatarStack people={[{ name: 'A B' }, { name: 'C D' }, { name: 'E F' }, { name: 'G H' }, { name: 'I J' }]} /></Sample>
        </Specimen>

        <Specimen cls="sev">
          <div className="col col--g4 grow">
            {SEV_LEVELS.map((l) => (
              <Sample key={l} name={`level="${l}"`} full><Severity level={l} title={TX.sevTitle}>{TX.sevBody}</Severity></Sample>
            ))}
          </div>
        </Specimen>

        <Specimen cls="empty-state">
          <div className="grow">
            <EmptyState title={TX.emptyTitle} body={TX.emptyBody} action={<Btn variant="primary">{TX.save}</Btn>} />
          </div>
        </Specimen>

        <Specimen cls="checkbox">
          <Sample name="checked"><Checkbox checked={checked} onChange={setChecked} label={TX.fieldLabel} /></Sample>
          <Sample name="disabled"><Checkbox checked={false} onChange={() => {}} label={TX.fieldLabel} disabled /></Sample>
        </Specimen>

        {/* Переключатель уехал из образца `.checkbox` в свой: у него теперь есть
            собственный класс, а до этого он делил клетку с чекбоксом просто
            потому, что своего имени не имел. Показаны все три состояния - им
            соответствуют `aria-checked`, `disabled` и `data-locked`, а не
            классы-модификаторы, поэтому в каталоге у семьи нет осей. */}
        <Specimen cls="switch">
          <Sample name="on"><Toggle on={toggled} onChange={setToggled} label={TX.fieldLabel} /></Sample>
          <Sample name="busy"><Toggle on={toggled} onChange={() => {}} busy label={TX.fieldLabel} /></Sample>
          <Sample name="locked"><Toggle on={false} onChange={() => {}} locked label={TX.fieldLabel} /></Sample>
        </Specimen>

        <Specimen cls="doc-row">
          <div className="col col--g3 grow">
            <Sample name="default" full><FileRow name={TX.file} size={TX.fileSize} /></Sample>
            <Sample name={'tone="ai"'} full><FileRow name={TX.file} size={TX.fileSize} tone="ai" /></Sample>
          </div>
        </Specimen>

        <Specimen cls="skeleton">
          <div className="col col--g3 grow">
            <Sample name={'w="60%" h={18}'} full><Skeleton w="60%" h={18} /></Sample>
            <Sample name="default" full><Skeleton /></Sample>
            <Sample name={'w="80%"'} full><Skeleton w="80%" /></Sample>
          </div>
        </Specimen>

        {/* Образец `rb` снят вместе с компонентом `RoleBadge` (TRIP-344 PR 1).
            Он и был витриной, показывающей то, чего в системе нет: имени `rb`
            не существует ни одним классом, а пилюля рисовалась инлайнами. Роль
            участника выражается тонами `badge--warning` / `--brand` / `--outline`
            / `--quiet` - так её рисуют оба живых экрана, и все четыре тона уже
            стоят в образце `badge` выше. */}
        <Specimen cls="dlg">
          <Sample name="Dialog"><Btn variant="secondary" onClick={() => setDialogOpen(true)}>{TX.openDialog}</Btn></Sample>
          <Sample name="Sheet"><Btn variant="secondary" onClick={() => setSheetOpen(true)}>{TX.openSheet}</Btn></Sample>
        </Specimen>

        <Specimen cls="readonly-banner">
          <div className="grow">
            <ReadOnlyBanner>{TX.readonly}</ReadOnlyBanner>
          </div>
        </Specimen>
      </Section>

      {/* ── раскладка: ступени отступа на видимой подложке ── */}
      <Section title={TX.sections.layout}>
        {LAYOUT.map(({ base, cls, steps: wanted }) => (
          <div key={base} className="col col--g4">
            <div className="row row--g3 row--j-center">
              <span className="t-mono trunc">{`.${cls}`}</span>
              <StatusTag cls={cls} />
            </div>
            {[null, ...wanted].map((step) => {
              const exists = step === null || steps[base]?.has(step);
              return (
                <div key={step ?? 'base'} className="col col--g2">
                  <span className="t-micro">
                    {step === null ? `.${cls} · ${TX.gapDefault}` : `.${cls}--g${step}${exists ? '' : ` · ${TX.missing}`}`}
                  </span>
                  <div className={step === null ? cls : `${cls} ${cls}--g${step}`}>
                    {[0, 1, 2].map((i) => (
                      <span key={i} className="tile tile--brand" />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </Section>

      {/* ── шкала отступов линейками ── */}
      <Section title={TX.sections.scale}>
        <div className="col col--g3">
          {SP_SCALE.map((name) => (
            <div key={name} className="row row--g4 row--j-center">
              <span className="col col--g1">
                <span className="t-mono trunc">{name}</span>
                <span className="t-micro trunc">{cs?.getPropertyValue(name).trim()}</span>
              </span>
              <span className="tile tile--brand" style={{ width: `var(${name})`, minWidth: `var(${name})` }} />
              {/* inline-style-exempt: ширина линейки ЕСТЬ сам замер - класс её
                  выразить не может, значение приходит из имени токена */}
            </div>
          ))}
        </div>
      </Section>

      {/* ── типографика живым текстом ── */}
      <Section title={TX.sections.type}>
        <div className="col col--g6">
          {TYPE_CANONS.map((cls) => (
            <div key={cls} className="col col--g2">
              <div className="row row--g3 row--j-center">
                <span className="t-mono trunc">{`.${cls}`}</span>
                <StatusTag cls={cls} />
              </div>
              <span className={cls}>{TX.sample}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* ── токены плитками ── */}
      <Section title={`${TX.sections.tokens} (${tokens.length})`}>
        {/* `.grid--2` - ЕДИНСТВЕННАЯ форма сетки в системе: у `.grid` нет колонок
            по умолчанию, а модификатор ровно один. Авто-сетки под 163 плитки в
            ДС нет, и нового имени тут не заводится - это находка для 05. */}
        <div className="grid grid--2 grid--g4">
          {tokens.map(({ name, value }) => (
            <div key={name} className="row row--g3 row--j-center">
              <span className="tile" style={{ background: /color|#|rgb|hsl/i.test(value) ? `var(${name})` : undefined }} />
              {/* inline-style-exempt: образец ПОКАЗЫВАЕТ значение токена - оно и
                  есть содержимое, класс тут невозможен по построению */}
              <span className="col col--g1 grow">
                <span className="t-mono trunc">{name}</span>
                <span className="t-micro trunc">{value}</span>
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen} title={TX.dialogTitle} icon="info"
        foot={<Btn variant="primary" onClick={() => setDialogOpen(false)}>{TX.close}</Btn>}>
        <p className="t-body">{TX.dialogBody}</p>
      </Dialog>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen} title={TX.sheetTitle} titleText={TX.sheetTitle}>
        <p className="t-body">{TX.dialogBody}</p>
      </Sheet>
    </div>
  );
}
