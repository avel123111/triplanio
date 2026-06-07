import { useToast } from "@/components/ui/use-toast";
import {
  Toast,
  ToastBody,
  ToastClose,
  ToastProvider,
  ToastViewport,
} from "@/components/ui/toast";

// Hide toasts whose `open` flag has been flipped to false by the reducer.
// Our Toast primitive is a plain <div> (not Radix' Toast.Root), so the
// `open=false` data attribute alone wouldn't remove the DOM - we filter
// here. The close button below dispatches DISMISS_TOAST, which flips `open`
// to false and triggers a re-render via the toast store listener.
export function Toaster() {
  const { toasts, dismiss } = useToast();

  return (
    <ToastProvider>
      {toasts
        // eslint-disable-next-line no-unused-vars
        .filter((tt) => tt.open !== false)
        .map(function ({ id, title, description, action, open: _open, onOpenChange: _onOpenChange, ...props }) {
          return (
            <Toast key={id} {...props}>
              <ToastBody title={title} description={description} />
              {action}
              <ToastClose onClick={() => dismiss(id)} />
            </Toast>
          );
        })}
      <ToastViewport />
    </ToastProvider>
  );
}
