import React from 'react';
import { Dialog as UIDialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Icon } from './icons';
import { useT } from '@/lib/i18n/I18nContext';
import { avatarGradient } from '@/lib/avatarRamp';
import { fmtMoneyActive } from '@/lib/i18n/format';
import { faviconUrl } from '@/lib/booking-platforms';
import { detectPartner } from '@/lib/externalBrands';
import { transferKind } from '@/lib/transport';
import FileTypeBadge from '@/components/common/FileTypeBadge';

// =====================================================================
// Primitive layer (Radix-backed) — single import surface.
// These wrap @radix-ui/* + Lumo tokens and live under src/components/ui/*.
// Re-exported here so every caller imports from '@/design' and the ui/*
// folder stays an internal implementation detail (not a public surface).
// The raw Radix dialog root is exposed as `DialogRoot` to avoid colliding
// with the composed <Dialog> (title/icon/foot chrome) defined below.
// =====================================================================
export { UIDialog as DialogRoot, DialogContent, DialogTitle };
export {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor } from '@/components/ui/popover';
export { Sheet } from '@/components/ui/Sheet';
export { ActionMenu } from '@/components/ui/ActionMenu';
export { useToast, toast } from '@/components/ui/use-toast';
export { Toaster } from '@/components/ui/toaster';
export { default as SearchSelect } from '@/components/ui/SearchSelect';
export { default as CurrencyCombobox } from '@/components/ui/CurrencyCombobox';
export { default as AiField, AiBadge } from '@/components/ui/AiField';
// Поле живёт своим модулем, чтобы `components/ui/*` мог импортировать его
// напрямую и не замыкать зависимость на этот барраль (TRIP-333).
export { Input, Textarea, InputGroup } from './Input';
import { FieldRequired } from './Input';
// Раскладка — своим модулем по той же причине, что и поле: барраль тянет
// `components/ui/*`, а примитив раскладки обязан быть доступен без этого хвоста
// (TRIP-388). Экраны зовут его отсюда, чтобы точка входа в ДС была одна.
export { Row, Col, Grid, Trunc, Grow } from './Layout';

// =====================================================================
// Shared components + mock data - converted from global scripts to ES modules
// =====================================================================

// ----- Avatar ----- (colours: src/lib/avatarRamp.js — single source)
/** @param {{ name?: string, size?: string, kind?: string, photo?: string, deleted?: boolean, className?: string, style?: any }} p */
export const Avatar = ({ name = "?", size, kind, photo, deleted, className = "", style: styleProp }) => {
  const t = useT();
  const initials = name.split(/\s+/).map(p => p[0]).join("").slice(0, 2).toUpperCase();
  if (deleted) {
    return <div className={`avatar ${size ? "avatar--" + size : ""} avatar--deleted ${className}`} style={styleProp} aria-label={t('common.deleted_user')}><Icon name="user" size={size === "lg" ? 18 : size === "sm" ? 12 : 15} /></div>;
  }
  if (kind === "ai") {
    return <div className={`avatar ${size ? "avatar--" + size : ""} avatar--ai ${className}`} style={styleProp}>AI</div>;
  }
  if (kind === "placeholder") {
    return <div className={`avatar ${size ? "avatar--" + size : ""} avatar--placeholder ${className}`} style={styleProp}>{initials}</div>;
  }
  const style = photo
    ? { backgroundImage: `url(${photo})`, backgroundSize: "cover", backgroundPosition: "center", ...styleProp }
    : { background: avatarGradient(name), ...styleProp };
  return (
    <div className={`avatar ${size ? "avatar--" + size : ""} ${className}`} style={style}>
      {!photo && initials}
    </div>
  );
};

// ----- AvatarStack -----
// `people` rows carry the same fields as <Avatar>: name + optional photo/deleted/kind.
// Photos matter — the chat header stacks real member avatars, and without them the
// stack fell back to initials while the same people showed photos two lines below.
/** @param {{ people?: any[], max?: number, size?: string, className?: string }} p */
export const AvatarStack = ({ people = [], max = 4, size = "sm", className = "" }) => (
  <div className={className ? `avatar-stack ${className}` : "avatar-stack"}>
    {people.slice(0, max).map((p, i) => <Avatar key={i} name={p.name} photo={p.photo} deleted={p.deleted} kind={p.kind} size={size} />)}
    {/* border у «+N» не пишем: он дословно дублировал .avatar, а инлайн-дубль
        переживает правку класса и молча расходится с соседями по стопке. */}
    {people.length > max && (
      <div className={`avatar avatar--${size}`} style={{ background: "var(--wash)", color: "var(--muted)" }}>
        +{people.length - max}
      </div>
    )}
  </div>
);

