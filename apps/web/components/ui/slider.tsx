import * as SliderPrimitive from "@radix-ui/react-slider";
import * as React from "react";

import { cn } from "@/lib/utils";

import { Heading, Text } from "./Typography";

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <div className={cn("flex flex-col gap-8", className)}>
    {props.value !== null ? (
      <Heading variant="h4" className="text-center">
        {props.value}
      </Heading>
    ) : (
      <Text>Slide to choose</Text>
    )}
    <div className="flex flex-col gap-2">
      <SliderPrimitive.Root
        ref={ref}
        className="relative flex size-full touch-none items-center select-none"
        {...props}
      >
        {/* Alpha tint rather than a surface token: this control renders on both
            bg-background and bg-muted, and --secondary/--border are identical to
            one of those in one theme each, which would make the track vanish. */}
        <SliderPrimitive.Track className="bg-muted-foreground/30 relative h-2 w-full grow overflow-hidden rounded-full">
          <SliderPrimitive.Range className="bg-primary absolute h-full" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb className="border-primary bg-background ring-offset-background focus-visible:ring-ring block size-5 rounded-full border-2 transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50" />
      </SliderPrimitive.Root>
      <div className="flex w-full items-center justify-between px-1">
        <Text variant="mutedText">{props.min}</Text>
        <Text variant="mutedText">{props.max}</Text>
      </div>
    </div>
  </div>
));
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
