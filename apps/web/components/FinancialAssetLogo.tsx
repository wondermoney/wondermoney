import Image from "next/image";

import { cn } from "@/lib/utils";

type Props = {
  symbol: string;
  logoUrl: string;
  priority?: boolean;
};

export function FinancialAssetLogo({
  symbol,
  logoUrl,
  priority = false,
}: Props) {
  return (
    <div className="border-border relative flex aspect-square size-6 shrink-0 items-center justify-center rounded border bg-white">
      {/* Third-party ticker logos assume a light backing (many, like
          Apple's, are a solid glyph on a transparent background) — force
          white here rather than a theme token so they stay legible in dark
          mode instead of vanishing against it. */}
      <Image
        priority={priority}
        src={logoUrl}
        width={20}
        height={20}
        alt={symbol}
        className="rounded"
      />
    </div>
  );
}
