import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  // `focus:` -> `focus-visible:`, matching every other primitive. A badge is
  // only focusable when a call site wraps it in a link or button, and in that
  // case a mouse click should not leave a keyboard ring behind.
  "inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-semibold transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  {
    variants: {
      // Fills are solid, not washed (e.g. /80): the -foreground tokens are
      // contrast-tested against the *solid* fill, and a wash quietly costs every
      // badge some contrast (destructive at /80 measures 3.81:1 light). Each
      // pair is verified:
      // primary 6.76/6.12 · destructive 4.85/9.21 · warning 5.54/8.58 ·
      // info 4.77/6.22 · success 6.36/8.35 · secondary 16.40/14.51 ·
      // muted 4.85/5.83 (light/dark).
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-input bg-secondary text-secondary-foreground",
        success: "border-transparent bg-success text-success-foreground",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground",
        warning: "border-transparent bg-warning text-warning-foreground",
        info: "border-transparent bg-info text-info-foreground",
        muted: "border-border bg-muted text-muted-foreground",
        outline: "border-border text-foreground",
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
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
