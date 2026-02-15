import { useToast } from "@/hooks/use-toast";
import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@/components/ui/toast";
import { StatusChip } from "@/components/ui/status-chip";

export function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastProvider duration={3000}>
      {toasts.map(function ({ id, title, description, action, duration, variant, ...props }) {
        const isDestructive = variant === "destructive";
        const chipLabel =
          (typeof description === "string" ? description : null) ||
          (typeof title === "string" ? title : null) ||
          "Error";

        return (
          <Toast key={id} duration={duration || 3000} variant={variant} {...props}>
            {isDestructive ? (
              <>
                <StatusChip variant="error" label={chipLabel} className="border-0 shadow-none" />
                {action}
                <ToastClose />
              </>
            ) : (
              <>
                <div className="grid gap-0.5">
                  {title && <ToastTitle>{title}</ToastTitle>}
                  {description && <ToastDescription>{description}</ToastDescription>}
                </div>
                {action}
                <ToastClose />
              </>
            )}
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
