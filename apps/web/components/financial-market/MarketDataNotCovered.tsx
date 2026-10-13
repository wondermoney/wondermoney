"use client";

import { useTranslations } from "next-intl";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Heading, Text } from "@/components/ui/Typography";
import { cn } from "@/lib/utils";

/**
 * Fundamentals, financials, earnings and news are gated behind a higher tier of
 * the market-data plan, so the API answers 404 for them by design (RAD-449) —
 * permanently, not transiently. Three identical dashed boxes reading "Market
 * data unavailable" made that look like an outage on a page whose chart and
 * profile were working fine (RAD-609).
 *
 * Like the quote-unavailable state this is ordinary content, not an incident:
 * no alert role, no spinner, no retry, no semantic colour. The panel keeps its
 * title so the reader can tell which capability is missing, and says why.
 */
export function MarketDataNotCovered({
  title,
  className,
}: {
  title: string;
  className?: string;
}) {
  const t = useTranslations();

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader className="pb-2">
        <Heading variant="h2" className="text-base">
          {title}
        </Heading>
      </CardHeader>
      <CardContent className="flex min-h-[200px] items-center">
        <Text variant="smallText" className="text-muted-foreground text-pretty">
          {t("market-data-not-covered")}
        </Text>
      </CardContent>
    </Card>
  );
}
