"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";

interface PortfolioImportAnalyzingStepProps {
  fileName?: string;
  recovery?: ReactNode;
}

export function PortfolioImportAnalyzingStep({
  fileName,
  recovery,
}: PortfolioImportAnalyzingStepProps) {
  const t = useTranslations();

  return (
    <section
      aria-live="polite"
      role="status"
      className="flex flex-col gap-3 rounded-lg border px-4 py-4"
    >
      {recovery}

      <div className="flex flex-col gap-3">
        <div className="min-w-0 space-y-1">
          <h3
            data-portfolio-import-step-heading="true"
            className="text-foreground text-base font-semibold tracking-tight"
          >
            {t("portfolio-import-analyzing-title")}
          </h3>
          <p className="text-muted-foreground max-w-2xl text-sm leading-6">
            {t("portfolio-import-analyzing-description")}
          </p>
        </div>

        {fileName ? (
          <div className="text-muted-foreground text-xs font-mono tabular-nums">
            {fileName}
          </div>
        ) : null}

        <div className="flex flex-col gap-3">
          <Skeleton className="h-2.5 w-full" />
          <Skeleton className="h-2.5 w-11/12" />
          <Skeleton className="h-2.5 w-4/5" />
        </div>
      </div>
    </section>
  );
}
