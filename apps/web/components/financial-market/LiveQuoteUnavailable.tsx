"use client";

import { useTranslations } from "next-intl";

import { Text } from "@/components/ui/Typography";
import { cn } from "@/lib/utils";

/**
 * The live quote (`price`, `changePercentage`) is not part of the market-data
 * source this product runs on, so those two fields arrive as `null`
 * permanently rather than transiently. Ticker
 * search, price history and the company profile are unaffected and must not
 * inherit any of this treatment.
 *
 * A permanent limitation is not an outage, so this state deliberately has no
 * spinner, no retry affordance, no `role="alert"` and no semantic colour — it
 * is ordinary page content in the quiet register (DESIGN.md §5 "Two semantic
 * registers"), read rather than announced.
 *
 * Provider-neutral on purpose: nothing here is named after a vendor, so a
 * change of market-data provider does not touch it.
 */

// DESIGN.md §9 rule 3 — "Missing is `—`, never `0`, never blank."
const MISSING_VALUE_GLYPH = "—";

/**
 * The figure slot itself, where a price or a percentage would have been
 * rendered. A screen reader announces a bare em dash as nothing at all, so the
 * glyph is hidden and the slot carries the label instead. Pair it with
 * `LiveQuoteUnavailableNote` once per surface for the sighted explanation.
 */
export function LiveQuoteUnavailableValue({
  className,
}: {
  className?: string;
}) {
  const t = useTranslations();

  return (
    <span className={cn("text-muted-foreground", className)}>
      <span aria-hidden="true">{MISSING_VALUE_GLYPH}</span>
      <span className="sr-only">{t("live-quote-unavailable")}</span>
    </span>
  );
}

/**
 * The short visible label, for slots too small to carry a figure plus a
 * separate explanation — a watchlist row, for instance.
 */
export function LiveQuoteUnavailableLabel({
  className,
}: {
  className?: string;
}) {
  const t = useTranslations();

  return (
    <Text
      variant="smallText"
      className={cn("text-muted-foreground", className)}
    >
      {t("live-quote-unavailable")}
    </Text>
  );
}

/** The one-line explanation. Render once per surface, next to the empty slots. */
export function LiveQuoteUnavailableNote({
  className,
}: {
  className?: string;
}) {
  const t = useTranslations();

  return (
    <Text
      variant="smallText"
      className={cn("text-muted-foreground text-xs", className)}
    >
      {t("live-quote-unavailable-explanation")}
    </Text>
  );
}
