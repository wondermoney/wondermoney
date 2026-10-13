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

export type ChartCardProps = React.ComponentPropsWithoutRef<typeof Card> & {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  contentClassName?: string;
};

export const ChartCard = React.forwardRef<HTMLDivElement, ChartCardProps>(
  function ChartCard(
    {
      title,
      description,
      actions,
      footer,
      children,
      className,
      contentClassName,
      ...cardProps
    },
    ref,
  ) {
    return (
      <Card ref={ref} className={cn(className)} {...cardProps}>
        {(title || description || actions) && (
          <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
            <div className="space-y-1.5">
              {title ? <CardTitle>{title}</CardTitle> : null}
              {description ? (
                <CardDescription>{description}</CardDescription>
              ) : null}
            </div>
            {actions ? (
              <div className="flex shrink-0 items-center gap-2">{actions}</div>
            ) : null}
          </CardHeader>
        )}
        <CardContent className={cn("pt-4", contentClassName)}>
          {children}
        </CardContent>
        {footer ? <CardFooter>{footer}</CardFooter> : null}
      </Card>
    );
  },
);

ChartCard.displayName = "ChartCard";
