"use client";

import { TriangleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Link } from "@/components/ui/Link";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { exchangeRateSettingsHref } from "@/lib/fx/fx-status";
import { cn } from "@/lib/utils";

export interface UnconvertedTotal {
  /** Rows left out of the total because they could not be valued. */
  count: number;
  /** The currencies with no exchange rate among them, when known. */
  currencies: string[];
}

function WarningBody({
  unconverted,
  currency,
}: {
  unconverted: UnconvertedTotal;
  currency: string;
}) {
  const t = useTranslations("fx");
  const locale = useLocale();
  const { count, currencies } = unconverted;

  return (
    <>
      {count > 0 ? (
        <span>{t("total-leaves-out", { count, currency })}</span>
      ) : null}
      {currencies.length > 0 ? (
        <>
          {count > 0 ? " " : null}
          <span>
            {t("missing-rates", {
              currencies: new Intl.ListFormat(locale, {
                style: "long",
                type: "conjunction",
              }).format(currencies),
            })}
          </span>{" "}
          <Link
            href={exchangeRateSettingsHref({ from: currencies[0] })}
            className="text-foreground underline underline-offset-4"
          >
            {t("add-rate")}
          </Link>
        </>
      ) : null}
    </>
  );
}

/**
 * Says that a total is incomplete because some rows could not be converted
 * into `currency`, naming the currencies with no exchange rate and linking to
 * where a rate can be added. Renders nothing when nothing was left out.
 *
 * `icon` sits beside a figure as a small warning that opens the explanation;
 * `note` is the explanation inline, under a section's heading.
 */
export function UnconvertedTotalWarning({
  unconverted,
  currency,
  variant = "icon",
  className,
}: {
  unconverted: UnconvertedTotal | undefined;
  currency: string;
  variant?: "icon" | "note";
  className?: string;
}) {
  const t = useTranslations("fx");
  if (
    !unconverted ||
    (unconverted.count === 0 && unconverted.currencies.length === 0)
  ) {
    return null;
  }

  if (variant === "note") {
    return (
      <p role="note" className={cn("text-muted-foreground text-sm", className)}>
        <WarningBody unconverted={unconverted} currency={currency} />
      </p>
    );
  }

  return (
    <Popover>
      <PopoverTrigger
        aria-label={t("incomplete-label")}
        className={cn(
          "text-warning-text hover:text-foreground focus-visible:ring-ring inline-flex size-6 items-center justify-center rounded-sm align-middle transition-colors focus-visible:ring-2 focus-visible:outline-none",
          className,
        )}
      >
        <TriangleAlert className="size-4" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent className="text-sm">
        <p role="note">
          <WarningBody unconverted={unconverted} currency={currency} />
        </p>
      </PopoverContent>
    </Popover>
  );
}
