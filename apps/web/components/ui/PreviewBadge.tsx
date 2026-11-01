import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

/**
 * The corner tag that marks sample/placeholder data in an empty-state
 * preview ("What you'll get", "Typical loan tracking view", etc.).
 *
 * One component for every empty-state preview (Accounts, Budgets, Portfolio,
 * Goals, Loans, Financial Markets) so the tag looks the same everywhere;
 * don't reimplement it inline.
 */
export function PreviewBadge({ className }: { className?: string }) {
  const t = useTranslations();
  return (
    <span
      className={cn(
        "border-border bg-background text-foreground rounded-md border px-2 py-1 text-xs leading-none font-medium",
        className,
      )}
    >
      {t("preview")}
    </span>
  );
}
