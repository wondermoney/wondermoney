import * as React from "react";

import { cn } from "@/lib/utils";

interface ReportCardProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "title"
> {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  headerActions?: React.ReactNode;
  footer?: React.ReactNode;
}

/**
 * One report as a ruled section of the page (Direction A): a heavy rule
 * above its heading instead of a card around it. Each report is a labelled
 * region with a real `h2`.
 */
export function ReportCard({
  title,
  subtitle,
  headerActions,
  footer,
  children,
  className,
  ...props
}: ReportCardProps) {
  const titleId = React.useId();

  return (
    <section
      role="region"
      aria-labelledby={titleId}
      className={cn(
        "border-foreground flex min-w-0 flex-col border-t-2 pt-4",
        className,
      )}
      {...props}
    >
      {/* `flex-wrap` + a basis on the title: the actions are `shrink-0`, so
          without a wrap the title column is whatever width is left over. The
          actions drop to their own line instead of starving the title. */}
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-1 sm:basis-56">
          <h2
            id={titleId}
            className="text-foreground text-lg leading-tight font-semibold tracking-tight"
          >
            {title}
          </h2>
          {subtitle ? (
            <p className="text-muted-foreground text-sm">{subtitle}</p>
          ) : null}
        </div>
        {headerActions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {headerActions}
          </div>
        ) : null}
      </div>
      <div className="flex-1">{children}</div>
      {footer ? <div className="pt-4">{footer}</div> : null}
    </section>
  );
}
