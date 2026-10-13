"use client";

import { useTranslations } from "next-intl";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import type {
  PortfolioImportAssetGroupStatus,
  PortfolioImportRowStatus,
  PortfolioImportSessionStatus,
} from "@/lib/api/portfolio/importSessionTypes";
import { cn } from "@/lib/utils";

export type PortfolioImportStatusBadgeStatus =
  | PortfolioImportSessionStatus
  | PortfolioImportAssetGroupStatus
  | PortfolioImportRowStatus;

interface PortfolioImportStatusBadgeProps {
  className?: string;
  status: PortfolioImportStatusBadgeStatus;
}

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

const STATUS_META: Record<
  PortfolioImportStatusBadgeStatus,
  { labelKey: string; variant: BadgeVariant }
> = {
  waiting_for_upload: {
    labelKey: "portfolio-import-status-waiting-for-upload",
    variant: "muted",
  },
  uploaded: {
    labelKey: "portfolio-import-status-uploaded",
    variant: "outline",
  },
  parsing: {
    labelKey: "portfolio-import-status-parsing",
    variant: "secondary",
  },
  needs_column_mapping: {
    labelKey: "portfolio-import-status-needs-column-mapping",
    variant: "outline",
  },
  needs_asset_review: {
    labelKey: "portfolio-import-status-needs-asset-review",
    variant: "outline",
  },
  ready_to_import: {
    labelKey: "portfolio-import-status-ready-to-import",
    variant: "outline",
  },
  importing: {
    labelKey: "portfolio-import-status-importing",
    variant: "secondary",
  },
  succeeded: {
    labelKey: "portfolio-import-status-succeeded",
    variant: "outline",
  },
  partial: { labelKey: "portfolio-import-status-partial", variant: "outline" },
  failed: { labelKey: "portfolio-import-status-failed", variant: "outline" },
  cancelled: {
    labelKey: "portfolio-import-status-cancelled",
    variant: "outline",
  },
  expired: { labelKey: "portfolio-import-status-expired", variant: "outline" },
  matched: { labelKey: "portfolio-import-status-matched", variant: "outline" },
  ambiguous: {
    labelKey: "portfolio-import-status-ambiguous",
    variant: "outline",
  },
  unmatched: {
    labelKey: "portfolio-import-status-unmatched",
    variant: "outline",
  },
  provider_error: {
    labelKey: "portfolio-import-status-provider-error",
    variant: "outline",
  },
  selected: {
    labelKey: "portfolio-import-status-selected",
    variant: "outline",
  },
  skipped: { labelKey: "portfolio-import-status-skipped", variant: "muted" },
  valid: { labelKey: "portfolio-import-status-valid", variant: "outline" },
  invalid: { labelKey: "portfolio-import-status-invalid", variant: "outline" },
  duplicate: {
    labelKey: "portfolio-import-status-duplicate",
    variant: "muted",
  },
  ready: { labelKey: "portfolio-import-status-ready", variant: "outline" },
  imported: {
    labelKey: "portfolio-import-status-imported",
    variant: "outline",
  },
};

export function PortfolioImportStatusBadge({
  className,
  status,
}: PortfolioImportStatusBadgeProps) {
  const t = useTranslations();
  const meta = STATUS_META[status];

  return (
    <Badge
      variant={meta.variant}
      className={cn("font-medium whitespace-nowrap", className)}
    >
      {t(meta.labelKey as never)}
    </Badge>
  );
}