// ----- Severity message -----
// Значок по умолчанию свой у каждого тона. Раньше здесь стояла вилка, знавшая
// ровно три тона, а всё остальное рисовавшая крестом ошибки - success молча
// уехал бы в «ошибку». Карта вместо вилки: новый тон = новая строка.
const SEV_ICON = { info: "info", warning: "warning", error: "error", success: "check", quiet: "info" };

// align="mid" - значок по центру пары «заголовок + подпись» (дефолт ряда).
// iconStyle - тинт плитки из реестра брендов. Это ДАННЫЕ, а не тон системы:
// плашка остаётся системной, фирменный цвет несёт только плитка (то же решение,
// что принято на экране аккаунта - фон плитки есть оттенок её значка).
// dashed  - плашка не сообщает состояние, а ЗОВЁТ нажать (разрешить геолокацию).
//           Тот же язык, что у кнопок добавления: пунктир = «здесь пока пусто».
// loading - на месте значка канон-спиннер, как у <Btn loading> (TRIP-130).
//           Плашка «идёт сохранение» рисовалась руками там же, где и остальные.
// ★Раскладку плашка БОЛЬШЕ НЕ СОБИРАЕТ САМА. Ровно этот объект - плитка,
// заголовок с подписью и действие справа - уже собран на карточках «Скопировать
// путешествие» и «Выйти из трипа», и собран ПРИМИТИВОМ `.row`. Плашка писала
// тот же ряд своим флексом, а её `{action}` был голым ребёнком без `flex`, и
// ряд не умел переноситься - поэтому кнопка «Разрешить геолокацию» разъезжалась
// в узкой колонке планировщика (и так же в шести других местах).
// За `.sev` остался ТОЛЬКО ТОН - фон и рамка по уровню. Это его единственная
// роль, которой ни у кого больше нет. Всё остальное - общие примитивы:
//   .row            ряд (по центру; `--start` когда тело многострочное)
//   .row--wrap      на узком кнопка уходит ПОД текст, а не давит его
//   .tile           плитка значка
//   .grow           текстовый блок
//   .row__t         заголовок - тот же канон, что у карточек-близнецов
/** @param {{ level?: string, title?: any, children?: any, action?: any, icon?: string, iconStyle?: any, align?: string, dashed?: boolean, loading?: boolean }} p */
export const Severity = ({ level = "info", title, children, action, icon, iconStyle, align, dashed, loading }) => (
  <div className={`sev row row--wrap${align === "mid" ? "" : " row--a-start"} sev--${level}${dashed ? " sev--dashed" : ""}`}>
    <span className="tile sev__icon" style={iconStyle}>
      {loading ? <span className="spin spin--ring" /> : <Icon name={icon || SEV_ICON[level] || "info"} size={16} />}
    </span>
    <div className="grow">
      {title && <div className="row__t">{title}</div>}
      {children}
    </div>
    {action}
  </div>
);

