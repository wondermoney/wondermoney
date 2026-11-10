"use client";

import { Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import ManualAssetFormDrawer from "@/components/manual-asset/ManualAssetFormDrawer";
import ManualAssetsTable from "@/components/manual-asset/ManualAssetsTable";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import DataLoadError from "@/components/ui/DataLoadError";
import {
  PageHeaderSkeleton,
  StatCardsSkeleton,
  TableSkeleton,
} from "@/components/ui/PageSkeleton";
import { Section } from "@/components/ui/RuledSection";
import { StatCard, StatCardGrid } from "@/components/ui/StatCard";
import { useRouter } from "@/i18n/navigation";
import useManualAssets from "@/lib/api/manual-asset/useManualAssets";
import { splitAssets } from "@/lib/manual-assets/asset-view";

export default function AssetsClient() {
  const t = useTranslations("assets");
  const locale = useLocale();
  const router = useRouter();
  const { data, isPending, error, refetch } = useManualAssets();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const { active, archived } = useMemo(
    () => splitAssets(data?.assets ?? []),
    [data],
  );

  if (isPending) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeaderSkeleton />
        <StatCardsSkeleton count={2} />
        <TableSkeleton rows={4} columns={3} />
      </div>
    );
  }

  if (error) {
    return <DataLoadError error={error} onRetry={() => void refetch()} />;
  }

  const { summary } = data;
  const openAsset = (manualAssetKey: number) =>
    router.push(`/assets/${manualAssetKey}`);
  const drawer = (
    <ManualAssetFormDrawer
      open={drawerOpen}
      onOpenChange={setDrawerOpen}
      userCurrency={summary.currencyCode}
      onCreated={(asset) => openAsset(asset.manualAssetKey)}
    />
  );

  if (data.assets.length === 0) {
    return (
      <Card className="border-border p-6">
        <div className="space-y-4">
          <div className="space-y-1">
            <h1 className="text-foreground text-xl font-semibold tracking-tight">
              {t("empty.title")}
            </h1>
            <p className="text-muted-foreground max-w-2xl text-sm">
              {t("empty.description")}
            </p>
          </div>
          <Button onClick={() => setDrawerOpen(true)}>
            <Plus className="mr-2 size-4" />
            {t("actions.add")}
          </Button>
        </div>
        {drawer}
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-foreground text-2xl font-semibold tracking-tight lg:text-3xl">
            {t("page.title")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t("page.description")}
          </p>
        </div>
        <Button onClick={() => setDrawerOpen(true)}>
          <Plus className="mr-2 size-4" />
          {t("actions.add")}
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        <StatCardGrid className="md:grid-cols-2">
          <StatCard
            label={t("summary.total")}
            value={summary.totalValue}
            currency={summary.currencyCode}
          />
          <StatCard
            label={t("summary.count")}
            valueNode={
              <span className="font-mono text-xl font-semibold tracking-tight tabular-nums">
                {active.length}
              </span>
            }
          />
        </StatCardGrid>
        {/* A partial total never reads as a whole one. */}
        {!summary.isComplete && (
          <p role="note" className="text-muted-foreground text-sm">
            {t("summary.unconverted", {
              count: summary.unconvertedAssets,
              currencies: new Intl.ListFormat(locale, {
                style: "long",
                type: "conjunction",
              }).format(summary.unconvertedCurrencies),
            })}
          </p>
        )}
      </div>

      {active.length > 0 && (
        <ManualAssetsTable
          assets={active}
          userCurrency={summary.currencyCode}
          onRowClick={openAsset}
        />
      )}

      {archived.length > 0 && (
        <Section
          id="archived-assets-heading"
          title={t("table.archivedTitle")}
          aside={t("table.archivedDescription")}
        >
          <ManualAssetsTable
            assets={archived}
            userCurrency={summary.currencyCode}
            onRowClick={openAsset}
          />
        </Section>
      )}
      {drawer}
    </div>
  );
}
