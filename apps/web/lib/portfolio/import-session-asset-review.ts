import type { PortfolioImportAssetGroupDecision } from "@/components/portfolio/import-session/PortfolioImportAssetGroupCard";
import type {
  PortfolioImportAssetGroupPreview,
  PortfolioImportAssetMappingDecision,
} from "@/lib/api/portfolio/importSessionTypes";

export function isBlockingAssetReviewGroup(group: PortfolioImportAssetGroupPreview) {
  return group.status === "ambiguous" || group.status === "provider_error" || group.status === "unmatched";
}

export function getPendingAssetReviewGroupIds(
  groups: PortfolioImportAssetGroupPreview[],
  decisions: Record<number, PortfolioImportAssetGroupDecision>,
) {
  return groups.filter((group) => isBlockingAssetReviewGroup(group) && !decisions[group.id]).map((group) => group.id);
}

export function buildPortfolioImportAssetReviewDecisionsPayload(
  groups: PortfolioImportAssetGroupPreview[],
  decisions: Record<number, PortfolioImportAssetGroupDecision>,
) {
  return groups
    .filter((group) => group.status !== "skipped")
    .map<PortfolioImportAssetMappingDecision | null>((group) => {
      const decision = decisions[group.id];
      if (!decision) return null;

      if (decision.action === "use_candidate") {
        return {
          action: "use_candidate",
          groupId: group.id,
          candidateId: decision.candidateId,
        };
      }

      if (decision.action === "use_external_symbol") {
        return {
          action: "use_external_symbol",
          groupId: group.id,
          symbol: decision.symbol.trim(),
        };
      }

      return {
        action: "skip_group",
        groupId: group.id,
        skipReason: decision.skipReason,
      };
    })
    .filter((decision): decision is PortfolioImportAssetMappingDecision => decision != null);
}

export function hasUserDecisionForAssetReviewGroup(
  group: PortfolioImportAssetGroupPreview,
  decision?: PortfolioImportAssetGroupDecision,
) {
  if (!decision) return false;
  if (decision.action === "use_candidate") {
    return Boolean(group.candidates?.some((candidate) => candidate.id === decision.candidateId));
  }

  if (decision.action === "use_external_symbol") {
    return Boolean(decision.symbol.trim());
  }

  return Boolean(decision.skipReason.trim());
}

export function getPreferredSelectedCandidateId(
  group: PortfolioImportAssetGroupPreview,
  decision?: PortfolioImportAssetGroupDecision,
) {
  return decision?.action === "use_candidate" ? decision.candidateId : undefined;
}

export function getPreferredSelectedSkipReason(
  decision?: PortfolioImportAssetGroupDecision,
) {
  return decision?.action === "skip_group" ? decision.skipReason : undefined;
}
