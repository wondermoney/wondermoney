"use client";

import { Home } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "@/components/ui/Link";
import { Heading, Text } from "@/components/ui/Typography";
import { useSupportEmail } from "@/lib/api/instance/useInstance";
import { cn } from "@/lib/utils";

type NotFoundStateProps = {
  className?: string;
};

// Shared 404 content for every `not-found.tsx` boundary in the app. Deliberately
// contains no `<html>`/`<body>` tags: the nearest ancestor layout that owns those
// (either `app/[locale]/layout.tsx` or, for the invalid-locale fallback,
// `app/not-found.tsx` itself) already renders them, and duplicating them here
// produces React's "nested <html>" mounting error. Keep any future
// not-found.tsx additions rendering only this component, never their own
// `<html>`/`<body>`.
export function NotFoundState({ className }: NotFoundStateProps) {
  const t = useTranslations();
  const supportEmail = useSupportEmail();
  const titleId = React.useId();
  const descriptionId = React.useId();

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
            <Text as="p" variant="mutedText">
              {t("app-error-status-label", { status: 404 })}
            </Text>

            <div className="space-y-2">
              <Heading
                variant="h1"
                id={titleId}
                className="text-3xl font-semibold lg:text-3xl"
              >
                {t("page-not-found")}
              </Heading>
              <Text
                as="p"
                variant="mutedText"
                className="max-w-prose"
                id={descriptionId}
              >
                {t("page-not-found-description")}
              </Text>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild className="w-full gap-2 sm:w-auto">
              <Link
                href="/"
                className={cn(buttonVariants({ variant: "default" }), "gap-2")}
              >
                <Home className="size-4" aria-hidden="true" />
                {t("go-back-home")}
              </Link>
            </Button>

            {supportEmail && (
              <Text
                as="p"
                variant="smallText"
                className="text-muted-foreground flex items-center"
              >
                <a
                  className="text-primary inline-flex items-center gap-2 underline-offset-4 hover:underline"
                  href={`mailto:${supportEmail}`}
                >
                  {t("contact-support")}
                </a>
              </Text>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default NotFoundState;