// ----- FileRow ----- (TRIP-321 Ф14.7, апрув Pavel)
// ЕДИНСТВЕННАЯ строка вложенного файла. До неё их было шесть штук в пяти файлах,
// и общий класс их не спас: рамку они делили, а имя файла рисовали ТРЕМЯ разными
// способами - <b> (жирный), <a style={{color: brand}}> (синий) и <span>
// (обычный); у половины был размер файла, у половины нет; отступ то 8, то 10.
// Разметка-под-общим-классом это не лечит, потому что расходится не рамка, а
// содержимое - поэтому здесь компонент, а не ещё один модификатор.
//   href   - имя становится ссылкой (файл открывается в новой вкладке);
//   size   - готовая строка размера, мета-ярусом справа;
//   tone   - 'ai' для распознавания брони, иначе нейтральная рамка;
//   action - кнопка справа (снять вложение), общий класс .doc-row__rm.
// ★Проп `plain` убран вместе со своим модификатором (TRIP-333). Он делил ОДИН
// список файлов на белый (просмотр события) и тонированный (Документы трипа,
// поле формы), из-за чего одно и то же наведение давало разный скачок цвета,
// хотя оба списка лежат на одной и той же светлой подложке. Скин теперь один -
// фон и рамка роли; отличается только вариант ИИ, и только цветом рамки.
// ★Кликабельна ВСЯ строка, а не только имя: подсветка при наведении лежит на
// строке (.doc-row:hover), и если ссылкой будет одно имя, то подсвеченное поле
// шире кликабельного - на телефоне это просто «не нажимается». Ссылкой строка
// становится только когда действия справа нет: <button> внутри <a> невалиден,
// поэтому у строки с крестиком ссылка остаётся на имени.
/** @param {{ name: string, href?: string, size?: string, tone?: string, action?: any, fallback?: string }} p */
export const FileRow = ({ name, href, size, tone, action, fallback }) => {
  const label = name || fallback || '';
  const cls = `doc-row row${tone === 'ai' ? ' doc-row--ai' : ''}`;
  const wholeRowIsLink = href && !action;
  const Root = wholeRowIsLink ? 'a' : 'div';
  const rootProps = wholeRowIsLink ? { href, target: '_blank', rel: 'noreferrer' } : {};
  return (
    <Root className={cls} {...rootProps}>
      <FileTypeBadge name={name} />
      {href && action
        ? <a className="doc-row__n grow--fit trunc" href={href} target="_blank" rel="noreferrer">{label}</a>
        : <span className="doc-row__n grow--fit trunc">{label}</span>}
      {size && <span className="ds">{size}</span>}
      {action}
    </Root>
  );
};

// ----- ReadOnlyBanner ----- (TRIP-225)
// Единый баннер роли наблюдателя (viewer read-only), раньше копипастился в
// DocsLens / BudgetLens / SettingsLens одинаковым <Severity level="info" …>.
// Заголовок — канонический (settings.readonly_banner_title); описание — per-lens
// через children. Обёртка `.readonly-banner` несёт консистентный отступ там, где
// контейнер не раскладывает детей через gap (см. app.css).
/** @param {{ children?: any, title?: any }} p */
export const ReadOnlyBanner = ({ children, title }) => {
  const t = useT();
  return (
    <div className="readonly-banner">
      <Severity level="info" title={title || t('settings.readonly_banner_title')}>
        {children}
      </Severity>
    </div>
  );
};

// ----- Form Field -----
// Подпись + обёртка поля. Состояние валидации сюда НЕ приходит: единственный
// живой источник - `fieldState` из ValidationUI, он вешает атрибуты на САМО
// поле, а текст ошибки печатает `<FieldError>` (TRIP-333).
// Пропы `error`/`warning` тут были ровно вторым способом сказать то же самое и
// за всё время не получили НИ ОДНОГО вызова из 25 - удалены вместе со своими
// строками-иконками и мёртвым скином `.field--error`. Проп `ai` (фиолетовая
// заливка + бейдж «AI» на подписи) ушёл туда же: ни одного вызова из тех же 25,
// а живая реализация того же объекта - `.ai-filled` в index.css, её ставит
// `<AiField>` вокруг поля, заполненного распознаванием брони.
// `required` рисует звёздочку И доезжает до самого поля контекстом (TRIP-333):
// раньше это была ТОЛЬКО звёздочка, то есть признак для зрячих - нативный
// `required` стоял лишь на сырых полях экрана входа, а `aria-required` не стоял
// нигде. Провайдер объявлен рядом с полем (`./Input`), которое его и читает.
/** @param {{ label?: any, hint?: any, sub?: any, children?: any, required?: boolean }} p */
export const Field = ({ label, hint, sub, children, required = false }) => (
  <div className="field">
    {label && (
      <label className="field__label">
        {/* Звёздочка живёт на спане с текстом, а не на `<label>`: так она встаёт
            сразу за подписью, а не за подсказкой, и не попадает под `gap`
            флекс-лейбла (см. `[data-required]` в app.css). */}
        <span data-required={required || undefined}>{label}</span>
        {hint && <span className="muted t-meta" style={{ marginLeft: 4 }}>· {hint}</span>}
      </label>
    )}
    <FieldRequired value={required}>{children}</FieldRequired>
    {sub && <span className="field__sub t-meta">{sub}</span>}
  </div>
);

