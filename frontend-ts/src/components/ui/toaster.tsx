import { useToast } from "@/hooks/use-toast";
import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@/components/ui/toast";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";
import { CheckCircle2 } from "lucide-react";

export function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastProvider duration={3000}>
      {toasts.map(function ({ id, title, description, action, duration, variant, icon, ...props }) {
        const isDestructive = variant === "destructive";
        const isSuccess = variant === "success";
        const isCompact = variant === "compact";
        const chipLabel =
          (typeof description === "string" ? description : null) ||
          (typeof title === "string" ? title : null) ||
          "Error";
        const displayIcon = isSuccess ? (icon ?? <CheckCircle2 className="h-6 w-6 text-green-600 shrink-0" aria-hidden />) : icon;

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
                {displayIcon && <span className={cn("flex shrink-0 items-center", isSuccess && "text-green-600")}>{displayIcon}</span>}
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
