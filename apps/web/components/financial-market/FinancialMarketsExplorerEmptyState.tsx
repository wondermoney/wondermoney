"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { PreviewBadge } from "@/components/ui/PreviewBadge";

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

      <Card
        className="border-border"
        role="region"
        aria-labelledby="financial-markets-explorer-preview-title"
      >
        <CardContent className="space-y-6 p-6">
          <div className="space-y-4">
            <div id="financial-markets-explorer-preview-title">
              <PreviewBadge />
            </div>

            <div className="border-border flex flex-wrap items-start justify-between gap-4 border-b pb-4">
              <div className="space-y-1">
                <div className="text-muted-foreground text-xs">
                  {t("financial-markets-explorer-preview-company")}
                </div>
                <div className="text-muted-foreground flex gap-3 font-mono text-sm">
                  <span>---</span>
                  <span>---</span>
                </div>
                <div className="text-muted-foreground text-sm">
                  {t("financial-markets-explorer-preview-company-name-placeholder")}
                </div>
                <div className="text-muted-foreground font-mono text-xs">
                  ---
                </div>
              </div>

              <div className="text-right">
                <div className="text-muted-foreground font-mono text-lg font-semibold">
                  $--
                </div>
                <div className="text-muted-foreground font-mono text-sm">
                  ---
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-foreground text-sm font-medium">
              {t("financial-markets-explorer-preview-chart")}
            </div>
            {/* Background-step, not a second border — the outer Card already
                has one (No-Nesting rule). */}
            <div
              className="bg-muted/20 flex h-32 items-end gap-2 rounded-lg p-4"
              aria-hidden="true"
            >
              {[32, 56, 44, 68, 52, 76, 60, 84].map((height, index) => (
                <div
                  key={index}
                  className="bg-muted-foreground/30 flex-1 rounded-sm"
                  style={{ height: `${height}%` }}
                />
              ))}
            </div>
          </div>

          {/* One divided group, not three nested Cards inside the outer one
              (No-Nesting rule) — same shape as the fixed Portfolio metrics
              grid. */}
          <div className="divide-border bg-muted/20 grid divide-y rounded-lg md:grid-cols-3 md:divide-x md:divide-y-0">
            <div className="space-y-1 p-4">
              <div className="text-muted-foreground text-xs">
                {t("financial-markets-explorer-preview-fundamentals")}
              </div>
              <div className="text-muted-foreground font-mono text-sm font-semibold">
                --
              </div>
            </div>

            <div className="space-y-1 p-4">
              <div className="text-muted-foreground text-xs">
                {t("financial-markets-explorer-preview-financials")}
              </div>
              <div className="text-muted-foreground font-mono text-sm font-semibold">
                $--
              </div>
            </div>

            <div className="space-y-1 p-4">
              <div className="text-muted-foreground text-xs">
                {t("financial-markets-explorer-preview-earnings")}
              </div>
              <div className="text-muted-foreground font-mono text-sm font-semibold">
                --
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
