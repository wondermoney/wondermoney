import * as SwitchPrimitives from "@radix-ui/react-switch";
import * as React from "react";

import { cn } from "@/lib/utils";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      // w-11 is already 44px, but h-6 is 24 — so only the vertical hit area
      // needs widening, and only where a thumb is doing the pointing.
      "peer focus-visible:ring-ring focus-visible:ring-offset-background data-[state=checked]:bg-primary data-[state=unchecked]:bg-input data-[state=checked]:hover:bg-primary/90 data-[state=unchecked]:hover:bg-input/70 aria-[invalid=true]:ring-destructive-text relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-[var(--duration-micro)] ease-out focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:ring-2 pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-2.5 pointer-coarse:after:content-['']",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        // shadow-sm, not shadow-lg: DESIGN.md §7 keeps shadows for genuinely
        // elevated surfaces, and a 20px thumb casting a dialog-sized shadow was
        // the loudest thing on a settings page.
        "bg-background pointer-events-none block h-5 w-5 rounded-full shadow-sm ring-0 transition-transform duration-[var(--duration-micro)] ease-out data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0",
      )}
    />
  </SwitchPrimitives.Root>
));
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
