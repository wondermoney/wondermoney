"use client";

import { useTranslations } from "next-intl";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import type { PortfolioImportSessionPreviewResponse } from "@/lib/api/portfolio/importSessionTypes";

import { PortfolioImportRowDetailList } from "./PortfolioImportRowDetailList";
import { PortfolioImportStatusBadge } from "./PortfolioImportStatusBadge";
import { PortfolioImportUnsupportedAssetsAlert } from "./PortfolioImportUnsupportedAssetsAlert";

interface PortfolioImportPreviewStepProps {
  preview?: PortfolioImportSessionPreviewResponse;
}

function SummaryMetric({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums text-foreground">{value}</span>
    </span>
  );
}

export function PortfolioImportPreviewStep({
  preview,
}: PortfolioImportPreviewStepProps) {
  const t = useTranslations();
  const summary = preview?.summary;
  const status = preview?.status ?? "waiting_for_upload";
  const skippedRows = summary?.userSkippedRows ?? summary?.skippedRows ?? 0;
  // Only a confirmed import produces failed rows, so the group stays hidden
  // until there is one rather than sitting empty on every preview.
  const failedRows = preview?.rows.failed ?? [];
  const failedCount = summary?.failedRows ?? failedRows.length;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3
            data-portfolio-import-step-heading="true"
            className="text-foreground text-base font-semibold tracking-tight"
          >
            {t("portfolio-import-preview-title")}
          </h3>
          <p className="text-muted-foreground max-w-2xl text-sm leading-6">
            {t("portfolio-import-preview-description")}
          </p>
        </div>

        <PortfolioImportStatusBadge status={status} />
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <SummaryMetric
          label={t("portfolio-import-summary-ready")}
          value={summary?.readyRows ?? 0}
        />
        <SummaryMetric
          label={t("portfolio-import-summary-review")}
          value={summary?.needsAssetReviewRows ?? 0}
        />
        <SummaryMetric
          label={t("portfolio-import-summary-skipped-short")}
          value={skippedRows}
        />
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="inline-flex gap-1.5">{t("portfolio-import-ledger-total")} <span className="text-foreground font-mono tabular-nums">{summary?.totalRows ?? 0}</span></span>
        <span className="inline-flex gap-1.5">{t("portfolio-import-ledger-duplicates")} <span className="text-foreground font-mono tabular-nums">{summary?.duplicateRows ?? 0}</span></span>
        <span className="inline-flex gap-1.5">{t("portfolio-import-ledger-invalid")} <span className="text-foreground font-mono tabular-nums">{summary?.invalidRows ?? 0}</span></span>
      </div>

      <PortfolioImportUnsupportedAssetsAlert
        unsupportedAssets={summary?.unsupportedAssets}
      />

      <Accordion type="multiple" className="w-full">
        <AccordionItem value="needs-review">
          <AccordionTrigger className="py-3 text-sm no-underline hover:no-underline">
            <span className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left">
              <span>{t("portfolio-import-details-needs-review")}</span>
              <span className="text-muted-foreground font-mono text-xs tabular-nums">
                {summary?.needsAssetReviewRows ?? 0}
              </span>
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <PortfolioImportRowDetailList
              emptyLabel={t("portfolio-import-details-empty")}
              rows={preview?.rows.needsAssetReview ?? []}
            />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="duplicates">
          <AccordionTrigger className="py-3 text-sm no-underline hover:no-underline">
            <span className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left">
              <span>{t("portfolio-import-details-duplicates")}</span>
              <span className="text-muted-foreground font-mono text-xs tabular-nums">
                {summary?.duplicateRows ?? 0}
              </span>
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <PortfolioImportRowDetailList
              emptyLabel={t("portfolio-import-details-empty")}
              rows={preview?.rows.duplicate ?? []}
            />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="invalid">
          <AccordionTrigger className="py-3 text-sm no-underline hover:no-underline">
            <span className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left">
              <span>{t("portfolio-import-details-invalid")}</span>
              <span className="text-muted-foreground font-mono text-xs tabular-nums">
                {summary?.invalidRows ?? 0}
              </span>
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <PortfolioImportRowDetailList
              emptyLabel={t("portfolio-import-details-empty")}
              rows={preview?.rows.invalid ?? []}
            />
          </AccordionContent>
        </AccordionItem>

        {failedRows.length > 0 || failedCount > 0 ? (
          <AccordionItem value="failed">
            <AccordionTrigger className="py-3 text-sm no-underline hover:no-underline">
              <span className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left">
                <span>{t("portfolio-import-details-failed")}</span>
                <span className="text-muted-foreground font-mono text-xs tabular-nums">
                  {failedCount}
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <PortfolioImportRowDetailList
                emptyLabel={t("portfolio-import-details-empty")}
                rows={failedRows}
              />
            </AccordionContent>
          </AccordionItem>
        ) : null}
      </Accordion>
    </section>
  );
}
