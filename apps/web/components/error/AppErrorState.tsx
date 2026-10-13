"use client";

import { Home, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "@/components/ui/Link";
import { RateLimitedState } from "@/components/ui/RateLimitedState";
import { Heading, Text } from "@/components/ui/Typography";
import {
  type AppErrorCategory,
  classifyAppError,
  getErrorStatusCode,
} from "@/lib/errors/app-error";
import { cn } from "@/lib/utils";

export type AppErrorSection =
  | "generic"
  | "accounts"
  | "recurring"
  | "budgets"
  | "portfolio";

type AppErrorStateProps = {
  error: Error & { digest?: string };
  reset: () => void;
  section?: AppErrorSection;
  className?: string;
};

const COPY_KEYS: Record<
  AppErrorCategory,
  { title: string; description: string; nextStep: string }
> = {
  "rate-limit": {
    title: "app-error-rate-limit-title",
    description: "app-error-rate-limit-description",
    nextStep: "app-error-rate-limit-next-step",
  },
  auth: {
    title: "app-error-auth-title",
    description: "app-error-auth-description",
    nextStep: "app-error-auth-next-step",
  },
  "not-found": {
    title: "app-error-not-found-title",
    description: "app-error-not-found-description",
    nextStep: "app-error-not-found-next-step",
  },
  service: {
    title: "app-error-service-title",
    description: "app-error-service-description",
    nextStep: "app-error-service-next-step",
  },
  network: {
    title: "app-error-network-title",
    description: "app-error-network-description",
    nextStep: "app-error-network-next-step",
  },
  unknown: {
    title: "app-error-unknown-title",
    description: "app-error-unknown-description",
    nextStep: "app-error-unknown-next-step",
  },
};

const SUPPORT_CATEGORIES: AppErrorCategory[] = ["service", "unknown"];

export function AppErrorState({
  error,
  reset,
  section = "generic",
  className,
}: AppErrorStateProps) {
  const t = useTranslations();
  const titleId = React.useId();
  const descriptionId = React.useId();
  const category = classifyAppError(error);
  const status = getErrorStatusCode(error);
  const copy = COPY_KEYS[category];
  const sectionLabel = t(`app-error-section-${section}`);
  const showSupportLink = SUPPORT_CATEGORIES.includes(category);

  // Being throttled is not a broken route. Skip the status chip, the `alert`
  // role and the "go home" escape hatch, and show the calm state that says how
  // long the wait is and resumes on its own.
  if (category === "rate-limit") {
    return (
      <div
        className={cn(
          "flex min-h-[60vh] items-center justify-center px-4 py-10 sm:px-6",
          className,
        )}
      >
        <RateLimitedState
          error={error}
          onRetry={reset}
          title={t(copy.title)}
          description={t(copy.description, { section: sectionLabel })}
          className="w-full max-w-2xl shadow-none sm:p-8"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex min-h-[60vh] items-center justify-center px-4 py-10 sm:px-6",
        className,
      )}
    >
      <Card
        className="border-border bg-card w-full max-w-2xl shadow-none"
        role="alert"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <CardContent className="space-y-6 p-6 sm:p-8">
          <div className="space-y-3">
            <Text
              as="p"
              variant="smallText"
              className="border-border bg-background text-muted-foreground inline-flex w-fit rounded-md border px-2.5 py-1 font-mono"
            >
              {status !== undefined
                ? t("app-error-status-label", { status })
                : t("app-error-status-unknown")}
            </Text>

            <div className="space-y-2">
              <Heading variant="h1" id={titleId}>
                {t(copy.title)}
              </Heading>
              <Text
                as="p"
                variant="mutedText"
                className="max-w-prose"
                id={descriptionId}
              >
                {t(copy.description, { section: sectionLabel })}
              </Text>
              <Text as="p" variant="mutedText" className="max-w-prose">
                {t(copy.nextStep)}
              </Text>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button className="w-full gap-2 sm:w-auto" onClick={reset}>
              <RotateCcw className="size-4" aria-hidden="true" />
              {t("try-again")}
            </Button>

            <Button
              asChild
              variant="outline"
              className="w-full gap-2 sm:w-auto"
            >
              <Link
                href="/"
                className={cn(buttonVariants({ variant: "outline" }), "gap-1")}
              >
                <Home className="size-4" aria-hidden="true" />
                {t("go-back-home")}
              </Link>
            </Button>
          </div>

          {showSupportLink && (
            <Text
              as="p"
              variant="smallText"
              className="border-border text-muted-foreground border-t pt-4"
            >
              <a
                className="text-primary inline-flex items-center gap-2 underline-offset-4 hover:underline"
                href={`mailto:${t("support-email")}`}
              >
                {t("contact-support")}
              </a>
            </Text>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default AppErrorState;
