import * as React from "react";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold transition-colors focus:outline-none",
  {
    variants: {
      variant: {
        default: "bg-sidebar text-sidebar-ink",
        positive: "bg-emerald-100 text-emerald-700",
        negative: "bg-rose-100 text-rose-700",
        blue: "bg-accent-blue/15 text-accent-blue",
        outline: "border border-border-soft text-ink",
        muted: "bg-surface-muted text-ink-muted",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
