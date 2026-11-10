import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * A ruled block: a heavy rule above the head instead of a card around the
 * content, so the page reads as one statement rather than a wall of boxes.
 */
export function Section({
  id,
  title,
  aside,
  children,
  className,
  busy = false,
}: {
  id: string;
  /** True while the section's data loads, so assistive tech waits for it. */
  busy?: boolean;
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={id}
      aria-busy={busy || undefined}
      className={cn("border-foreground min-w-0 border-t-2 pt-4", className)}
    >
      <div className="mb-6 flex items-baseline justify-between gap-4">
        <h2
          id={id}
          className="text-foreground text-lg font-semibold tracking-tight"
        >
          {title}
        </h2>
        {aside ? (
          <div className="text-muted-foreground shrink-0 text-sm">{aside}</div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** What belongs in a section, and the one action that fills it. */
export function SectionEmpty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="border-border flex flex-col items-start gap-2 border-b pb-6">
      <p className="text-foreground text-base font-medium">{title}</p>
      <p className="text-muted-foreground max-w-prose text-sm">{body}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** Rows of skeleton in the shape of a ruled list. */
export function RowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="border-border flex items-center justify-between gap-4 border-b py-3"
        >
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  );
}
