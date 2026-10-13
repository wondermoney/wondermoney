import * as React from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
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
  return (
    <Card className={cn("flex flex-col", className)} {...props}>
      {/* `flex-wrap` + a basis on the title: the actions are `shrink-0`, so
          without a wrap the title column is whatever width is left over. On
          Spending by category — "Export CSV" plus a total and a delta — that
          left the heading about 60px wide, wrapping one word per line and
          colliding with the button. Now the actions drop to their own line
          instead of starving the title. */}
      <CardHeader className="flex flex-col gap-4 pb-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
          <CardTitle className="text-base font-medium">{title}</CardTitle>
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