// ----- Buttons -----
// `loading` renders the canonical Lumo in-button spinner (.btn .spin) in place
// of the leading icon, disables the button and flags aria-busy — the single
// source of truth for "operation in flight" feedback across the app.
/** @param {{ variant?: string, icon?: string, iconRight?: string, block?: boolean, disabled?: boolean, loading?: boolean, children?: any, onClick?: any, className?: string, ariaLabel?: string, title?: string, ariaPressed?: boolean, style?: any }} p */
export const Btn = ({ variant = "ghost", icon, iconRight, block, disabled, loading, children, onClick, className = "", ariaLabel, title, ariaPressed, style }) => (
  <button
    // Дефолт <button> внутри формы — submit, поэтому все 163 вызова Btn
    // отправляли бы ближайшую <form> в довесок к своему onClick. Соседний
    // Toggle type="button" ставит и объясняет зачем — то есть про грабли
    // знали, а на самой кнопке системы их не закрыли (TRIP-344 PR 1).
    type="button"
    className={`btn btn--${variant} ${block ? "btn--block" : ""} ${className}`}
    onClick={onClick}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    aria-label={ariaLabel}
    aria-pressed={ariaPressed}
    title={title}
    style={style}
  >
    {loading ? <span className="spin" /> : (icon && <Icon name={icon} size={16} />)}
    {children}
    {iconRight && !loading && <Icon name={iconRight} size={16} />}
  </button>
);

// ----- Badge -----
/** @param {{ variant?: string, icon?: string, children?: any, style?: any }} p */
export const Badge = ({ variant = "", icon, children, style }) => (
  <span className={`badge ${variant ? "badge--" + variant : ""}`} style={style}>
    {icon && <Icon name={icon} size={11} />}
    {children}
  </span>
);

// ----- Card -----
/** @param {{ title?: any, subtitle?: any, action?: any, children?: any, className?: string, style?: any }} p */
export const Card = ({ title, subtitle, action, children, className = "", style }) => (
  <div className={`card ${className}`} style={style}>
    {(title || subtitle || action) && (
      <div className="card-h">
        <div className="grow">
          {title && <h3>{title}</h3>}
          {subtitle && <div className="muted t-meta">{subtitle}</div>}
        </div>
        {action}
      </div>
    )}
    {children}
  </div>
);

// ----- Empty / Loading / Error states -----
// kind -> тон плитки .tile--*; всё, что не error (включая дефолтный empty),
// красится в brand - так же, как было у инлайнового варианта. Тонов ровно два,
// поэтому это тернарник, а не карта: карта на один ключ ещё и читалась бы по
// прототипу (kind="constructor" склеил бы мусорный класс).
// Вариант kind="locked" (розовая Pro-плитка) удалён в TRIP-321 Ф12.0: он приехал
// с первым коммитом дизайн-системы и НИ РАЗУ не был вызван. «Раздел только в Pro»
// в продукте показывается модалкой ProUpsellModal с офером, а не пустым экраном,
// поэтому это не отложенная фича, а нарисованный и неподключённый четвёртый вид.
// boxed - компактный вариант внутри карточки/диалога (подложка + рамка).
// iconStyle - тинт плитки из реестра брендов, как у Severity: сам примитив
// остаётся системным, фирменный цвет несёт только плитка.
// Тон плитки - КАРТА, а не вилка: раньше «всё, что не error» молча становилось
// брендовым, и экран «трип создан» рисовал свою зелёную плитку руками мимо
// примитива. Новый тон = новая строка, как у SEV_ICON выше.
const EMPTY_TONE = { empty: "brand", error: "danger", success: "success", warning: "warning" };

