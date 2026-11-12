"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { useState } from "react";

import type { TransactionMerchant } from "@/lib/api/account/useTransactionMerchants";
import {
  merchantAvatarColor,
  merchantInitial,
} from "@/lib/merchant/merchant-avatar";
import { cn } from "@/lib/utils";

const merchantAvatarVariants = cva(
  "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full select-none",
  {
    variants: {
      size: {
        /** Table and list rows. */
        sm: "size-6 text-[0.6875rem] font-semibold",
        /** The inspector header. */
        md: "size-10 text-base font-semibold",
      },
    },
    defaultVariants: { size: "sm" },
  },
);

export interface MerchantAvatarProps extends VariantProps<
  typeof merchantAvatarVariants
> {
  merchant: Pick<TransactionMerchant, "name" | "resolvedLogoUrl">;
  /**
   * The merchant's name for assistive technology. Leave it out when the name is printed beside
   * the avatar, which then stays decorative.
   */
  label?: string;
  className?: string;
}

/**
 * A merchant's logo in a circle, or its initial on a colour hashed from its name.
 *
 * The logo is the API's `resolvedLogoUrl`: either the household's own third-party URL, fetched
 * with no referrer so the provider does not learn which page asked, or the API's authenticated
 * proxy, which the session cookie reaches like any API call. A logo that fails to load (the
 * proxy answers 404 when there is none) falls back to the initial.
 */
export function MerchantAvatar({
  merchant,
  size,
  label,
  className,
}: MerchantAvatarProps) {
  const logoUrl = merchant.resolvedLogoUrl;
  // The URL that failed, not a flag: a new URL gets its own attempt without an effect.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showLogo = !!logoUrl && failedUrl !== logoUrl;
  const labelProps = label
    ? { role: "img" as const, "aria-label": label }
    : { "aria-hidden": true as const };

  if (showLogo) {
    return (
      <span
        {...labelProps}
        className={cn(
          merchantAvatarVariants({ size }),
          "bg-card ring-border ring-1 ring-inset",
          className,
        )}
        data-merchant-avatar="logo"
      >
        {/* A plain img: the URL is arbitrary and third-party, images are unoptimised anyway,
            and the referrer policy has to reach the request. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="size-full object-contain p-0.5"
          onError={() => setFailedUrl(logoUrl)}
        />
      </span>
    );
  }

  return (
    <span
      {...labelProps}
      className={cn(
        merchantAvatarVariants({ size }),
        merchantAvatarColor(merchant.name).className,
        className,
      )}
      data-merchant-avatar="initial"
    >
      {merchantInitial(merchant.name)}
    </span>
  );
}

export default MerchantAvatar;
