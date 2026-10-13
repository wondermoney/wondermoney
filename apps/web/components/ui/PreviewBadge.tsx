import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

/**
 * The corner tag that marks sample/placeholder data in an empty-state
 * preview ("What you'll get", "Typical loan tracking view", etc.).
 *
 * Established by RAD-647 on AccountsEmptyStateV2 and DashboardBudgetsEmptyState,
 * then found reimplemented six different ways across Accounts, Budgets,
 * Portfolio, Goals, Loans, and Financial Markets — uppercase bordered tag in
 * two places, a muted pill in others, plain unstyled text in others. One
 * component now; see web/DESIGN_HISTORY.md's Known Cross-Platform Gaps for
 * the audit that found this.
 */
export function PreviewBadge({ className }: { className?: string }) {
  const t = useTranslations();
  return (
    <span
      className={cn(
        "border-border bg-background text-foreground rounded-md border px-2.5 py-1 text-[10px] leading-none font-medium tracking-wide uppercase shadow-xs",
        className,
      )}
    >
      {t("preview")}
    </span>
  );
}
