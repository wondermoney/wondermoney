"use client";

import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

import { Amount } from "@/components/ui/Amount";
import { Button } from "@/components/ui/button";
import { Link } from "@/components/ui/Link";
import { cn } from "@/lib/utils";

/**
 * The header for a single object — an account, a goal, a budget, a payout.
 *
 * DESIGN.md § 9. The reference gives an object one header that carries
 * everything you need to identify it: where you came from, what it is, its
 * status, its key figure, and what you can do to it. `Payouts >` then
 * `$41.60 USD [Paid]`.
 *
 * This app instead titled a detail page with a name, then repeated the number
 * *below* in a separate card labelled "Account balance" — so the figure a
 * person opened the page to see was the third thing on it, in a box of its
 * own. Merging the two removes a card and puts the number where the eye
 * already is.
 *
 * The name stays the title rather than the value taking its place. Stripe's
 * payout has no name, so its amount is its identity; an account you navigated
 * to by clicking "Poupança" does have one, and replacing it with a figure
 * would lose the thing that told you that you are in the right place.
 */
export interface ObjectHeaderProps {
  /** Where this object lives. Renders a back link named after the destination. */
  backHref?: string;
  backLabel?: string;
  title: ReactNode;
  /** Institution, description — the line under the title. */
  subtitle?: ReactNode;
  /** Status chips, shown inline with the title. */
  badges?: ReactNode;
  /** The object's key figure. `null` renders an em-dash. */
  value?: number | null;
  currency?: string;
  /** Names the figure, e.g. "Account balance". */
  valueLabel?: string;
  /** A second figure in another currency, muted beside the first. */
  secondaryValue?: number | null;
  secondaryCurrency?: string;
  /** Right-hand actions. */
  actions?: ReactNode;
  /** As-of line — pass a <DataProvenance />. */
  provenance?: ReactNode;
  /** Extra content inside the same card — supporting figures, a progress bar. */
  children?: ReactNode;
  className?: string;
}

export function ObjectHeader({
  backHref,
  backLabel,
  title,
  subtitle,
  badges,
  value,
  currency,
  valueLabel,
  secondaryValue,
  secondaryCurrency,
  actions,
  provenance,
  children,
  className,
}: ObjectHeaderProps) {
  const hasValue = value !== undefined;

  return (
    <div
      className={cn(
        "border-border bg-card flex flex-col gap-4 rounded-lg border p-4",
        className,
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          {backHref && backLabel ? (
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground -ml-2"
            >
              <Link href={backHref}>
                <ArrowLeft className="mr-2 size-4" aria-hidden="true" />
                {backLabel}
              </Link>
            </Button>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-foreground text-xl font-semibold tracking-tight">
              {title}
            </h1>
            {badges}
          </div>

          {subtitle ? (
            <p className="text-muted-foreground text-sm">{subtitle}</p>
          ) : null}
        </div>

        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>

      {hasValue ? (
        <div>
          {valueLabel ? (
            <p className="text-muted-foreground text-sm">{valueLabel}</p>
          ) : null}
          {/* flex-wrap and a non-shrinking secondary: the same overlap that
              hit the accounts hero at 320px would hit this one. */}
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <Amount
              value={value}
              currency={currency}
              className="font-mono text-3xl font-semibold tracking-tight"
            />
            {secondaryValue !== undefined && secondaryValue !== null ? (
              <Amount
                value={secondaryValue}
                currency={secondaryCurrency}
                className="text-muted-foreground shrink-0 font-mono text-sm"
              />
            ) : null}
          </div>
          {provenance ? <div className="mt-1.5">{provenance}</div> : null}
        </div>
      ) : null}

      {children}
    </div>
  );
}

export default ObjectHeader;
