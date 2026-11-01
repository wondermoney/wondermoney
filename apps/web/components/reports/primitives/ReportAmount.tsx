"use client";

import { useTranslations } from "next-intl";

import { Amount } from "@/components/ui/Amount";
import { cn } from "@/lib/utils";

interface ReportAmountProps {
  value: number;
  currencyKey?: string;
  className?: string;
}

/**
 * Money on a report surface.
 *
 * Delegates to `<Amount>`, which splits through `formatToParts` and sets the
 * symbol in muted ink. One atomic string (DESIGN.md § 9 rule 1 argues against
 * it) has no seam: in `€11,250.00` the currency token — identical on every row —
 * competes with the magnitude the eye is actually comparing. Reports keep their own component because of the
 * `currencyKey` contract below, not because they format differently.
 */
export function ReportAmount({
  value,
  currencyKey,
  className,
}: ReportAmountProps) {
  const t = useTranslations("reports.common");

  // Deliberately not an em-dash. Rule 3 makes absence `—`, but this is not an
  // absent *value* — the amount is known and its unit is not, and § 9 rule 4
  // says an aggregate that cannot be stated honestly should say what it is
  // rather than render something plausible. A bare `—` would read as "no data".
  if (!currencyKey) {
    return (
      <span className={cn("text-muted-foreground", className)}>
        {t("currencyUnknown")}
      </span>
    );
  }

  return <Amount value={value} currency={currencyKey} className={className} />;
}
