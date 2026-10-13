"use client";

import { CircleHelp } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";

type LearningTipProps = {
  children: React.ReactNode;
  className?: string;
  iconClassName?: string;
  contentClassName?: string;
  asButton?: boolean;
} & (
  | {
      tooltip: React.ReactNode;
      ariaLabel: string;
    }
  | {
      tooltip?: undefined;
      ariaLabel?: never;
    }
) &
  React.ComponentPropsWithoutRef<"button"> &
  React.ComponentPropsWithoutRef<"div">;

export const LearningTip = React.forwardRef<
  HTMLButtonElement | HTMLDivElement,
  LearningTipProps
>(function LearningTip(
  {
    children,
    tooltip,
    ariaLabel,
    className,
    iconClassName,
    contentClassName,
    asButton,
    ...props
  },
  ref,
) {
  const icon = (
    <CircleHelp
      aria-hidden="true"
      className={cn("size-4 shrink-0", iconClassName)}
    />
  );

  if (tooltip) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              ref={ref as React.Ref<HTMLButtonElement>}
              type="button"
              aria-label={ariaLabel}
              {...(props as React.ComponentPropsWithoutRef<"button">)}
              className={cn(
                "text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex min-h-6 items-center gap-1.5 rounded-sm text-left text-xs leading-snug transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
                className,
              )}
            >
              {icon}
              <span>{children}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent className={cn("max-w-70", contentClassName)}>
            {tooltip}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (asButton) {
    return (
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        type="button"
        {...(props as React.ComponentPropsWithoutRef<"button">)}
        className={cn(
          "text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1.5 rounded-sm text-xs leading-snug transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
          className,
        )}
      >
        <span className="text-muted-foreground inline-flex shrink-0 items-center">
          {icon}
        </span>
        <span>{children}</span>
      </button>
    );
  }

  return (
    <div
      ref={ref as React.Ref<HTMLDivElement>}
      {...(props as React.ComponentPropsWithoutRef<"div">)}
      className={cn(
        "text-muted-foreground inline-flex min-w-0 items-start gap-1 text-xs leading-snug",
        className,
      )}
    >
      <span className="text-muted-foreground mt-0.5 shrink-0">{icon}</span>
      <span>{children}</span>
    </div>
  );
});
