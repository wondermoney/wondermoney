"use client";

import { Check, Circle, SkipForward } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import TickerAutoComplete from "@/components/ui/TickerAutoComplete";
import type {
  PortfolioImportAssetGroupPreview,
  PortfolioImportPreviewRow,
} from "@/lib/api/portfolio/importSessionTypes";
import { getPortfolioImportReviewReasonMessageKey } from "@/lib/portfolio/import-session-resolution-reasons";
import { cn } from "@/lib/utils";

import { PortfolioImportStatusBadge } from "./PortfolioImportStatusBadge";

export type PortfolioImportAssetGroupDecision =
  | { action: "use_candidate"; candidateId: number }
  | { action: "use_external_symbol"; symbol: string; name?: string }
  | { action: "skip_group"; skipReason: string };

type ExternalSymbolSelection = { symbol: string; name?: string };

interface PortfolioImportAssetGroupCardProps {
  affectedRows: PortfolioImportPreviewRow[];
  decision?: PortfolioImportAssetGroupDecision;
  group: PortfolioImportAssetGroupPreview;
  onSelectCandidate: (candidateId: number) => void;
  onSelectExternalSymbol: (selection: ExternalSymbolSelection) => void;
  onSkipGroup: () => void;
  selectedCandidateId?: number;
  selectedExternalSymbol?: string;
  selectedExternalSymbolName?: string;
  selectedSkipReason?: string;
}

function formatConfidence(confidence?: number) {
  if (confidence == null || Number.isNaN(confidence)) return null;
  const value = confidence > 1 ? confidence : confidence * 100;
  return `${Math.round(value)}%`;
}

function getRecommendationReasonMessageKey(reason?: string) {
  if (reason === "isin_and_venue_match") {
    return "portfolio-import-recommendation-reason-isin-and-venue-match";
  }

  return undefined;
}

