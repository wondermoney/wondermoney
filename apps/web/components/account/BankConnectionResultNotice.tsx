"use client";

import { CheckCircle2, CircleX } from "lucide-react";
import { useTranslations } from "next-intl";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/Alert";
import type { BankConnectionResult } from "@/lib/account/bank-account-sync-return-marker";

/** The outcome of a bank connection, for a page that has no richer state to show. */
export default function BankConnectionResultNotice({
  result,
}: {
  result: BankConnectionResult;
}) {
  const t = useTranslations();
  const succeeded = result === "success";
  const Icon = succeeded ? CheckCircle2 : CircleX;

  return (
    <Alert
      variant={succeeded ? "success" : "destructive"}
      role={succeeded ? "status" : "alert"}
      className="gap-0"
    >
      <Icon className="size-4" aria-hidden="true" />
      <AlertTitle className="text-foreground">
        {t(
          succeeded
            ? "bank-connection-return-success-title"
            : "bank-connection-return-error-title",
        )}
      </AlertTitle>
      <AlertDescription className="text-muted-foreground text-sm">
        <p>
          {t(
            succeeded
              ? "bank-connection-return-success-description"
              : "bank-connection-return-error-description",
          )}
        </p>
      </AlertDescription>
    </Alert>
  );
}
