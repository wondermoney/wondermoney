"use client";

import { Clock } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Heading, Text } from "@/components/ui/Typography";
import { useRateLimitRetry } from "@/lib/api/useRateLimitRetry";
import { cn } from "@/lib/utils";

/**
 * Shown when the API answered 429.
 *
 * This is deliberately *not* an error state. Nothing is broken, the user did
 * nothing wrong, and waiting is the entire fix — so it carries no destructive
 * colour, no `role="alert"`, and no "contact support". The previous behaviour
 * was the full-page "Error loading data" screen, which was wrong twice over: it
 * implied a fault, and it gave no sign that the wait would resolve it.
 *
 * Accessibility:
 *   - The countdown ticks once per second and is `aria-hidden`. Announcing it
 *     would fire a live-region update every second for up to five minutes.
 *   - A single polite `role="status"` line is announced once, on arrival. The
 *     region is committed empty and filled a beat later, which is what makes
 *     assistive tech treat it as an update rather than as page content.
 *   - The clock icon is decorative; state is carried by the words, never by
 *     colour alone.
 */
export type RateLimitedStateProps = {
  /** The rate-limited error. Drives the countdown and the staggered resume. */
  error?: unknown;
  onRetry?: () => void;
  /** Fire `onRetry` automatically at this widget's coordinator slot. */
  autoRetry?: boolean;
  title?: string;
  description?: string;
  /** `card` matches the dashboard panels; `inline` matches report bodies. */
  variant?: "card" | "inline";
  className?: string;
};

export function RateLimitedState({
  error,
  onRetry,
  autoRetry = true,
  title,
  description,
  variant = "card",
  className,
}: RateLimitedStateProps) {
  const t = useTranslations();
  const willAutoRetry = autoRetry && Boolean(onRetry);
  const { secondsRemaining } = useRateLimitRetry(error, {
    onRetry,
    autoRetry: willAutoRetry,
  });

  const [announcement, setAnnouncement] = React.useState("");
  // Reads the latest seconds when it fires rather than depending on them, so
  // the live region is written once with the window it was given and never
  // rewritten as the number falls.
  const announce = React.useEffectEvent(() => {
    setAnnouncement(
      t(
        willAutoRetry
          ? "rate-limited-announcement"
          : "rate-limited-announcement-wait",
        { seconds: secondsRemaining },
      ),
    );
  });

  React.useEffect(() => {
    // Commit the live region empty first, then fill it, so the change is what
    // gets announced. One announcement, then silence while the number ticks.
    const timer = window.setTimeout(() => announce(), 120);

    return () => window.clearTimeout(timer);
  }, [t, willAutoRetry]);

  const countdown =
    secondsRemaining > 0
      ? t(
          willAutoRetry
            ? "rate-limited-retrying-in"
            : "rate-limited-available-in",
          { seconds: secondsRemaining },
        )
      : willAutoRetry
        ? t("rate-limited-retrying-now")
        : t("rate-limited-available-now");

  const body = (
    <>
      <span className="sr-only" role="status">
        {announcement}
      </span>

      <div className={cn("space-y-2", variant === "inline" && "max-w-xs")}>
        <div
          className={cn(
            "flex items-center gap-2",
            variant === "inline" && "justify-center",
          )}
        >
          <Clock
            className="text-muted-foreground size-4 shrink-0"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <Heading
            variant="h4"
            className={cn(variant === "inline" && "text-sm")}
          >
            {title ?? t("rate-limited-title")}
          </Heading>
        </div>

        <Text
          variant="mutedText"
          className={cn(variant === "inline" && "text-xs")}
        >
          {description ?? t("rate-limited-description")}
        </Text>

        {/* Ticks every second — announcing it would be unusable. */}
        <Text
          variant="mutedText"
          className="text-foreground font-mono"
          aria-hidden="true"
        >
          {countdown}
        </Text>
      </div>

      {onRetry && secondsRemaining === 0 ? (
        <Button
          type="button"
          variant="outline"
          size={variant === "inline" ? "sm" : "default"}
          className={cn(variant === "card" && "w-fit")}
          onClick={onRetry}
        >
          {t("try-again")}
        </Button>
      ) : null}
    </>
  );

  if (variant === "inline") {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-3 px-6 py-10 text-center",
          className,
        )}
      >
        {body}
      </div>
    );
  }

  return (
    <Card className={cn("border-border bg-card p-6", className)}>
      <div className="flex flex-col gap-4">{body}</div>
    </Card>
  );
}

export default RateLimitedState;