export function PortfolioImportAssetGroupCard({
  affectedRows,
  decision,
  group,
  onSelectCandidate,
  onSelectExternalSymbol,
  onSkipGroup,
  selectedCandidateId,
  selectedExternalSymbol,
  selectedExternalSymbolName,
  selectedSkipReason,
}: PortfolioImportAssetGroupCardProps) {
  const t = useTranslations();
  const [showAlternatives, setShowAlternatives] = useState(false);
  const chosenCandidateId =
    decision?.action === "use_candidate"
      ? decision.candidateId
      : selectedCandidateId;
  const chosenExternalSymbol =
    decision?.action === "use_external_symbol"
      ? decision.symbol
      : selectedExternalSymbol;
  const chosenExternalSymbolName =
    decision?.action === "use_external_symbol"
      ? decision.name
      : selectedExternalSymbolName;
  const skipReason =
    decision?.action === "skip_group"
      ? decision.skipReason
      : (selectedSkipReason ??
        (group.selectedAction === "skip_group"
          ? group.resolutionReason
          : undefined));
  const reviewReasonKey = getPortfolioImportReviewReasonMessageKey(
    group.resolutionReason,
  );
  const reviewReason = reviewReasonKey
    ? t(reviewReasonKey as never)
    : group.resolutionReason;
  const recommendationReasonKey = getRecommendationReasonMessageKey(
    group.recommendationReason,
  );
  const recommendationReason = recommendationReasonKey
    ? t(recommendationReasonKey as never)
    : undefined;
  const skipReasonKey = getPortfolioImportReviewReasonMessageKey(skipReason);
  const displayedSkipReason = skipReasonKey
    ? t(skipReasonKey as never)
    : skipReason;
  const selectedExternalSymbolLabel = chosenExternalSymbol
    ? {
        name: chosenExternalSymbolName,
        symbol: chosenExternalSymbol,
      }
    : null;
  const recommendedCandidate = useMemo(
    () =>
      group.candidates?.find(
        (candidate) =>
          candidate.id === group.recommendedCandidateId ||
          candidate.isRecommended,
      ),
    [group.candidates, group.recommendedCandidateId],
  );

  // Collapse the alternatives again when the card shows a different group or
  // recommendation (adjusted during render rather than in an effect).
  const alternativesKey = `${group.id}:${group.recommendedCandidateId}`;
  const [shownAlternativesKey, setShownAlternativesKey] =
    useState(alternativesKey);
  if (alternativesKey !== shownAlternativesKey) {
    setShownAlternativesKey(alternativesKey);
    setShowAlternatives(false);
  }

  const shouldShowAlternatives =
    !recommendedCandidate ||
    showAlternatives ||
    (chosenCandidateId != null &&
      chosenCandidateId !== recommendedCandidate.id);
  const candidateList = shouldShowAlternatives
    ? group.candidates ?? []
    : group.candidates?.filter(
        (candidate) => candidate.id !== recommendedCandidate?.id,
      ) ?? [];

  const candidateCards = !group.candidates?.length ? (
    <div className="bg-muted/20 text-muted-foreground rounded-lg border border-dashed px-3 py-4 text-sm">
      {t("portfolio-import-unresolved-assets")}
    </div>
  ) : recommendedCandidate && !shouldShowAlternatives ? (
    <div className="bg-background/60 rounded-xl border p-3 transition-colors">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-foreground text-sm font-medium">
              {recommendedCandidate.name ??
                recommendedCandidate.symbol ??
                `#${recommendedCandidate.id}`}
            </div>
            <Badge variant="secondary">
              {t("portfolio-import-recommended")}
            </Badge>
            {formatConfidence(recommendedCandidate.confidence) ? (
              <Badge variant="outline" className="font-mono tabular-nums">
                {formatConfidence(recommendedCandidate.confidence)}
              </Badge>
            ) : null}
            {chosenCandidateId === recommendedCandidate.id ? (
              <Badge variant="secondary" className="gap-1">
                <Check className="size-3.5" aria-hidden="true" />
                {t("portfolio-import-status-selected")}
              </Badge>
            ) : null}
          </div>

          <div className="text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {recommendedCandidate.symbol ? (
              <span className="font-mono tabular-nums">
                {recommendedCandidate.symbol}
              </span>
            ) : null}
            {recommendedCandidate.isin ? (
              <span className="font-mono tabular-nums">
                {recommendedCandidate.isin}
              </span>
            ) : null}
            {recommendedCandidate.currency ? (
              <span>{recommendedCandidate.currency}</span>
            ) : null}
            <span>{recommendedCandidate.provider}</span>
          </div>

          {recommendationReason ? (
            <div className="text-muted-foreground mt-2 text-xs leading-5">
              {recommendationReason}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
          <Button
            type="button"
            size="sm"
            variant={
              chosenCandidateId === recommendedCandidate.id
                ? "secondary"
                : "outline"
            }
            className="gap-2"
            onClick={() => onSelectCandidate(recommendedCandidate.id)}
            aria-pressed={chosenCandidateId === recommendedCandidate.id}
          >
            {chosenCandidateId === recommendedCandidate.id ? (
              <Check className="size-4" aria-hidden="true" />
            ) : (
              <Circle className="size-4" aria-hidden="true" />
            )}
            {t("portfolio-import-use-candidate")}
          </Button>

          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setShowAlternatives(true)}
          >
            {t("portfolio-import-change")}
          </Button>
        </div>
      </div>
    </div>
  ) : (
    <>
      {candidateList.map((candidate) => {
        const isSelected = chosenCandidateId === candidate.id;
        const isRecommended =
          candidate.id === group.recommendedCandidateId || candidate.isRecommended;
        const confidence = formatConfidence(candidate.confidence);

        return (
          <div
            key={candidate.id}
            className={cn(
              "bg-background/60 rounded-xl border p-3 transition-colors",
              isSelected && "border-foreground bg-muted/30",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-foreground text-sm font-medium">
                    {candidate.name ?? candidate.symbol ?? `#${candidate.id}`}
                  </div>
                  {confidence ? (
                    <Badge variant="outline" className="font-mono tabular-nums">
                      {confidence}
                    </Badge>
                  ) : null}
                  {isRecommended ? (
                    <Badge variant="secondary">
                      {t("portfolio-import-recommended")}
                    </Badge>
                  ) : null}
                  {isSelected ? (
                    <Badge variant="secondary" className="gap-1">
                      <Check className="size-3.5" aria-hidden="true" />
                      {t("portfolio-import-status-selected")}
                    </Badge>
                  ) : null}
                </div>

                <div className="text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  {candidate.symbol ? (
                    <span className="font-mono tabular-nums">
                      {candidate.symbol}
                    </span>
                  ) : null}
                  {candidate.isin ? (
                    <span className="font-mono tabular-nums">
                      {candidate.isin}
                    </span>
                  ) : null}
                  {candidate.currency ? (
                    <span>{candidate.currency}</span>
                  ) : null}
                  <span>{candidate.provider}</span>
                </div>

                {candidate.rejectedReason ? (
                  <div className="text-muted-foreground mt-2 text-xs leading-5">
                    {candidate.rejectedReason}
                  </div>
                ) : null}
              </div>

              <Button
                type="button"
                size="sm"
                variant={isSelected ? "secondary" : "outline"}
                className="shrink-0 gap-2"
                onClick={() => onSelectCandidate(candidate.id)}
                aria-pressed={isSelected}
              >
                {isSelected ? (
                  <Check className="size-4" aria-hidden="true" />
                ) : (
                  <Circle className="size-4" aria-hidden="true" />
                )}
                {t("portfolio-import-use-candidate")}
              </Button>
            </div>
          </div>
        );
      })}
    </>
  );

  return (
    <Card className="overflow-hidden border-border/60 shadow-none">
      <CardHeader className="flex flex-col gap-3 px-3 py-2.5 sm:px-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <CardTitle className="text-foreground text-sm font-semibold tracking-tight">
              {group.identity.brokerAssetName ??
                t("portfolio-import-unresolved-assets")}
            </CardTitle>
            <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
              <span className="font-mono tabular-nums">#{group.id}</span>
              <span className="font-mono tabular-nums">
                {affectedRows.length}
              </span>
              <span>{t("portfolio-import-affected-rows")}</span>
            </div>
          </div>

          <PortfolioImportStatusBadge status={group.status} />
        </div>

        {reviewReason ? (
          <div className="bg-muted/30 text-muted-foreground rounded-lg px-3 py-2 text-sm">
            <div className="text-muted-foreground text-xs font-medium">
              {t("portfolio-import-review-reason")}
            </div>
            <div className="text-foreground mt-1 leading-6">
              {reviewReason}
            </div>
          </div>
        ) : null}
      </CardHeader>

      <CardContent className="flex flex-col gap-3 px-3 pt-0 pb-3 sm:px-3.5 sm:pb-3.5">
        <dl className="grid gap-2 sm:grid-cols-2">
          {[
            [
              t("portfolio-import-column-asset-name"),
              group.identity.brokerAssetName,
            ],
            [t("portfolio-import-column-isin"), group.identity.isin],
            [t("portfolio-import-column-ticker"), group.identity.brokerTicker],
            [
              t("portfolio-import-column-broker-exchange"),
              group.identity.brokerExchange,
            ],
            [t("portfolio-import-column-currency"), group.identity.currency],
          ].map(([label, value]) => (
            <div
              key={label}
              className="bg-muted/30 rounded-lg px-3 py-2"
            >
              <dt className="text-muted-foreground text-xs font-medium">
                {label}
              </dt>
              <dd
                className={cn(
                  "text-foreground mt-1 min-h-5 text-sm",
                  !value && "text-muted-foreground",
                )}
              >
                {value ?? "—"}
              </dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-mono tabular-nums">
            {affectedRows.map((row) => row.rowNumber).join(", ") || "—"}
          </Badge>
          <span className="text-muted-foreground text-xs">
            {t("portfolio-import-affected-rows")}
          </span>
        </div>

        <div className="grid gap-2">{candidateCards}</div>

        <div className="bg-background/70 flex flex-col gap-3 rounded-xl border p-3">
          <div className="space-y-1">
            <div className="text-foreground text-sm font-medium">
              {t("portfolio-import-external-symbol-search-title")}
            </div>
            <p className="text-muted-foreground text-sm leading-6">
              {t("portfolio-import-external-symbol-search-description")}
            </p>
          </div>

          {selectedExternalSymbolLabel ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2">
              <Badge variant="secondary">
                {t("portfolio-import-selected-external-symbol")}
              </Badge>
              <span className="font-mono text-sm tabular-nums">
                {selectedExternalSymbolLabel.symbol}
              </span>
              {selectedExternalSymbolLabel.name ? (
                <span className="text-muted-foreground truncate text-sm">
                  {selectedExternalSymbolLabel.name}
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-2">
            <TickerAutoComplete
              variant="compact"
              onTickerSelected={(symbol) =>
                onSelectExternalSymbol({ symbol })
              }
              selectedTicker={selectedExternalSymbol}
              inputProps={{
                "aria-label": t("portfolio-import-external-symbol-search-title"),
                placeholder: t("portfolio-import-external-symbol-search-placeholder"),
              }}
            />
            <p className="text-muted-foreground text-xs leading-5">
              {t("portfolio-import-external-symbol-search-description")}
            </p>
          </div>
        </div>

        <div className="bg-background/70 flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-foreground text-sm font-medium">
              {t("portfolio-import-skip-group")}
            </div>
            <p className="text-muted-foreground mt-1 text-sm leading-6">
              {t("portfolio-import-skip-group-description")}
            </p>
            {displayedSkipReason ? (
              <div className="text-muted-foreground mt-2 text-xs leading-5">
                {displayedSkipReason}
              </div>
            ) : null}
          </div>

          <Button
            type="button"
            variant="outline"
            className={cn(
              "gap-2 sm:self-start",
              decision?.action === "skip_group" ||
                group.selectedAction === "skip_group"
                ? "border-destructive bg-destructive/10 text-destructive-text hover:bg-destructive/15 hover:text-destructive-text"
                : "border-destructive/40 text-destructive-text hover:bg-destructive/10 hover:text-destructive-text",
            )}
            onClick={onSkipGroup}
            aria-pressed={
              decision?.action === "skip_group" ||
              group.selectedAction === "skip_group"
            }
          >
            <SkipForward className="size-4" aria-hidden="true" />
            {t("portfolio-import-skip-group")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
