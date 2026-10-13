"use client";

import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Heading, Text } from "@/components/ui/Typography";
import { Link } from "@/i18n/navigation";

export default function TransactionReviewEmptyState() {
  const t = useTranslations();

  return (
    <div className="bg-card mx-auto flex max-w-xl flex-col items-center gap-4 rounded-lg border p-8 text-center">
      <div className="space-y-2">
        <Heading variant="h2">{t("transaction-review-empty-title")}</Heading>
        <Text className="text-muted-foreground">
          {t("transaction-review-empty-description")}
        </Text>
      </div>
      <Button asChild type="button" variant="outline">
        <Link href="/accounts/transactions">
          {t("transaction-review-empty-cta")}
        </Link>
      </Button>
    </div>
  );
}
