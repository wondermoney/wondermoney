"use client";

import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/Alert";
import { Button } from "@/components/ui/button";
import {
  capturePortfolioImportFunnelEvent,
  PORTFOLIO_IMPORT_FUNNEL_EVENTS,
} from "@/lib/analytics/portfolio-import";
import type {
  PortfolioImportAssetGroupPreview,
  PortfolioImportPreviewRow,
  PortfolioImportSessionPreviewResponse,
} from "@/lib/api/portfolio/importSessionTypes";
import useConfirmPortfolioImportAssetMappings from "@/lib/api/portfolio/useConfirmPortfolioImportAssetMappings";
import {
  buildPortfolioImportAssetReviewDecisionsPayload,
  getPendingAssetReviewGroupIds,
  isBlockingAssetReviewGroup,
} from "@/lib/portfolio/import-session-asset-review";

import {
  PortfolioImportAssetGroupCard,
  type PortfolioImportAssetGroupDecision,
} from "./PortfolioImportAssetGroupCard";
import { PortfolioImportStatusBadge } from "./PortfolioImportStatusBadge";
import { PortfolioImportStepRecoveryAlert } from "./PortfolioImportStepRecoveryAlert";

interface PortfolioImportAssetReviewStepProps {
  importSessionId: number;
  onPreviewRefetch: () => Promise<unknown>;
  preview?: PortfolioImportSessionPreviewResponse;
}

function getGroupRows(
  preview: PortfolioImportSessionPreviewResponse | undefined,
  groupId: number,
) {
  const rows = [
    ...(preview?.rows.ready ?? []),
    ...(preview?.rows.duplicate ?? []),
    ...(preview?.rows.invalid ?? []),
    ...(preview?.rows.needsAssetReview ?? []),
  ];

  return rows.filter((row) => row.assetGroupId === groupId);
}

