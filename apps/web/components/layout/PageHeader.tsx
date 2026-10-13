import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type PageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  /** Provenance / freshness — § 9 rule 6. Not prose; see the render comment. */
  provenance?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({
  title,
  description,
  provenance,
  badge,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-foreground text-xl font-semibold tracking-tight">
            {title}
          </h1>
          {badge}
        </div>
        {description ? (
          <p className="text-muted-foreground max-w-2xl text-sm leading-6">
            {description}
          </p>
        ) : null}
        {/* Deliberately a separate slot from `description`.
            § 9 rule 3 wants a declarative header — the title and nothing else,
            no supporting sentence. § 9 rule 6 wants the page to say how fresh
            its data is. Those pull in opposite directions only if provenance is
            treated as prose, so it gets its own line: small, muted, factual. */}
        {provenance ? <div className="text-xs">{provenance}</div> : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          {actions}
        </div>
      ) : null}
    </header>
  );
}
