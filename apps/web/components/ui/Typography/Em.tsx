import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const emVariants = cva("italic", {
  variants: {
    variant: {
      default: "",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

type EmElement = React.ElementRef<"em">;
export interface EmProps
  extends React.ComponentPropsWithoutRef<"em">,
    VariantProps<typeof emVariants> {
  asChild?: boolean;
}

const Em = React.forwardRef<EmElement, EmProps>(
  ({ children, className, variant, ...props }, ref) => (
    <em className={cn(emVariants({ variant, className }))} {...props} ref={ref}>
      {children}
    </em>
  ),
);
Em.displayName = "Em";

export default Em;
