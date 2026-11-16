import { forwardRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { Button, type ButtonProps } from "./button";

interface ToolbarActionProps extends Omit<ButtonProps, "children"> {
  label: string;
  icon: ReactNode;
  mobileLabel?: string;
}

/** Page actions share the heading row on phones; their tap targets stay 44px. */
export const ToolbarAction = forwardRef<HTMLButtonElement, ToolbarActionProps>(
  ({ label, icon, mobileLabel, className, variant, ...props }, ref) => (
    <Button
      ref={ref}
      variant={variant}
      aria-label={label}
      title={label}
      className={cn(
        "shrink-0 max-sm:h-11",
        !mobileLabel && "max-sm:w-11 max-sm:px-0",
        variant === "outline" &&
          "max-sm:text-foreground max-sm:hover:bg-accent max-sm:border-transparent max-sm:bg-transparent",
        className,
      )}
      {...props}
    >
      {icon}
      <span className={mobileLabel ? "hidden sm:inline" : "max-sm:sr-only"}>
        {label}
      </span>
      {mobileLabel ? <span className="sm:hidden">{mobileLabel}</span> : null}
    </Button>
  ),
);
ToolbarAction.displayName = "ToolbarAction";