export function PortfolioImportAssetReviewStep({
  importSessionId,
  onPreviewRefetch,
  preview,
}: PortfolioImportAssetReviewStepProps) {
  const t = useTranslations();
  const posthog = usePostHog();
  const confirmAssetMappings = useConfirmPortfolioImportAssetMappings();
  const [decisions, setDecisions] = useState<
    Record<number, PortfolioImportAssetGroupDecision>
  >({});
  const [recoveryState, setRecoveryState] = useState<
    | {
        descriptionKey: string;
        onDiscard: () => void;
        onRetry: () => void;
        primaryActionKey: string;
        secondaryActionKey: string;
        titleKey: string;
      }
    | undefined
  >();

  const blockingGroups = useMemo(
    () => preview?.assetGroups.filter(isBlockingAssetReviewGroup) ?? [],
    [preview?.assetGroups],
  );
  const resolvedGroups = useMemo(
    () =>
      preview?.assetGroups.filter(
        (group) =>
          group.status !== "skipped" && !isBlockingAssetReviewGroup(group),
      ) ?? [],
    [preview?.assetGroups],
  );

  useEffect(() => {
    const groups = preview?.assetGroups ?? [];

    setDecisions((current) => {
      let next = current;

      for (const group of groups) {
        if (!isBlockingAssetReviewGroup(group)) continue;
        if (next[group.id]) continue;

        const recommendedCandidate =
          group.recommendedCandidateId == null
            ? undefined
            : group.candidates?.find(
                (candidate) =>
                  candidate.id === group.recommendedCandidateId ||
                  candidate.isRecommended,
              );

        if (!recommendedCandidate) continue;

        if (next === current) {
          next = { ...current };
        }

        next[group.id] = {
          action: "use_candidate",
          candidateId: recommendedCandidate.id,
        };
      }

      return next;
    });
  }, [preview?.assetGroups]);

  const pendingBlockingGroups = getPendingAssetReviewGroupIds(
    blockingGroups,
    decisions,
  );
  const isComplete = pendingBlockingGroups.length === 0;

  const onSubmit = async () => {
    if (!preview || !isComplete) return;

    const payload = buildPortfolioImportAssetReviewDecisionsPayload(
      blockingGroups,
      decisions,
    );
    if (!payload.length) return;

    try {
      await confirmAssetMappings.mutateAsync({
        importSessionId,
        decisions: payload,
      });

      capturePortfolioImportFunnelEvent(
        posthog,
        PORTFOLIO_IMPORT_FUNNEL_EVENTS.assetReviewSaved,
        {
          decision_count: payload.length,
          outcome: "succeeded",
          stage: "asset_review",
        },
      );
      setDecisions({});
      setRecoveryState(undefined);
      await onPreviewRefetch();
    } catch {
      capturePortfolioImportFunnelEvent(
        posthog,
        PORTFOLIO_IMPORT_FUNNEL_EVENTS.assetReviewSaved,
        {
          decision_count: payload.length,
          outcome: "failed",
          stage: "asset_review",
          error_category: "asset_review",
        },
      );
      setRecoveryState({
        descriptionKey: "portfolio-import-asset-review-error-description",
        onDiscard: () => {
          setDecisions({});
          setRecoveryState(undefined);
        },
        onRetry: onSubmit,
        primaryActionKey: "portfolio-import-asset-review-error-retry",
        secondaryActionKey: "portfolio-import-asset-review-error-discard",
        titleKey: "portfolio-import-asset-review-error-title",
      });
      toast.error(t("portfolio-import-asset-review-error-title"));
    }
  };

  return (
    <section aria-live="polite" role="status" className="flex flex-col gap-3">
      {recoveryState ? (
        <PortfolioImportStepRecoveryAlert
          descriptionKey={recoveryState.descriptionKey}
          onDiscard={recoveryState.onDiscard}
          onRetry={recoveryState.onRetry}
          primaryActionKey={recoveryState.primaryActionKey}
          secondaryActionKey={recoveryState.secondaryActionKey}
          titleKey={recoveryState.titleKey}
        />
      ) : null}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 className="text-foreground text-base font-semibold tracking-tight">
            {t("portfolio-import-asset-review-title")}
          </h3>
          <p className="text-muted-foreground max-w-2xl text-sm leading-6">
            {t("portfolio-import-asset-review-description")}
          </p>
        </div>

        <PortfolioImportStatusBadge
          status={preview?.status ?? "needs_asset_review"}
        />
      </div>

      {!blockingGroups.length && !resolvedGroups.length ? (
        <Alert>
          <AlertTitle>{t("portfolio-import-asset-review-title")}</AlertTitle>
          <AlertDescription>
            {t("portfolio-import-asset-review-description")}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3">
        {blockingGroups.map((group) => {
          const groupDecision = decisions[group.id];

          return (
            <PortfolioImportAssetGroupCard
              key={group.id}
              affectedRows={getGroupRows(preview, group.id)}
              decision={groupDecision}
              group={group}
              onSelectCandidate={(candidateId) => {
                setDecisions((current) => ({
                  ...current,
                  [group.id]: { action: "use_candidate", candidateId },
                }));
              }}
              onSelectExternalSymbol={({ symbol, name }) => {
                setDecisions((current) => ({
                  ...current,
                  [group.id]: { action: "use_external_symbol", symbol, name },
                }));
              }}
              onSkipGroup={() => {
                setDecisions((current) => ({
                  ...current,
                  [group.id]: {
                    action: "skip_group",
                    skipReason: t("portfolio-import-skip-group-description"),
                  },
                }));
              }}
              selectedCandidateId={
                groupDecision?.action === "use_candidate"
                  ? groupDecision.candidateId
                  : undefined
              }
              selectedExternalSymbol={
                groupDecision?.action === "use_external_symbol"
                  ? groupDecision.symbol
                  : undefined
              }
              selectedExternalSymbolName={
                groupDecision?.action === "use_external_symbol"
                  ? groupDecision.name
                  : undefined
              }
              selectedSkipReason={
                groupDecision?.action === "skip_group"
                  ? groupDecision.skipReason
                  : undefined
              }
            />
          );
        })}
      </div>

      {resolvedGroups.length > 0 ? (
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="resolved-assets" className="border-t pt-1">
            <AccordionTrigger className="py-2 text-sm font-medium hover:no-underline">
              {t("portfolio-import-resolved-assets")}
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid gap-2">
                {resolvedGroups.map((group) => {
                  const rowCount = getGroupRows(preview, group.id).length;
                  const assetName =
                    group.identity.brokerAssetName ??
                    t("portfolio-import-unresolved-assets");

                  return (
                    <div
                      key={group.id}
                      className="flex items-center justify-between gap-3 py-1.5"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">
                          {assetName}
                        </div>
                        <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-mono tabular-nums">#{group.id}</span>
                          <span>·</span>
                          <span className="font-mono tabular-nums">{rowCount}</span>
                          <span>{t("portfolio-import-affected-rows")}</span>
                        </div>
                      </div>

                      <PortfolioImportStatusBadge status={group.status} />
                    </div>
                  );
                })}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      ) : null}

      <div className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky bottom-0 flex flex-col gap-2 border-t pt-2 backdrop-blur">
        {!isComplete ? (
          <div className="text-muted-foreground text-sm">
            {t("portfolio-import-asset-review-pending-groups", {
              count: pendingBlockingGroups.length,
            })}
          </div>
        ) : null}

        <Button
          type="button"
          onClick={onSubmit}
          disabled={!isComplete || confirmAssetMappings.isPending}
        >
          {t("save")}
        </Button>
      </div>
    </section>
  );
}
