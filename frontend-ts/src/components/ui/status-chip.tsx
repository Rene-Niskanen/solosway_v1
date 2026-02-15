import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { AlertCircle, CheckCircle2, AlertTriangle, Info, X } from "lucide-react";

import { cn } from "@/lib/utils";

const statusChipVariants = cva(
  "inline-flex w-fit max-w-[280px] items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium",
  {
    variants: {
      variant: {
        error: "bg-red-50 text-red-800 [&_svg]:text-red-800",
        success: "bg-green-50 text-green-800 [&_svg]:text-green-800",
        warning: "bg-amber-50 text-amber-800 [&_svg]:text-amber-800",
        info: "bg-sky-50 text-sky-800 [&_svg]:text-sky-800",
      },
    },
    defaultVariants: {
      variant: "error",
    },
  }
);

const variantIcons = {
  error: AlertCircle,
  success: CheckCircle2,
  warning: AlertTriangle,
  info: Info,
};

export interface StatusChipProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof statusChipVariants> {
  label: string;
  onDismiss?: () => void;
}

const StatusChip = React.forwardRef<HTMLDivElement, StatusChipProps>(
  ({ className, variant = "error", label, onDismiss, ...props }, ref) => {
    const Icon = variantIcons[variant ?? "error"];

    return (
      <div
        ref={ref}
        role="status"
        className={cn(statusChipVariants({ variant }), className)}
        {...props}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{label}</span>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="ml-1 -mr-1 shrink-0 rounded p-0.5 opacity-70 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-transparent"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  }
);
StatusChip.displayName = "StatusChip";

export { StatusChip, statusChipVariants };
