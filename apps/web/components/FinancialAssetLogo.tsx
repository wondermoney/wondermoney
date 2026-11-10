import { CoinsIcon } from "lucide-react";
import Image from "next/image";

import { cn } from "@/lib/utils";

type Props = {
  symbol: string;
  logoUrl?: string | null;
  priority?: boolean;
};

/**
 * An asset's mark at one size for every kind of row: the ticker's logo, a
 * coin for a cash position (`CURRENCY_*`), or the ticker's first letters when
 * no logo is known, so a column of tickers never has gaps where marks go.
 */
export function FinancialAssetLogo({
  symbol,
  logoUrl,
  priority = false,
}: Props) {
  const isCash = symbol.startsWith("CURRENCY_");

  return (
    <div
      className={cn(
        "border-border relative flex aspect-square size-6 shrink-0 items-center justify-center rounded border",
        // Third-party ticker logos assume a light backing (many, like
        // Apple's, are a solid glyph on a transparent background) — force
        // white here rather than a theme token so they stay legible in dark
        // mode instead of vanishing against it.
        logoUrl && !isCash ? "bg-white" : "bg-muted text-muted-foreground",
      )}
    >
      {isCash ? (
        <CoinsIcon className="size-3.5" aria-hidden="true" />
      ) : logoUrl ? (
        <Image
          priority={priority}
          src={logoUrl}
          width={20}
          height={20}
          alt={symbol}
          className="rounded"
        />
      ) : (
        <span className="font-mono text-[0.625rem] leading-none font-medium">
          {symbol.slice(0, 2)}
        </span>
      )}
    </div>
  );
}
