import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-all duration-150 ease-in-out active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/50 disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "rounded-full bg-sidebar text-sidebar-ink hover:bg-sidebar-hover hover:shadow-lg hover:shadow-black/10",
        outline:
          "rounded-full border border-border-soft bg-transparent text-ink hover:bg-surface-muted",
        ghost: "rounded-full text-ink hover:bg-surface-muted",
        destructive:
          "rounded-full bg-red-500 text-white hover:bg-red-600 hover:shadow-lg hover:shadow-red-500/20",
      },
      size: {
        sm: "h-8 px-4 text-sm",
        default: "h-10 px-5 text-sm",
        lg: "h-12 px-6 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