/** @param {{ icon?: string, title?: any, body?: any, action?: any, kind?: string, boxed?: boolean, iconStyle?: any }} p */
export const EmptyState = ({ icon = "sparkles", title, body, action, kind = "empty", boxed = false, iconStyle }) => (
  <div className={`empty-state${boxed ? " empty-state--boxed" : ""}`}>
    <div
      className={`tile ${boxed ? "tile--xl" : "tile--2xl"} tile--${EMPTY_TONE[kind] || "brand"}`}
      style={iconStyle}
    >
      <Icon name={icon} size={boxed ? 21 : 28} />
    </div>
    <h3 className="empty-state__t">{title}</h3>
    <div className="t-body empty-state__b">{body}</div>
    {action && <div className="empty-state__act">{action}</div>}
  </div>
);

// ----- Skeleton -----
/** @param {{ w?: number|string, h?: number|string, r?: number|string, style?: any }} p */
export const Skeleton = ({ w = "100%", h = 14, r = 6, style }) => (
  <div className="skeleton" style={{ width: w, height: h, borderRadius: r, ...style }} />
);

// ----- Checkbox -----
// A real <input type="checkbox"> under the `.checkbox` skin (app.css), so native
// keyboard, focus and <label> semantics come for free.
//
// Checkbox vs Toggle: a checkbox is a value you pick and then submit (a form
// field, a filter applied by a button); a Toggle is a setting that takes effect
// the moment you flip it. Don't swap one for the other to look tidier.
/** @param {{ checked?: boolean, onChange?: any, label?: any, disabled?: boolean, className?: string }} p */
export const Checkbox = ({ checked, onChange, label, disabled, className = "" }) => (
  <label className={`checkbox ${className}`}>
    <input
      type="checkbox"
      checked={!!checked}
      disabled={disabled || undefined}
      onChange={(e) => onChange?.(e.target.checked)}
    />
    {label && <span>{label}</span>}
  </label>
);

// ----- Toggle -----
// `busy` shows an in-knob spinner and blocks interaction while the change is
// being persisted server-side — toggles never report a state the backend
// hasn't confirmed (no optimistic flips).
// Rendered as a real switch: `type="button"` keeps a Toggle inside a <form>
// from submitting it, and `aria-checked` is what carries the on/off state to a
// screen reader (`aria-label` on its own only supplies the name).
/** @param {{ on?: boolean, onChange?: any, locked?: boolean, busy?: boolean, label?: any }} p */
export const Toggle = ({ on, onChange, locked, busy, label }) => (
  <button
    type="button"
    role="switch"
    className="switch"
    aria-checked={!!on}
    aria-label={label}
    aria-busy={busy || undefined}
    data-locked={locked || undefined}
    onClick={() => !locked && !busy && onChange && onChange(!on)}
    disabled={busy || undefined}
  >
    {/* Дорожка, бегунок и растянутый до 44px тач-таргет живут в `.switch`
        (app.css). Состояние сюда не передаётся классом: его уже несут
        `aria-checked` и `disabled` из контракта role="switch", а «выключен по
        праву» — `data-locked`. */}
    <span className="switch__knob">
      {busy && <span className="spin" />}
    </span>
  </button>
);

// ----- Currency formatting -----
// Canonical money formatter (locale-aware, decimals only when present).
export const fmt = (n, cur = "EUR") => fmtMoneyActive(n, cur);

// ----- RoleBadge: УДАЛЁН (TRIP-344 PR 1) -----
// Роль участника — это `<Badge>` с тоном, и приложение уже выражало её так в
// ОБОИХ местах, где она видна: `MembersLens` и `MembersSummaryCard` независимо
// сошлись на owner=warning · admin=brand · viewer=outline · приглашён=quiet.
// `RoleBadge` был третьим, ЧЕТВЁРТЫМ по счёту способом сказать то же самое —
// собственной пилюлей на инлайнах (свои тона warm/brand-soft/wash, свой радиус,
// свои отступы), мимо `.badge`, объявленного строкой выше. За пределы витрины
// `/kit` он не вышел ни разу, так что схлопывание не тронуло ни одного экрана.

