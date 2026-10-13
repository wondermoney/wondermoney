import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      // A 16px box is under the 44px touch floor, so on coarse pointers the hit
      // area is widened with a positioned pseudo-element rather than by growing
      // the box — the control keeps its size and the layout around it is
      // untouched. Gated to `pointer-coarse` on purpose: a 44px invisible
      // target is right for a thumb and wrong for a mouse, where it would
      // silently swallow clicks meant for whatever sits 14px away.
      //
      // `indeterminate` is styled alongside `checked`: Radix renders the same
      // indicator for both, and leaving indeterminate unfilled made a
      // partially-selected group look empty.
      "peer border-input ring-offset-background focus-visible:ring-ring data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground hover:border-ring aria-[invalid=true]:border-destructive-text disabled:hover:border-input relative h-4 w-4 shrink-0 rounded-sm border transition-[background-color,border-color,transform] duration-[var(--duration-micro)] ease-out focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden active:scale-90 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100 pointer-coarse:after:absolute pointer-coarse:after:-inset-3.5 pointer-coarse:after:content-['']",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      className={cn("flex items-center justify-center text-current")}
    >
      <Check className="size-4" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
