"use client";

import { Info } from "lucide-react";
import { useTranslations } from "next-intl";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/Alert";
import {
  type PortfolioHistoryStatusResponse,
} from "@/lib/api/portfolio/usePortfolioHistoryStatus";
import { cn } from "@/lib/utils";

type BannerState =
  | "ready"
  | "processing"
  | "partial"
  | "unavailable"
  | "unknown";

type StageStatus = "ready" | "processing" | "partial" | "waiting" | "unavailable";

const STAGE_STATUS_CLASS: Record<StageStatus, string> = {
  ready: "text-foreground",
  processing: "text-info-text",
  partial: "text-warning-text",
  waiting: "text-muted-foreground",
  unavailable: "text-muted-foreground",
};

interface PortfolioHistoryStatusBannerProps {
  status?: PortfolioHistoryStatusResponse;
}

export default function PortfolioHistoryStatusBanner({
  status,
}: PortfolioHistoryStatusBannerProps) {
  const t = useTranslations();
  const bannerState: BannerState = status?.status ?? "unknown";

  if (!status || bannerState === "ready") {
    return null;
  }

  const isProcessing = bannerState === "processing";

  const stageKeys =
    bannerState === "unavailable"
      ? {
          holdings: "portfolio-history-stage-holdings-unavailable",
          allocation: "portfolio-history-stage-allocation-unavailable",
          performance: "portfolio-history-stage-performance-unavailable",
          benchmark: "portfolio-history-stage-benchmark-unavailable",
        }
      : {
          holdings: "portfolio-history-stage-holdings-ready",
          allocation: "portfolio-history-stage-allocation-ready",
          performance:
            bannerState === "processing"
              ? "portfolio-history-stage-performance-processing"
              : bannerState === "partial"
                ? "portfolio-history-stage-performance-partial"
                : "portfolio-history-stage-performance-processing",
          benchmark:
            bannerState === "processing"
              ? "portfolio-history-stage-benchmark-waiting"
              : bannerState === "partial"
                ? "portfolio-history-stage-benchmark-partial"
                : "portfolio-history-stage-benchmark-waiting",
        };

  const stageLabels = {
    holdings: t("portfolio-readiness-stage-holdings"),
    allocation: t("portfolio-readiness-stage-allocation"),
    performance: t("portfolio-readiness-stage-performance"),
    benchmark: t("portfolio-readiness-stage-benchmark"),
  };

  const stageValues = {
    holdings: t(stageKeys.holdings),
    allocation: t(stageKeys.allocation),
    performance: t(stageKeys.performance),
    benchmark: t(stageKeys.benchmark),
  };

  const stageTone = (state: StageStatus) =>
    cn("inline-flex items-center gap-1.5 text-xs", STAGE_STATUS_CLASS[state]);

  return (
    <Alert
      variant={isProcessing ? "info" : "warning"}
      className={cn(
        "gap-0 border-border bg-card text-foreground",
        isProcessing && "border-info-text/20 bg-info/5 text-info-text",
      )}
    >
      <Info className="h-4 w-4" />
      <AlertTitle>
        {isProcessing
          ? t("portfolio-history-processing-title")
          : bannerState === "unavailable"
            ? t("portfolio-history-unavailable-title")
            : t("portfolio-history-partial-title")}
      </AlertTitle>
      <AlertDescription className="space-y-4 text-sm text-muted-foreground">
        <p className="hidden sm:block">
          {isProcessing
            ? t("portfolio-history-processing-description", {
                assetsPending: status.assetsPending,
              })
            : bannerState === "unavailable"
              ? t("portfolio-history-unavailable-description")
              : t("portfolio-history-partial-description")}
        </p>
        <p className="sm:hidden">
          {isProcessing
            ? t("portfolio-history-processing-compact", {
                assetsPending: status.assetsPending,
              })
            : bannerState === "unavailable"
              ? t("portfolio-history-unavailable-compact")
              : t("portfolio-history-partial-compact")}
        </p>

        <dl className="grid gap-2 sm:grid-cols-2">
          {[
            ["holdings", stageLabels.holdings, stageValues.holdings],
            ["allocation", stageLabels.allocation, stageValues.allocation],
            ["performance", stageLabels.performance, stageValues.performance],
            ["benchmark", stageLabels.benchmark, stageValues.benchmark],
          ].map(([key, label, value]) => (
            <div
              key={label}
              className="border-border/70 bg-background/70 rounded-lg border px-3 py-2"
            >
              <div className="flex items-center justify-between gap-3">
                <dt className="text-foreground text-sm">{label}</dt>
                <dd
                  className={stageTone(
                    bannerState === "unavailable"
                      ? "unavailable"
                      : key === "performance"
                        ? bannerState === "processing"
                          ? "processing"
                          : bannerState === "partial"
                            ? "partial"
                            : "processing"
                        : key === "benchmark"
                          ? bannerState === "processing"
                            ? "waiting"
                            : bannerState === "partial"
                              ? "partial"
                              : "ready"
                          : "ready",
                  )}
                >
                  <span className="h-2 w-2 rounded-full bg-current/60" />
                  <span>{value}</span>
                </dd>
              </div>
            </div>
          ))}
        </dl>
      </AlertDescription>
    </Alert>
  );
}
