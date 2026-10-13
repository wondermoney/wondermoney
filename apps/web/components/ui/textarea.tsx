import * as React from "react";

import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    const normalizedProps = Object.prototype.hasOwnProperty.call(props, "value")
      ? props.value === undefined
        ? { ...props, value: "" }
        : props
      : props;
    return (
      <textarea
        className={cn(
          // Mirrors input.tsx exactly — same border, same hover, same ring,
          // same aria-invalid treatment. A textarea that signals validity
          // differently from the input beside it is a bug users read as
          // "one of these is broken".
          "border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring hover:border-ring/40 aria-[invalid=true]:border-destructive-text aria-[invalid=true]:focus-visible:ring-destructive-text disabled:hover:border-input flex min-h-[80px] w-full rounded-md border px-3 py-2 text-sm transition-[border-color] duration-[var(--duration-micro)] ease-out focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        {...normalizedProps}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