// ---- Dialog: title/icon/foot/size convenience wrapper over the ONE canonical
//      modal engine (@/components/ui/dialog → Radix). The legacy ModalHost +
//      window.__openModal stack has been removed; every modal in the app now
//      runs on the same `ui/dialog` Dialog/DialogContent. ----
// iconTone swaps the header-icon tint to an existing Lumo event token set
// (default = brand). Add tones here as needed — no new tokens introduced.
const DLG_ICON_TONES = {
  activity: { bg: 'var(--ev-activity-soft)', fg: 'var(--ev-activity-ink)' },
};
/** @param {{ title?: any, subtitle?: any, icon?: string, iconTone?: string, onClose?: any, size?: string, children?: any, foot?: any, open?: boolean, onOpenChange?: any }} p */
export const Dialog = ({ title, subtitle, icon, iconTone, onClose, size, children, foot, open, onOpenChange }) => {
  const handleClose = () => { onClose?.(); onOpenChange?.(false); };
  const tone = DLG_ICON_TONES[iconTone] || { bg: 'var(--brand-soft)', fg: 'var(--brand)' };
  return (
    <UIDialog open={open === undefined ? true : open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      {/* a11y contract lives HERE — the one wrapper every app dialog uses. The
          visible <h2>/subtitle ARE the Radix Title/Description (asChild → native,
          no hidden duplicate, zero visual change). With no subtitle we opt out of
          the description explicitly (aria-describedby={undefined}) so Radix stays
          quiet without a bogus empty node. (TRIP-202) */}
      <DialogContent className={size ? `dlg--${size}` : ''} {...(subtitle ? {} : { 'aria-describedby': undefined })}>
        <div className="dlg__head">
          {icon && (
            /* Геометрия - примитив .tile (34px, значок 17px = дефолт лестницы;
               было 36px руками, а ступень --md и есть полоса 32-36). Тон пока
               остаётся данными на элементе, как у Severity/EmptyState выше:
               системным классом он станет, когда у .tile--* появится тон
               события - сегодняшний набор тонов цветов события не знает. */
            <div className="tile" style={{ background: tone.bg, color: tone.fg }}>
              <Icon name={icon} size={17} />
            </div>
          )}
          <div className="grow--fit">
            <DialogTitle asChild><h2>{title}</h2></DialogTitle>
            {subtitle && <DialogDescription asChild><div className="muted t-meta" style={{ marginTop: 2 }}>{subtitle}</div></DialogDescription>}
          </div>
          <button className="icon-btn" onClick={handleClose}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="dlg__body">{children}</div>
        {foot && <div className="dlg__foot">{foot}</div>}
      </DialogContent>
    </UIDialog>
  );
};

// ---- Partner logo helper ----
// Бренд-цвета партнёров живут в lib/externalBrands (единственный дом внешних
// брендов), а не рядом с компонентом, который их рисует.

/** @param {{ url?: string, size?: number }} p */
export const PartnerLogo = ({ url, size = 18 }) => {
  const p = detectPartner(url);
  // Real favicon of the booking site (same source as the event view/edit dialogs)
  // instead of a letter monogram. Falls back to the letter/link icon if the
  // favicon can't load or the URL has no plausible host. Single owner of the
  // favicon URL + host-validity is `faviconUrl` (no dup, no request for a
  // half-typed host). (TRIP-202)
  const favicon = faviconUrl(url);
  const [imgFailed, setImgFailed] = React.useState(false);

  // Квадрат 16-18px на лестницу .tile НЕ садится: её нижняя ступень 28px, а ниже
  // дефолтный --tile-r (--r-sm) делает из квадрата пилюлю - ловушка Ф3b.
  // Поэтому геометрия живёт здесь, но объявляется ОДИН раз на три ветки.
  // Кегль монограммы к общему НЕ выносится: гард 2k пропускает «декоративный
  // глиф» по вычисленному fontSize В ТОЙ ЖЕ СТРОКЕ, и разведённый с ним
  // fontWeight гард роняет (проверено).
  const box = { width: size, height: size, borderRadius: 4, flexShrink: 0 };
  const glyph = { ...box, display: "grid", placeItems: "center" };

  if (favicon && !imgFailed) {
    return (
      <img
        src={favicon}
        alt=""
        onError={() => setImgFailed(true)}
        style={{ ...box, objectFit: "cover", background: "var(--wash)" }}
      />
    );
  }
  if (!p) return (
    <div style={{ ...glyph, background: "var(--line)", color: "var(--muted)", fontSize: size * 0.55, fontWeight: 700 }}>
      <Icon name="link" size={size * 0.6} />
    </div>
  );
  return (
    <div style={{ ...glyph, background: p.color, color: "white", fontSize: size * 0.5, fontWeight: 700 }}>
      {p.short}
    </div>
  );
};

// Not exported: rendered only by StreamEventRow below.
const PartnerPill = ({ url, fallback }) => {
  const t = useT();
  const p = detectPartner(url);
  return (
    <span className="partner-pill">
      <PartnerLogo url={url} size={16} />
      {p?.label || fallback || t('common.link')}
    </span>
  );
};

// =====================================================================
// SHARED TIMELINE UTILITIES - exported so all screens can use them
// =====================================================================

const _WEEKDAYS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const _MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

const _LOCMAP = { ru: 'ru-RU', en: 'en-US', es: 'es-ES' };
// ru output kept byte-identical (Public + ru callers unchanged); en/es via Intl.
export function fmtDate(iso, loc) {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return '';
  if (loc && loc !== 'ru') {
    try { return new Intl.DateTimeFormat(_LOCMAP[loc] || loc, { day: 'numeric', month: 'short' }).format(d); } catch { /* fallthrough */ }
  }
  return `${d.getDate()} ${_MONTHS[d.getMonth()]}`;
}

export function weekday(iso, loc) {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return '';
  if (loc && loc !== 'ru') {
    try { return new Intl.DateTimeFormat(_LOCMAP[loc] || loc, { weekday: 'short' }).format(d); } catch { /* fallthrough */ }
  }
  return _WEEKDAYS[d.getDay()];
}

const _WEEKDAYS_LONG = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
// Full weekday name (Lumo timeline header writes them out in full).
export function weekdayLong(iso, loc) {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return '';
  if (loc && loc !== 'ru') {
    try { return new Intl.DateTimeFormat(_LOCMAP[loc] || loc, { weekday: 'long' }).format(d); } catch { /* fallthrough */ }
  }
  return _WEEKDAYS_LONG[d.getDay()];
}

// ----- Transfer card helpers -----
function _addDuration(time, dur) {
  if (!time || !dur) return null;
  const [h, m] = time.split(":").map(Number);
  const hm = dur.match(/(\d+)ч/);
  const mm = dur.match(/(\d+)м/);
  const dh = hm ? +hm[1] : 0;
  const dm = mm ? +mm[1] : 0;
  let nh = h + dh, nm = m + dm;
  nh += Math.floor(nm / 60); nm %= 60; nh %= 24;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
}

// ── Per-event color / icon / label (shared by desktop + mobile renderers) ──────
function _evMeta(e) {
  if (e.type === "flight" || e.type === "transfer") {
    const tm = transferKind(e.kind);
    return { c: "var(--ev-transfer)", soft: "var(--ev-transfer-soft)", icon: tm.icon, labelKey: tm.labelKey };
  }
  const MAP = {
    "hotel-checkin":  { c: "var(--ev-hotel)",    soft: "var(--ev-hotel-soft)",    icon: "bed",     labelKey: "tse.checkin" },
    "hotel-checkout": { c: "var(--ev-hotel)",    soft: "var(--ev-hotel-soft)",    icon: "bed",     labelKey: "tse.checkout" },
    "hotel-deadline": { c: "var(--ev-deadline)", soft: "var(--ev-deadline-soft)", icon: "warning", labelKey: "tl.deadline" },
    "car-pickup":     { c: "var(--ev-car)",      soft: "var(--ev-car-soft)",      icon: "car",     labelKey: "car.pickup_event" },
    "car-return":     { c: "var(--ev-car)",      soft: "var(--ev-car-soft)",      icon: "car",     labelKey: "car.dropoff_event" },
    "activity": {
      c: "var(--ev-activity)", soft: "var(--ev-activity-soft)",
      icon: "ticket",
      labelKey: e.category === "food" ? "tl.cat_food" : e.category === "sight" ? "tl.cat_sight" : "event.type_activity",
    },
  };
  return MAP[e.type] || { c: "var(--ink)", soft: "var(--wash)", icon: "ticket", labelKey: "" };
}

// Event-type → значения общего канала тинта --hl-soft / --hl-ink (04 PR3).
// Своих имён (--evs / --evi) у плитки ленты больше нет: канал один на всё
// приложение, а вызыватель подставляет в него ЗНАЧЕНИЕ — вот это.
const _EV_TOK = {
  hotel:    { s: "var(--ev-hotel-soft)",    i: "var(--ev-hotel-ink)" },
  transfer: { s: "var(--ev-transfer-soft)", i: "var(--ev-transfer-ink)" },
  activity: { s: "var(--ev-activity-soft)", i: "var(--ev-activity-ink)" },
  car:      { s: "var(--ev-car-soft)",      i: "var(--ev-car-ink)" },
  deadline: { s: "var(--ev-deadline-soft)", i: "var(--ev-deadline-ink)" },
};
// Единственный классификатор «тип события потока → семейство». Словарь типов задаёт
// buildEventStream (TripView): flight/transfer, hotel-checkin/-checkout/-deadline,
// car-pickup/-return, activity. Семейство совпадает с суффиксом токенов --ev-*
// и с CSS-классом .ev-* — на нём же держится раскраска чипов календаря.
export function eventFamily(type) {
  if (type === "flight" || type === "transfer") return "transfer";
  if (type === "hotel-checkin" || type === "hotel-checkout") return "hotel";
  if (type === "hotel-deadline") return "deadline";
  if (type === "car-pickup" || type === "car-return") return "car";
  return "activity";
}
function _evTok(e) {
  return _EV_TOK[eventFamily(e.type)];
}

// Timeline event plate — Lumo "Таймлайн поездки" (.tl3-ev): time on the left
// (mono), .tl3-card with a coloured .tile + title/sub. Transfers render as the
// column .tl3-card--tr (from → mode → to).
/** @param {{ e: any, onClick?: any }} p */
export function StreamEventRow({ e, onClick }) {
  const t = useT();

  const meta = _evMeta(e);
  const price = e.price != null ? fmt(e.price, e.cur) : null;

  if (e.type === "flight" || e.type === "transfer") {
    // Prefer the explicit end time from the data model (e.endTime is derived
    // from end_datetime in buildEventStream). _addDuration only parses Cyrillic
    // "Nч/Nм" duration strings, so on en/es locales (or a missing duration) it
    // added zero and the arrival time collapsed to the departure time.
    const arrive = e.endTime || e.arrive_time || _addDuration(e.time, e.duration) || "—";
    const small = [e.carrier, e.duration].filter(Boolean).join(" · ");
    return (
      <div className="tl3-ev tl3-ev--tr">
        <div className="time time--tr"><span>{e.time || "—"}</span><span>{arrive}</span></div>
        <button className="tl3-card tl3-card--tr" onClick={onClick}>
          <div className="rv-end">
            <b>{e.from || "—"}</b>
            {e.from_address && e.from_address !== e.from && <span>{e.from_address}</span>}
          </div>
          <div className="rv-conn">
            <span className="dline" />
            <span className="rv-mode">
              <span className="ic"><Icon name={meta.icon} size={16} /></span>
              {t(meta.labelKey)}{small && <small> · {small}</small>}
            </span>
            <span className="dline" />
          </div>
          <div className="rv-end">
            {e.to_address && e.to_address !== e.to && <span>{e.to_address}</span>}
            <b>{e.to || "—"}</b>
          </div>
        </button>
      </div>
    );
  }

  const tok = _evTok(e);
  const sub = [t(meta.labelKey), e.duration, e.address].filter(Boolean).join(" · ");
  return (
    <div className="tl3-ev">
      <div className="time">{e.time && e.time !== "?" ? e.time : "—"}</div>
      <button className="tl3-card" style={{ "--hl-soft": tok.s, "--hl-ink": tok.i }} onClick={onClick}>
        <span className="tile"><Icon name={meta.icon} size={20} /></span>
        <div className="body">
          <b>{e.title}</b>
          {sub && <div className="sb">{sub}</div>}
        </div>
        {(price || e.platformUrl) && (
          <span className="meta row row--g4">
            {price && <span>{price}</span>}
            {e.platformUrl && <PartnerPill url={e.platformUrl} />}
          </span>
        )}
      </button>
    </div>
  );
}


