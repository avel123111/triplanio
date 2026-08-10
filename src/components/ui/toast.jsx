// @ts-check
import * as React from "react";
import { Check, AlertCircle, AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconBtn } from "@/design/IconBtn";
import { useT } from "@/lib/i18n/I18nContext";

// Positioning container. Layout/position live in `.toast-host` (app.css):
// desktop = bottom-right; mobile = top, clear of the sticky app header + safe-area.
// Card visuals live in `.toast` (Lumo) in app.css.
const ToastProvider = React.forwardRef(({ ...props }, ref) => (
  <div ref={ref} className="toast-host" {...props} />
));
ToastProvider.displayName = "ToastProvider";

const ToastViewport = React.forwardRef(({ ...props }, ref) => (
  <div ref={ref} style={{ display: "none" }} {...props} />
));
ToastViewport.displayName = "ToastViewport";

// Maps the toast `variant` to a Lumo type class + leading icon.
// `destructive` is kept as an alias of `error` for the existing call sites.
// `default`/`neutral` carry NO class on purpose: the grey icon chip is what the
// base `.toast .tic` already paints, so "neutral" is the ABSENCE of a tone. The
// axis is declared in src/design/catalog.json (toast → «тон», дефолт neutral)
// and guard 2q keeps the two in step. Until TRIP-364 these two keys emitted
// `toast--neutral`, a class with no rule anywhere in the repo: it reached the
// DOM, did nothing, and read like a special case.
const TOAST_TYPE = {
  default: { Icon: Info },
  neutral: { Icon: Info },
  success: { cls: "toast--success", Icon: Check },
  error: { cls: "toast--error", Icon: AlertCircle },
  destructive: { cls: "toast--error", Icon: AlertCircle },
  warning: { cls: "toast--warning", Icon: AlertTriangle },
  info: { cls: "toast--info", Icon: Info },
};

const Toast = React.forwardRef(
  /** @param {React.ComponentPropsWithoutRef<'div'> & { variant?: string }} p */
  ({ className, variant = "default", children, ...props }, ref) => {
  const meta = TOAST_TYPE[variant] || TOAST_TYPE.default;
  const Ic = meta.Icon;
  return (
    <div ref={ref} className={cn("toast", meta.cls, className)} {...props}>
      <span className="tic"><Ic strokeWidth={2.4} /></span>
      {children}
    </div>
  );
});
Toast.displayName = "Toast";

// Body wrapper: bold title line + muted subtitle line.
// Single-line toast (description only) renders the text as the bold primary line.
const ToastBody = ({ title, description }) => {
  if (!title) return <div className="toast__body"><b>{description}</b></div>;
  return (
    <div className="toast__body">
      <b>{title}</b>
      {description ? <span>{description}</span> : null}
    </div>
  );
};

// ★TRIP-344: крестик - тот же объект, что крестик любого диалога, и рисуется
// теперь тем же примитивом. Размер задавался ПАДДИНГОМ, а не сторонами, поэтому
// он единственный не попадал ни в одну ступень; `sm` даёт ему честные 32×32.
// ⚠️ Импорт НАПРЯМУЮ из модуля, а не из барреля `@/design`: баррель реэкспортит
// этот самый файл через `ui/toaster`, и путь через него замкнул бы кольцо.
// `aria-label` тут ПОЯВЛЯЕТСЯ: до пересадки кнопка была только иконкой и для
// скринридера оставалась безымянной.
const ToastClose = React.forwardRef(
  /** @param {React.ComponentPropsWithoutRef<'button'>} p */
  ({ className, ...props }, ref) => {
  const t = useT();
  return (
    <IconBtn
      ref={ref}
      icon="close"
      size="sm"
      ariaLabel={t('common.close')}
      className={cn("x", className)}
      toast-close=""
      {...props}
    />
  );
});
ToastClose.displayName = "ToastClose";

// Kept for backward-compat with any external imports.
const ToastTitle = ({ children }) => <b>{children}</b>;
const ToastDescription = ({ children }) => <span>{children}</span>;
const ToastAction = ({ children }) => children;

export {
  ToastProvider,
  ToastViewport,
  Toast,
  ToastBody,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
};
