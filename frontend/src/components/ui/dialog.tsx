import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { THIN_SCROLLBAR_CLASS } from "@/components/ui/data-cell";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      // z-[100]: decisively above every in-page fixed element (toasts, queue
      // pill, selection tray) so nothing bleeds over an open modal.
      // bg-black, not bg-ink: ink flips to near-white in dark mode, which
      // would turn the scrim into a light haze. A black scrim works in both.
      "fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /** Skip the built-in top-right ×; the caller renders its own DialogClose
        (needed by p-0 layouts where the default position collides with content). */
    hideClose?: boolean;
  }
>(({ className, children, onEscapeKeyDown, onInteractOutside, hideClose = false, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      // Floating panels (e.g. the datetime picker) portal to <body>, outside
      // this content's DOM: without these guards, clicking one would close
      // the dialog and Escape aimed at the panel would dismiss both layers.
      onEscapeKeyDown={(event) => {
        if (document.querySelector("[data-floating-panel]")) event.preventDefault();
        onEscapeKeyDown?.(event);
      }}
      onInteractOutside={(event) => {
        const target = event.target as Element | null;
        if (target?.closest?.("[data-floating-panel]")) event.preventDefault();
        onInteractOutside?.(event);
      }}
      className={cn(
        // max-h + overflow: content taller than the viewport scrolls inside
        // the dialog instead of clipping past the top of the screen.
        // Sizing contract: the base is w-fit so content-driven dialogs grow with
        // their children up to the viewport clamp (pass only a max-w-* cap).
        // Form/confirm dialogs must pass `w-full max-w-*` or they shrink to
        // their inputs' intrinsic width. grid-cols-[minmax(0,1fr)] +
        // overflow-x-hidden let wide children truncate/wrap instead of forcing
        // a horizontal scrollbar (overflow-y:auto alone would compute
        // overflow-x to auto per the CSS spec).
        "fixed left-1/2 top-1/2 z-[100] grid max-h-[calc(100dvh-3rem)] w-fit min-w-[min(32rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] grid-cols-[minmax(0,1fr)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto overflow-x-hidden rounded-card border border-border-soft bg-surface p-6 shadow-card data-[state=open]:animate-scale-in data-[state=closed]:animate-scale-out",
        THIN_SCROLLBAR_CLASS,
        className,
      )}
      {...props}
    >
      {children}
      {!hideClose && (
        <DialogPrimitive.Close className="absolute right-5 top-5 rounded-full p-1 text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/50">
          <HugeiconsIcon icon={Cancel01Icon} size={16} />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex flex-col gap-1.5 text-left", className)} {...props} />
  );
}

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}

const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight text-ink", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-ink-muted", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
