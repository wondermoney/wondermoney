"use client";

import { RotateCw } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RateLimitedState } from "@/components/ui/RateLimitedState";
import { Heading, Text } from "@/components/ui/Typography";
import { isRateLimitError } from "@/lib/api/rate-limit";
import { cn } from "@/lib/utils";

/**
 * Shown when a panel's data could not be loaded.
 *
 * This exists so a failed query is not mistaken for an empty one —
 * `Boolean(data?.transactions?.length)` is false for "request failed" exactly
 * as it is for "you have none". Showing the onboarding empty state to someone
 * with 54 transactions tells them to add their first one, which is worse than
 * an error because it reads as authoritative.
 *
 * Panels should distinguish the two: empty state only when the query succeeded
 * and returned nothing; this when it failed.
 */
export default function DataLoadError({
  onRetry,
  className,
  title,
  description,
  error,
}: {
  onRetry?: () => void;
  className?: string;
  title?: string;
  description?: string;
  /**
   * The query error, when the panel has one. A 429 is not a failure, so it
   * degrades to the calm rate-limited state instead of this one. Panels that
   * pass an error get that for free; panels that do not keep today's copy.
   */
  error?: unknown;
}) {
  const t = useTranslations();

  if (isRateLimitError(error)) {
    return (
      <RateLimitedState error={error} onRetry={onRetry} className={className} />
    );
  }

  return (
    <Card
      className={cn("border-border bg-card p-6", className)}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col gap-4">
        <div className="space-y-2">
          <Heading variant="h4">{title ?? t("error-loading-data")}</Heading>
          <Text variant="mutedText">
            {description ?? t("entitlement-error-help")}
          </Text>
        </div>
        {onRetry ? (
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            onClick={onRetry}
          >
            <RotateCw className="mr-2 size-4" />
            {t("try-again")}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
