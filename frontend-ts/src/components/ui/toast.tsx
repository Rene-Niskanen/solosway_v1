import * as React from "react";
import * as ToastPrimitives from "@radix-ui/react-toast";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

const ToastProvider = ToastPrimitives.Provider;

const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Viewport
    ref={ref}
    className={cn(
      "fixed bottom-4 right-4 z-[120] flex h-fit max-h-[min(100vh-2rem,600px)] w-full flex-col gap-3 p-0 md:max-w-[360px]",
      className,
    )}
    {...props}
  />
));
ToastViewport.displayName = ToastPrimitives.Viewport.displayName;

const toastVariants = cva(
  "group pointer-events-auto relative flex items-center overflow-hidden rounded-xl transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-bottom-full data-[state=open]:duration-300 data-[state=closed]:duration-200",
  {
    variants: {
      variant: {
        default:
          "w-full justify-between gap-3 border border-neutral-200/80 bg-white p-4 pr-5 text-neutral-900 shadow-[0_4px_12px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)]",
        compact:
          "w-fit max-w-[220px] justify-between gap-2 border border-neutral-200/80 bg-white py-2 pl-3 pr-8 text-neutral-900 rounded-lg shadow-[0_4px_12px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)]",
        destructive:
          "destructive w-fit max-w-[360px] justify-between gap-3 border border-red-200/60 bg-red-50/95 p-4 pr-5 text-red-900 shadow-[0_4px_12px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)] rounded-xl",
        success:
          "w-full justify-between gap-3 border border-neutral-200/80 bg-white p-4 pl-4 pr-5 text-neutral-900 shadow-[0_4px_12px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] border-l-4 border-l-emerald-500",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root> & VariantProps<typeof toastVariants>
>(({ className, variant, ...props }, ref) => {
  return <ToastPrimitives.Root ref={ref} className={cn(toastVariants({ variant }), className)} {...props} />;
});
Toast.displayName = ToastPrimitives.Root.displayName;

const ToastAction = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Action>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Action
    ref={ref}
    className={cn(
      "inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium ring-offset-background transition-colors group-[.destructive]:border-muted/40 hover:bg-secondary group-[.destructive]:hover:border-destructive/30 group-[.destructive]:hover:bg-destructive group-[.destructive]:hover:text-destructive-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 group-[.destructive]:focus:ring-destructive disabled:pointer-events-none disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
ToastAction.displayName = ToastPrimitives.Action.displayName;

const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Close
    ref={ref}
    className={cn(
      "absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-neutral-400 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-neutral-100 hover:text-neutral-700 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-neutral-200 focus:ring-offset-1 group-[.destructive]:text-red-600 group-[.destructive]:hover:bg-red-100 group-[.destructive]:hover:text-red-800 group-[.destructive]:focus:ring-red-200",
      className,
    )}
    toast-close=""
    {...props}
  >
    <X className="h-4 w-4" />
  </ToastPrimitives.Close>
));
ToastClose.displayName = ToastPrimitives.Close.displayName;

const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Title ref={ref} className={cn("text-[15px] font-medium tracking-[-0.01em] text-neutral-900", className)} {...props} />
));
ToastTitle.displayName = ToastPrimitives.Title.displayName;

const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Description ref={ref} className={cn("text-[13px] leading-[1.4] text-neutral-500", className)} {...props} />
));
ToastDescription.displayName = ToastPrimitives.Description.displayName;

type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>;

type ToastActionElement = React.ReactElement<typeof ToastAction>;

export {
  type ToastProps,
  type ToastActionElement,
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
};
