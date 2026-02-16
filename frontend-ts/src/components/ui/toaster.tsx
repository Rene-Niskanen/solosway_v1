import { useToast } from "@/hooks/use-toast";
import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@/components/ui/toast";
import { StatusChip } from "@/components/ui/status-chip";

export function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastProvider duration={3000}>
      {toasts.map(function ({ id, title, description, action, duration, variant, icon, ...props }) {
        const isDestructive = variant === "destructive";
        const isCompact = variant === "compact";
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
                {icon && <span className="flex shrink-0 items-center text-[#666]">{icon}</span>}
                <div className={isCompact ? "grid gap-0 min-w-0" : "grid gap-0.5"}>
                  {title && <ToastTitle className={isCompact ? "text-xs font-medium" : undefined}>{title}</ToastTitle>}
                  {description && <ToastDescription className={isCompact ? "text-[11px] leading-tight" : undefined}>{description}</ToastDescription>}
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
