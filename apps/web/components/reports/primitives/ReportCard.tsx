import * as React from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
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

export function ReportCard({
  title,
  subtitle,
  headerActions,
  footer,
  children,
  className,
  ...props
}: ReportCardProps) {
  // Each report is a section of the page, so its title is a real `h2` and the
  // card is a labelled region. `CardTitle` stays a `<div>` app-wide on purpose
  // (see its doc comment); reports are the call site where the answer is yes.
  const titleId = React.useId();

  return (
    <Card
      role="region"
      aria-labelledby={titleId}
      className={cn("flex flex-col", className)}
      {...props}
    >
      {/* `flex-wrap` + a basis on the title: the actions are `shrink-0`, so
          without a wrap the title column is whatever width is left over. On
          Spending by category — "Export CSV" plus a total and a delta — that
          left the heading about 60px wide, wrapping one word per line and
          colliding with the button. Now the actions drop to their own line
          instead of starving the title. */}
      <CardHeader className="flex flex-col gap-4 pb-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        {/* The basis only applies in the row layout: in the phone's column
            layout a flex-basis is a height, and `basis-56` left 224px of
            empty space under every report title. */}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:basis-56">
          <h2
            id={titleId}
            className="text-base leading-none font-medium tracking-tight"
          >
            {title}
          </h2>
          {subtitle ? (
            <CardDescription className="text-xs">{subtitle}</CardDescription>
          ) : null}
        </div>
        {headerActions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {headerActions}
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="flex-1">{children}</CardContent>
      {footer ? <CardFooter className="pt-0">{footer}</CardFooter> : null}
    </Card>
  );
}
