"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { ExplorerCompanyCards } from "./ExplorerCompanyCards";

interface FinancialMarketsExplorerEmptyStateProps {
  children?: ReactNode;
}

export default function FinancialMarketsExplorerEmptyState({
  children,
}: FinancialMarketsExplorerEmptyStateProps) {
  const t = useTranslations();

  return (
    <section
      className="space-y-4"
      aria-labelledby="financial-markets-explorer-empty-title"
    >
      <div className="space-y-2">
        <h2
          id="financial-markets-explorer-empty-title"
          className="text-lg font-semibold tracking-tight"
        >
          {t("financial-markets-explorer-empty-title")}
        </h2>
        <p className="text-muted-foreground max-w-2xl text-sm">
          {t("financial-markets-explorer-empty-description")}
        </p>
        {children ? <div className="pt-2">{children}</div> : null}
      </div>
      <ExplorerCompanyCards />
    </section>
  );
}
