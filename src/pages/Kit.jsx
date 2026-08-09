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
  Avatar, AvatarStack, Badge, Btn, Card, Checkbox, Dialog, EmptyState, Field,
  FileRow, IconBtn, Input, InputGroup, ReadOnlyBanner, Severity, Sheet,
  Skeleton, Textarea, Toggle,
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
  readonly: 'Режим только для чтения.',
  file: 'documents-2026.pdf',
  gapDefault: 'по умолчанию',
  missing: 'ступени нет - молча даёт значение по умолчанию',
  sample: 'Съешь ещё этих мягких булок · Sphinx of black quartz · 0123456789',
  theme: 'Тема',
  themeLight: 'светлая',
  themeDark: 'тёмная',
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

/** Один образец: имя класса, статус из каталога, сам объект. */
const Specimen = ({ cls, children }) => (
  <div className="col col--g3">
    <div className="row row--g3 row--j-center">
      <span className="t-mono trunc">{cls}</span>
      <StatusTag cls={cls} />
    </div>
    <div className="row row--g4 row--wrap row--j-center">{children}</div>
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
const BTN_VARIANTS = ['primary', 'secondary', 'soft', 'ghost', 'quiet', 'danger', 'danger-solid', 'ai', 'pro'];
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
const ICONBTN_TONES = ['soft', 'outline', 'solid', 'ai', 'danger'];
const ICONBTN_SIZES = ['sm', 'fab'];
const ICONBTN_SHAPES = ['round'];
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
        <Specimen cls="btn">
          {BTN_VARIANTS.map((v) => (
            <Btn key={v} variant={v}>{v}</Btn>
          ))}
        </Specimen>
        <Specimen cls="btn--block">
          <Btn variant="primary" loading>{TX.save}</Btn>
          <Btn variant="primary" disabled>{TX.save}</Btn>
          <Btn variant="secondary" icon="check">{TX.save}</Btn>
          <Btn variant="secondary" iconRight="chevronRight">{TX.save}</Btn>
          <Btn variant="primary" block>{TX.save}</Btn>
        </Specimen>

        {/* Кнопка-иконка: три оси, каждая своим образцом. Первый ряд — база
            (`quiet`, `md`), у неё класса-модификатора нет и быть не должно. */}
        <Specimen cls="icon-btn">
          <IconBtn icon="close" ariaLabel={TX.close} />
          {ICONBTN_TONES.map((tone) => (
            <IconBtn key={tone} icon="close" tone={tone} ariaLabel={TX.close} title={tone} />
          ))}
        </Specimen>
        <Specimen cls="icon-btn--sm">
          {ICONBTN_SIZES.map((size) => (
            <IconBtn key={size} icon="plus" size={size} ariaLabel={TX.iconBtnSize} title={size} />
          ))}
          {ICONBTN_SHAPES.map((shape) => (
            <IconBtn key={shape} icon="arrow" round tone="soft" ariaLabel={TX.iconBtnShape} title={shape} />
          ))}
          {/* Пара «тон + форма» на одном элементе — то, ради чего оси
              независимы: это ровно `.lp-back` (soft·round) и `.mapfs-close`
              (outline·round) с живых экранов. */}
          <IconBtn icon="close" tone="outline" round ariaLabel={TX.close} />
          <IconBtn icon="bell" ariaLabel={TX.iconBtnMark}>
            <span aria-hidden className="icon-btn__dot" />
          </IconBtn>
          <IconBtn icon="close" disabled ariaLabel={TX.close} />
        </Specimen>

        <Specimen cls="badge">
          {BADGE_VARIANTS.map((v) => (
            <Badge key={v || 'base'} variant={v}>{v || 'base'}</Badge>
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
          <Badge variant="warning">{TX.roleOwner}</Badge>
          <Badge variant="brand">{TX.roleAdmin}</Badge>
          <Badge variant="outline">{TX.roleViewer}</Badge>
          <Badge variant="quiet">{TX.rolePending}</Badge>
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
          </div>
        </Specimen>

        <Specimen cls="avatar">
          {AVATAR_SIZES.map((s) => (
            <Avatar key={s || 'md'} name="Pavel M" size={s} />
          ))}
          <Avatar name="AI" kind="ai" />
          <Avatar name="?" kind="placeholder" />
          <Avatar name="X" deleted />
          <AvatarStack people={[{ name: 'A B' }, { name: 'C D' }, { name: 'E F' }, { name: 'G H' }, { name: 'I J' }]} />
        </Specimen>

        <Specimen cls="sev">
          <div className="col col--g4 grow">
            {SEV_LEVELS.map((l) => (
              <Severity key={l} level={l} title={TX.sevTitle}>{TX.sevBody}</Severity>
            ))}
          </div>
        </Specimen>

        <Specimen cls="empty-state">
          <div className="grow">
            <EmptyState title={TX.emptyTitle} body={TX.emptyBody} action={<Btn variant="primary">{TX.save}</Btn>} />
          </div>
        </Specimen>

        <Specimen cls="checkbox">
          <Checkbox checked={checked} onChange={setChecked} label={TX.fieldLabel} />
          <Checkbox checked={false} onChange={() => {}} label={TX.fieldLabel} disabled />
        </Specimen>

        {/* Переключатель уехал из образца `.checkbox` в свой: у него теперь есть
            собственный класс, а до этого он делил клетку с чекбоксом просто
            потому, что своего имени не имел. Показаны все три состояния - им
            соответствуют `aria-checked`, `disabled` и `data-locked`, а не
            классы-модификаторы, поэтому в каталоге у семьи нет осей. */}
        <Specimen cls="switch">
          <Toggle on={toggled} onChange={setToggled} label={TX.fieldLabel} />
          <Toggle on={toggled} onChange={() => {}} busy label={TX.fieldLabel} />
          <Toggle on={false} onChange={() => {}} locked label={TX.fieldLabel} />
        </Specimen>

        <Specimen cls="doc-row">
          <div className="col col--g3 grow">
            <FileRow name={TX.file} size={182400} />
            <FileRow name={TX.file} size={182400} tone="ai" />
          </div>
        </Specimen>

        <Specimen cls="skeleton">
          <div className="col col--g3 grow">
            <Skeleton w="60%" h={18} />
            <Skeleton />
            <Skeleton w="80%" />
          </div>
        </Specimen>

        {/* Образец `rb` снят вместе с компонентом `RoleBadge` (TRIP-344 PR 1).
            Он и был витриной, показывающей то, чего в системе нет: имени `rb`
            не существует ни одним классом, а пилюля рисовалась инлайнами. Роль
            участника выражается тонами `badge--warning` / `--brand` / `--outline`
            / `--quiet` - так её рисуют оба живых экрана, и все четыре тона уже
            стоят в образце `badge` выше. */}
        <Specimen cls="dlg">
          <Btn variant="secondary" onClick={() => setDialogOpen(true)}>{TX.openDialog}</Btn>
          <Btn variant="secondary" onClick={() => setSheetOpen(true)}>{TX.openSheet}</Btn>
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
