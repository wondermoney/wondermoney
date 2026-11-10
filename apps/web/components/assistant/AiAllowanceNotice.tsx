"use client";

import { Clock } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { Alert, AlertDescription } from "@/components/ui/Alert";

/** Allowances are counted per UTC day, so the next one starts at the next UTC midnight. */
export function nextAllowanceReset(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
}

/**
 * Shown where an AI feature answered `ai_allowance_exhausted`: the household
 * used today's allowance. Says when it comes back, in the viewer's own time.
 */
export default function AiAllowanceNotice({ now = new Date() }: { now?: Date }) {
  const t = useTranslations("aiAllowance");
  const format = useFormatter();
  const time = format.dateTime(nextAllowanceReset(now), {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <Alert variant="info" data-testid="ai-allowance-notice">
      <Clock className="size-4" />
      <AlertDescription>{t("message", { time })}</AlertDescription>
    </Alert>
  );
}
