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
import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import catalog from '@/design/catalog.json';
import {
  Avatar, AvatarStack, Badge, Btn, Card, CardHeader, Checkbox, Chip, Dialog, EmptyState, Field,
  FileRow, IconBtn, Input, InputGroup, ReadOnlyBanner, Seg, Severity, Sheet,
  Skeleton, Stepper, Swatch, Textarea, Toggle,
  BTN_VARIANTS, CARD_VARIANTS, ICON_BTN_TONES, ICON_BTN_SIZES, SEG_VARIANTS, STEPPER_VARIANTS,
} from '@/design/index';
import { KIT_OBJECTS, KIT_GROUPS, kitObjectById } from './kit-objects';
// Витринный слой: только force-state зеркала под `data-force` (см. Kit.css).
import './Kit.css';

/* ─────────────────────────────── текст ─────────────────────────────────── */
const TX = {
  title: 'Витрина дизайн-системы',
  lead: 'Тот же код, что и в приложении: /kit импортирует @/design. Один объект — одна страница; образцы генерируются из карт вариантов компонентов и из живых стилей.',
  canon: 'канон', triage: 'на разборе', unknown: 'нет в каталоге',
  back: '← все объекты',
  theme: 'Тема', themeLight: 'светлая', themeDark: 'тёмная',
  groups: {
    components: 'Компоненты', layout: 'Примитивы раскладки',
    scale: 'Шкала отступов', type: 'Типографика', tokens: 'Токены :root',
  },
  titles: {
    'btn': 'Кнопка', 'icon-btn': 'Кнопка-иконка', 'chip': 'Пилюля (Chip)',
    'seg': 'Сегмент-контрол', 'stepper': 'Степпер', 'swatch': 'Свотч',
    'badge': 'Бейдж', 'card': 'Карточка', 'field': 'Поле ввода', 'input': 'Декорации поля',
    'avatar': 'Аватар', 'sev': 'Плашка сообщения', 'empty-state': 'Пустое состояние',
    'checkbox': 'Чекбокс', 'switch': 'Тумблер', 'doc-row': 'Строка документа',
    'skeleton': 'Скелет', 'dialog': 'Оверлеи', 'readonly-banner': 'Плашка «только чтение»',
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
    'avatar': 'Инициалы / фото / AI / плейсхолдер / удалён; размеры и стопка.',
    'sev': 'Тон по уровню важности (info/warning/error/success/quiet).',
    'empty-state': 'Каркас с иконкой, текстом и призывом к действию.',
    'checkbox': 'Вкл/выкл (aria-checked); disabled.',
    'switch': 'Вкл/выкл; busy (операция в полёте); locked.',
    'doc-row': 'Имя, размер, тон (обычный / ai).',
    'skeleton': 'Плейсхолдер загрузки, разной ширины.',
    'dialog': 'Диалог и шит — оверлеи (открываются кнопкой).',
    'readonly-banner': 'Режим просмотра трипа.',
    'tile': 'Квадрат под значок: тон · размер · форма · залитая.',
    'spin': 'Ступени размера (lg/xl) и тон головки (ink/onscrim).',
    'toast': 'Уведомление; тон по уровню важности красит иконный квадрат.',
    'sheet-row': 'Действие во всю ширину; danger — деструктивное.',
    'ai-blk': 'Распознавание брони, состояние «доступно» = кликабельная пилюля.',
    'time': 'Вылет сверху, прибытие снизу (в ленте у события-переезда).',
    'row': 'Флекс-ряд: зазор (ступени --sp-N) и оси выравнивания/потока.',
    'col': 'Флекс-колонка: зазор и оси.',
    'grid': 'Сетка: зазор и колонки.',
    'spacing': 'Ступени токена --sp-N линейками (замер из живых стилей).',
    'typography': '10 текст-стилей .t-* живым текстом.',
    'tokens': 'Имена, объявленные в :root текущей темы (замер).',
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
  sample: 'Съешь ещё этих мягких булок · Sphinx of black quartz · 0123456789',
  gapDefault: 'по умолчанию', missing: 'ступени нет — молча даёт значение по умолчанию',
  // Текст образцов — данными (правило 2 этого файла): гард 2d ловит узлы `>текст<`
  // и `title=`-литералы, из `TX` он их не видит; ключи в локали заводить незачем.
  lockmsg: 'Подключает владелец', accent: 'тон из контекста', brandName: 'Найти на Booking',
  members: 'Участники', chipAll: 'Все', chipJump: 'Новые сообщения', chipRoute: 'Лиссабон → Порту',
  chipAdd: 'Добавить переезд', chipMore: '+2 ещё',
  roleOwner: 'Владелец', roleAdmin: 'Админ', roleViewer: 'Наблюдатель', rolePending: 'Ожидает',
  cardTitle: 'Заголовок карточки', cardBody: 'Тело карточки: обычный текст на поверхности.',
  cardHead: 'Заголовок', sevText: 'Текст',
  sevInvite: 'Нажмите, чтобы разрешить', sevInviteTitle: 'Приглашение',
  sevBody: 'Текст сообщения на одну-две строки.', sevTitle: 'Заголовок плашки',
  emptyTitle: 'Пока пусто', emptyBody: 'Здесь появятся элементы.',
  emptyBoxTitle: 'Пусто', emptyBoxBody: 'В рамке (boxed).',
  openDialog: 'Открыть диалог', openSheet: 'Открыть шит', readonly: 'Режим только для чтения.',
  toastTitle: 'Готово', toastBody: 'Изменения сохранены.',
  sheetNormal: 'Обычное действие', sheetDanger: 'Удалить',
  aiTitle: 'Распознать бронь', aiSub: 'Вставьте текст письма',
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

/* ─────────────────────────── рецепты рендера ─────────────────────────────── */
/** Один рецепт = `(ctx) => Array<{ label?, items:[{name,node,full?}] }>`. Значения
 *  оси едут из карты (импортированные `*_VARIANTS`) или из CSS-производного
 *  списка семьи (`ctx.declared` — полные имена классов). Рецепт знает, КАК
 *  показать вариант; ЧТО показать — данные. */
const it = (name, node, full) => ({ name, node, full });
const glyph = 'Ag';

const RECIPES = {
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
        it('icon-btn__dot', <IconBtn icon="bell" ariaLabel="Непрочитанное"><span aria-hidden className="icon-btn__dot" /></IconBtn>),
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
      label: 'модификаторы (extras): square · sm · avatars', items: [
        it('square', <Chip square>12 300 ₽</Chip>),
        it('variant="tone" square', <span className="te-cell--act"><Chip variant="tone" square icon="ticket">3</Chip></span>),
        ...[1, 2, 3].map((p) => it(`sm square${ctx.chipPage === p ? ' on' : ''}`, <Chip sm square on={ctx.chipPage === p} onClick={() => ctx.setChipPage(p)}>{p}</Chip>)),
        it('sm square variant="soft"', <Chip sm square variant="soft">{TX.chipMore}</Chip>),
        it('avatars', <Chip avatars><AvatarStack people={[{ name: 'А' }, { name: 'М' }, { name: 'К' }]} />{TX.members}</Chip>),
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
  ],

  card: () => {
    // Проп-набор на каждый суффикс `.card--*`: витрина ПОЛНА ПО ПОСТРОЕНИЮ -
    // рисует ровно то, что объявляет карта `CARD_VARIANTS` (тест дрейфа сверяет
    // её ↔ живой CSS в обе стороны). radius/tone эмитятся своими пропами; булевы
    // формы - одноимённым пропом; danger - `danger`; до-края - `pad="none"`.
    const P = {
      'r-lg': { radius: 'lg' }, 'r-md': { radius: 'md' },
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

  'readonly-banner': () => [{ items: [it('base', <div className="grow"><ReadOnlyBanner>{TX.readonly}</ReadOnlyBanner></div>, true)] }],

  tile: (ctx) => [{
    label: 'тон · размер · форма · залитая (CSS-производный список семьи)',
    items: ctx.declared.map((c) => {
      const t = tailOf(c);
      if (t === 'solid') return it('tile--solid (+ai)', <span className="tile tile--solid tile--ai" />);
      if (t === 'warm') return it('tile--solid + tile--warm', <span className="tile tile--solid tile--warm" />);
      if (['round', 'sm', 'lg', 'xl', '2xl'].includes(t)) return it(c, <span className={`tile tile--brand ${c}`} />);
      return it(c, <span className={`tile ${c}`} />);
    }),
  }],

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

  toast: (ctx) => [{
    items: ctx.declared.map((c) => it(c, (
      <div className={`toast ${c}`}>
        <span className="tic" />
        <div className="toast__body"><b>{TX.toastTitle}</b><span>{TX.toastBody}</span></div>
      </div>
    ), true)),
  }],

  'sheet-row': (ctx) => [{
    items: [
      it('sheet-row (база)', <button type="button" className="sheet-row">{TX.sheetNormal}</button>, true),
      ...ctx.declared.filter((c) => c.startsWith('sheet-row')).map((c) => it(c, <button type="button" className={`sheet-row ${c}`}>{TX.sheetDanger}</button>, true)),
    ],
  }],

  'ai-blk': (ctx) => [{
    items: ctx.declared.filter((c) => c.startsWith('ai-blk')).map((c) => it(c, (
      <button type="button" className={`ai-blk ${c}`}>
        <div className="ai-blk-hd"><span className="ai-blk-ti"><b>{TX.aiTitle}</b><span>{TX.aiSub}</span></span></div>
      </button>
    ), true)),
  }],

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
        {specimens.map((s, i) => <Specimen key={i} label={s.label} items={s.items} />)}
      </div>
    </Card>
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

const TYPE_CANONS = ['t-display', 't-title', 't-heading', 't-subheading', 't-label', 't-body', 't-ui', 't-meta', 't-micro', 't-mono'];
function TypographySection() {
  return (
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
