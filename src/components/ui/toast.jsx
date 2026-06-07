import * as React from "react";
import { Check, AlertCircle, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

// Positioning container (top on mobile, bottom-right on desktop). Toasts stack
// with a small gap. The card visuals live in `.toast` (Lumo) in app.css.
const ToastProvider = React.forwardRef(({ ...props }, ref) => (
  <div
    ref={ref}
    className="fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse gap-2 p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[400px]"
    {...props}
  />
));
ToastProvider.displayName = "ToastProvider";

const ToastViewport = React.forwardRef(({ ...props }, ref) => (
  <div ref={ref} className="hidden" {...props} />
));
ToastViewport.displayName = "ToastViewport";

// Maps the toast `variant` to a Lumo type class + leading icon.
// `destructive` is kept as an alias of `error` for the existing call sites.
const TOAST_TYPE = {
  default: { cls: "toast--neutral", Icon: Info },
  neutral: { cls: "toast--neutral", Icon: Info },
  success: { cls: "toast--success", Icon: Check },
  error: { cls: "toast--error", Icon: AlertCircle },
  destructive: { cls: "toast--error", Icon: AlertCircle },
  warning: { cls: "toast--warning", Icon: AlertTriangle },
  info: { cls: "toast--info", Icon: Info },
};

const Toast = React.forwardRef(({ className, variant = "default", children, ...props }, ref) => {
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

const ToastClose = React.forwardRef(({ className, ...props }, ref) => (
  <button ref={ref} className={cn("x", className)} toast-close="" {...props}>
    <X />
  </button>
));
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
