import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A dated sequence of events on a vertical rail.
 *
 * DESIGN.md § 9. The reference uses this shape for payout and sync histories —
 * a hairline running down the left with a node per event, so a list of things
 * that happened *reads* as a sequence rather than as rows that happen to be in
 * date order.
 *
 * The rail is drawn with a border on the item rather than an absolutely
 * positioned line, so it stops at the last node instead of trailing past it.
 */
export interface TimelineItemProps {
  /** The event. */
  title: ReactNode;
  /** When it happened. */
  timestamp?: ReactNode;
  /** A figure or badge, right-aligned. */
  trailing?: ReactNode;
  /** Extra detail under the title. */
  description?: ReactNode;
  /** Draws the node filled — for the current or most significant event. */
  emphasis?: boolean;
}

export function Timeline({
  items,
  className,
}: {
  items: (TimelineItemProps & { key: string | number })[];
  className?: string;
}) {
  return (
    <ol className={cn("flex flex-col", className)}>
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <li
            key={item.key}
            className={cn(
              "relative flex gap-3 pb-4 pl-0 last:pb-0",
              // The rail: a left border on every item but the last, so the
              // line connects nodes and stops rather than dangling.
              !isLast &&
                "before:bg-border before:absolute before:top-4 before:bottom-0 before:left-[3.5px] before:w-px before:content-['']",
            )}
          >
            <span
              className={cn(
                "relative z-10 mt-1.5 size-2 shrink-0 rounded-full",
                item.emphasis ? "bg-primary" : "bg-border",
              )}
              aria-hidden="true"
            />
            <div className="flex min-w-0 flex-1 items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-foreground text-sm font-medium">
                  {item.title}
                </p>
                {item.description ? (
                  <p className="text-muted-foreground text-xs">
                    {item.description}
                  </p>
                ) : null}
                {item.timestamp ? (
                  <p className="text-muted-foreground text-xs">
                    {item.timestamp}
                  </p>
                ) : null}
              </div>
              {item.trailing ? (
                <div className="shrink-0">{item.trailing}</div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export default Timeline;
