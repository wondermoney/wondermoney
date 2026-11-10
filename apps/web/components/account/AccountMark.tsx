import { type LucideIcon, Wallet } from "lucide-react";
import Image from "next/image";

import { cn } from "@/lib/utils";

type AccountMarkProps = {
  logoUrl?: string | null;
  /** Names the bank (or the account) for assistive tech. */
  label: string;
  className?: string;
  /** Drawn when there is no logo; a wallet unless the record is something else. */
  fallbackIcon?: LucideIcon;
};

/**
 * An account's mark: its bank's logo, or a wallet for an account with no
 * institution behind it (a manual account, a flat, cash). Portfolios and
 * loans pass their own fallback icon.
 */
export function AccountMark({
  logoUrl,
  label,
  className,
  fallbackIcon: FallbackIcon = Wallet,
}: AccountMarkProps) {
  if (logoUrl) {
    return (
      <Image
        src={logoUrl}
        height={36}
        width={36}
        alt={label}
        className={cn("size-9 shrink-0 rounded-lg", className)}
      />
    );
  }

  return (
    <div
      className={cn(
        "bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg",
        className,
      )}
    >
      <FallbackIcon
        className="text-muted-foreground size-4"
        aria-hidden="true"
      />
    </div>
  );
}
