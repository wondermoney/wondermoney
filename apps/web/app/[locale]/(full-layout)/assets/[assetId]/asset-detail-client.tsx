"use client";

import { Archive, ArrowLeft, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import ConfirmAssetAction from "@/components/manual-asset/ConfirmAssetAction";
import CryptoWalletSection from "@/components/manual-asset/CryptoWalletSection";
import ManualAssetFormDrawer from "@/components/manual-asset/ManualAssetFormDrawer";
import ManualAssetValueChart from "@/components/manual-asset/ManualAssetValueChart";
import ValuationDrawer from "@/components/manual-asset/ValuationDrawer";
import { Amount } from "@/components/ui/Amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ObjectHeader } from "@/components/ui/ObjectHeader";
import { Section } from "@/components/ui/RuledSection";
import { Link, useRouter } from "@/i18n/navigation";
import {
  API_ERROR_CODE,
  getApiErrorCode,
  getApiErrorMessage,
  isDemoReadOnlyError,
} from "@/lib/api/errors";
import { useCryptoWalletChains } from "@/lib/api/instance/useInstance";
import type {
  ManualAsset,
  ManualAssetValuation,
} from "@/lib/api/manual-asset/types";
import { useSyncCryptoWallet } from "@/lib/api/manual-asset/useCryptoWalletMutations";
import useManualAsset from "@/lib/api/manual-asset/useManualAsset";
import {
  useDeleteManualAsset,
  useDeleteValuation,
  useUpdateManualAsset,
} from "@/lib/api/manual-asset/useManualAssetMutations";
import {
  calendarDay,
  changeSincePurchase,
  isEstimated,
} from "@/lib/manual-assets/asset-view";
import {
  isCryptoWallet,
  walletErrorKey,
} from "@/lib/manual-assets/crypto-wallet";
import { useFormatPercentage } from "@/lib/utils/useFormatPercentage";
import { useFormatShortDate } from "@/lib/utils/useFormatShortDate";

function Fact({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="border-border flex justify-between gap-6 border-b py-2 text-sm">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

/**
 * What the asset is worth less what is still owed on the reader's loans secured
 * against it. Debt in another currency counts only once converted: with a loan the
 * API has no rate for, there is no total and no equity, and the page says why
 * rather than adding amounts in different currencies.
 */
function AssetEquity({ asset }: { asset: ManualAsset }) {
  const t = useTranslations("assets");
  const { linkedDebt, equity } = asset;

  return (
    <Section id="asset-equity-heading" title={t("detail.equity.title")}>
      <dl>
        <Fact label={t("detail.equity.value")}>
          <Amount
            value={asset.value}
            currency={asset.currency}
            className="font-mono"
          />
        </Fact>
        <Fact label={t("detail.equity.linkedDebt")}>
          <Amount
            value={linkedDebt}
            currency={asset.currency}
            className="font-mono"
          />
        </Fact>
        <Fact label={t("detail.equity.equity")}>
          {/* Only a negative equity is exceptional; its minus sign and the
              note below carry it as well as the colour. */}
          <Amount
            value={equity}
            currency={asset.currency}
            tone="threshold"
            className="font-mono font-semibold"
          />
        </Fact>
      </dl>
      {linkedDebt === null ? (
        <p role="note" className="text-muted-foreground mt-3 text-sm">
          {t("detail.equity.noRate", {
            currencies: asset.unconvertedLoanCurrencies.join(", "),
            currency: asset.currency,
          })}
        </p>
      ) : asset.value === null ? (
        <p role="note" className="text-muted-foreground mt-3 text-sm">
          {t("detail.equity.archived")}
        </p>
      ) : equity !== null && equity < 0 ? (
        <p role="note" className="text-muted-foreground mt-3 text-sm">
          {t("detail.equity.underwater")}
        </p>
      ) : null}

      <h3 className="text-foreground mt-6 text-sm font-medium">
        {t("detail.equity.loans")}
      </h3>
      <dl>
        {asset.linkedLoans.map((loan) => (
          <Fact
            key={loan.loanKey}
            label={
              <Link
                href={`/loans/${loan.loanKey}`}
                className="text-primary font-medium underline-offset-4 hover:underline focus-visible:underline"
              >
                {loan.name}
              </Link>
            }
          >
            <span className="flex flex-col items-end">
              <Amount
                value={loan.outstandingPrincipal}
                currency={loan.currency}
                className="font-mono"
              />
              {loan.currency !== asset.currency &&
              loan.outstandingPrincipalInAssetCurrency !== null ? (
                <span className="text-muted-foreground text-xs">
                  {t.rich("detail.equity.converted", {
                    amount: () => (
                      <Amount
                        value={loan.outstandingPrincipalInAssetCurrency}
                        currency={asset.currency}
                        className="font-mono"
                      />
                    ),
                  })}
                </span>
              ) : null}
            </span>
          </Fact>
        ))}
      </dl>
    </Section>
  );
}

/** How often, and for how long after "Sync now", a wallet's page looks for new balances. */
const SYNC_POLL_MS = 5_000;
const SYNC_WATCH_MS = 120_000;

export default function AssetDetailClient({ assetId }: { assetId: string }) {
  const t = useTranslations("assets");
  const tCommon = useTranslations();
  const router = useRouter();
  const formatShortDate = useFormatShortDate();
  const formatPercentage = useFormatPercentage();
  // A wallet reads its balances in the background: while an address waits for
  // its first read, or just after "Sync now", look again every few seconds.
  const [syncRequestedAt, setSyncRequestedAt] = useState<number | null>(null);
  const { data, isPending, isError } = useManualAsset(assetId, {
    refetchInterval: (query) => {
      const wallet = query.state.data?.wallet;
      if (!wallet) return false;
      const waiting =
        wallet.addresses.some((address) => address.status === "pending") ||
        (syncRequestedAt !== null &&
          Date.now() - syncRequestedAt < SYNC_WATCH_MS);
      return waiting ? SYNC_POLL_MS : false;
    },
  });
  const walletChains = useCryptoWalletChains();
  const syncMutation = useSyncCryptoWallet();
  const updateMutation = useUpdateManualAsset();
  const deleteMutation = useDeleteManualAsset();
  const deleteValuationMutation = useDeleteValuation();
  const [editOpen, setEditOpen] = useState(false);
  const [valuationOpen, setValuationOpen] = useState(false);
  const [editingValuation, setEditingValuation] =
    useState<ManualAssetValuation | null>(null);
  // The action waiting for the reader to confirm it, if any.
  const [pending, setPending] = useState<
    | { action: "archive" }
    | { action: "delete" }
    | { action: "removeValuation"; valuation: ManualAssetValuation }
    | null
  >(null);

  if (isPending)
    return (
      <div className="space-y-4">
        <div className="bg-muted h-10 w-56 animate-pulse rounded motion-reduce:animate-none" />
        <div className="bg-muted h-40 animate-pulse rounded motion-reduce:animate-none" />
        <div className="text-muted-foreground text-sm">
          {t("detail.loading")}
        </div>
      </div>
    );
  if (isError || !data)
    return (
      <Card>
        <CardContent className="p-6">
          <div className="space-y-3">
            <h1 className="text-lg font-semibold">
              {t("detail.errors.loadFailed")}
            </h1>
            <p className="text-muted-foreground text-sm">
              {t("detail.errors.loadFailedBody")}
            </p>
            <Button variant="secondary" onClick={() => router.push("/assets")}>
              <ArrowLeft className="mr-2 size-4" />
              {t("actions.back")}
            </Button>
          </div>
        </CardContent>
      </Card>
    );

  const { asset, valuations, history } = data;
  const wallet = data.wallet ?? null;
  // A wallet's value comes from its balances: no valuation is typed or edited.
  const isWallet = isCryptoWallet(asset);
  const day = (iso: string) =>
    formatShortDate(calendarDay(iso), { alwaysShowYear: true });
  const change = changeSincePurchase(asset);
  const growthRate = asset.growthRule
    ? formatPercentage(asset.growthRule.annualRatePercent / 100, {
        maximumFractionDigits: 2,
        signDisplay: "exceptZero",
      })
    : null;

  const fail = (error: unknown) => {
    if (isDemoReadOnlyError(error)) {
      toast.error(tCommon("demo-read-only-title"), {
        description: tCommon("demo-read-only-description"),
        duration: 9000,
      });
      return;
    }
    const walletKey = walletErrorKey(error);
    toast.error(
      getApiErrorCode(error) === API_ERROR_CODE.MANUAL_ASSET_LAST_VALUATION
        ? t("detail.valuations.lastOne")
        : walletKey
          ? t(`wallet.errors.${walletKey}`)
          : (getApiErrorMessage(error) ?? tCommon("server-error")),
    );
  };

  const syncNow = async () => {
    try {
      await syncMutation.mutateAsync(asset.manualAssetKey);
      setSyncRequestedAt(Date.now());
      toast.success(t("wallet.syncQueued"));
    } catch (error) {
      fail(error);
    }
  };

  const setArchived = async (archived: boolean) => {
    try {
      await updateMutation.mutateAsync({
        manualAssetId: asset.manualAssetKey,
        payload: { archived },
      });
    } catch (error) {
      fail(error);
    }
  };

  const deleteAsset = async () => {
    try {
      await deleteMutation.mutateAsync(asset.manualAssetKey);
      router.push("/assets");
    } catch (error) {
      fail(error);
    }
  };

  const removeValuation = async (valuation: ManualAssetValuation) => {
    try {
      await deleteValuationMutation.mutateAsync({
        manualAssetId: asset.manualAssetKey,
        valuationId: valuation.manualAssetValuationKey,
      });
    } catch (error) {
      fail(error);
    }
  };

  const openValuation = (valuation: ManualAssetValuation | null) => {
    setEditingValuation(valuation);
    setValuationOpen(true);
  };
  const inOtherCurrency = asset.currency !== asset.userCurrency;

  return (
    <div className="flex flex-col gap-10 lg:gap-12">
      <ObjectHeader
        backHref="/assets"
        backLabel={t("actions.back")}
        title={asset.name}
        subtitle={t(`kinds.${asset.kind}`)}
        badges={
          <>
            {asset.isPrivate && (
              <Badge variant="muted">{t("table.private")}</Badge>
            )}
            {asset.archivedAt && (
              <Badge variant="muted">
                {t("detail.archivedOn", {
                  date: formatShortDate(asset.archivedAt, {
                    alwaysShowYear: true,
                  }),
                })}
              </Badge>
            )}
          </>
        }
        // An archived asset has no value today; its header shows what it was last worth.
        value={
          asset.archived ? (asset.lastValuation?.value ?? null) : asset.value
        }
        currency={asset.currency}
        valueLabel={
          asset.archived ? t("table.lastValued") : t("detail.valueLabel")
        }
        {...(inOtherCurrency && asset.valueInUserCurrency !== null
          ? {
              secondaryValue: asset.valueInUserCurrency,
              secondaryCurrency: asset.userCurrency,
            }
          : {})}
        actions={
          <>
            {!asset.archived && !isWallet && (
              <Button onClick={() => openValuation(null)}>
                <RefreshCw className="size-4" />
                {t("actions.updateValue")}
              </Button>
            )}
            {!asset.archived && isWallet && (
              <Button
                onClick={() => void syncNow()}
                loading={syncMutation.isPending}
              >
                <RefreshCw className="size-4" />
                {t("wallet.actions.syncNow")}
              </Button>
            )}
            <Button variant="secondary" onClick={() => setEditOpen(true)}>
              <Pencil className="size-4" />
              {t("actions.edit")}
            </Button>
          </>
        }
      >
        {!asset.archived && isEstimated(asset) && asset.lastValuation ? (
          <p className="text-muted-foreground text-sm">
            {t("detail.estimated", { date: day(asset.lastValuation.date) })}
          </p>
        ) : null}
        {isWallet && !asset.archived && asset.value === null ? (
          <p className="text-muted-foreground text-sm">
            {t("wallet.detail.noValueYet")}
          </p>
        ) : null}
        {isWallet && wallet?.lastSyncedAt ? (
          <p className="text-muted-foreground text-sm">
            {t("wallet.detail.lastSynced", {
              date: formatShortDate(wallet.lastSyncedAt, {
                alwaysShowYear: true,
                withTime: true,
              }),
            })}
          </p>
        ) : null}
        {!asset.archived &&
        inOtherCurrency &&
        asset.value !== null &&
        asset.valueInUserCurrency === null ? (
          <p role="note" className="text-muted-foreground text-sm">
            {t("summary.unconverted", {
              count: 1,
              currencies: asset.currency,
            })}
          </p>
        ) : null}
      </ObjectHeader>

      {isWallet && wallet && (
        <CryptoWalletSection
          asset={asset}
          wallet={wallet}
          chains={walletChains}
        />
      )}

      {asset.linkedLoans.length > 0 && <AssetEquity asset={asset} />}

      {history.length > 1 && (
        <Section id="asset-history-heading" title={t("detail.history.title")}>
          <ManualAssetValueChart
            history={history}
            currency={asset.currency}
            stepped={asset.growthRule === null}
          />
        </Section>
      )}

      <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_380px] xl:gap-12">
        <Section
          id="asset-valuations-heading"
          title={t("detail.valuations.title")}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-border border-b text-left">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t("detail.valuations.date")}
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">
                    {t("detail.valuations.value")}
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t("detail.valuations.note")}
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    <span className="sr-only">
                      {t("detail.valuations.actions")}
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {valuations.map((valuation) => (
                  <tr
                    key={valuation.manualAssetValuationKey}
                    className="border-border border-b"
                  >
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {day(valuation.date)}
                    </td>
                    <td className="py-2 pr-4 text-right">
                      <Amount
                        value={valuation.value}
                        currency={asset.currency}
                        className="font-mono"
                      />
                    </td>
                    <td className="text-muted-foreground max-w-64 truncate py-2 pr-4">
                      {valuation.note ?? ""}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {!isWallet && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openValuation(valuation)}
                        >
                          {t("detail.valuations.edit")}
                        </Button>
                      )}
                      {valuations.length > 1 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setPending({ action: "removeValuation", valuation })
                          }
                        >
                          {t("detail.valuations.remove")}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {isWallet && valuations.length === 0 ? (
            <p className="text-muted-foreground mt-3 text-sm">
              {t("wallet.detail.noValuations")}
            </p>
          ) : null}
        </Section>

        <Section id="asset-facts-heading" title={t("detail.facts.title")}>
          <dl>
            <Fact label={t("detail.facts.kind")}>
              {t(`kinds.${asset.kind}`)}
            </Fact>
            {asset.purchasePrice !== null || asset.purchaseDate !== null ? (
              <Fact label={t("detail.facts.purchased")}>
                {asset.purchasePrice !== null && asset.purchaseDate !== null ? (
                  t.rich("detail.facts.purchasedOn", {
                    date: day(asset.purchaseDate),
                    amount: () => (
                      <Amount
                        value={asset.purchasePrice}
                        currency={asset.currency}
                        className="font-mono"
                      />
                    ),
                  })
                ) : asset.purchasePrice !== null ? (
                  <Amount
                    value={asset.purchasePrice}
                    currency={asset.currency}
                    className="font-mono"
                  />
                ) : asset.purchaseDate !== null ? (
                  day(asset.purchaseDate)
                ) : null}
              </Fact>
            ) : null}
            {change && (
              <Fact label={t("detail.facts.changeSincePurchase")}>
                <Amount
                  value={change.amount}
                  currency={asset.currency}
                  tone="delta"
                  signed
                  className="font-mono"
                />
                {change.percent !== null && (
                  <span className="text-muted-foreground ml-2 font-mono">
                    {formatPercentage(change.percent, {
                      maximumFractionDigits: 1,
                      signDisplay: "exceptZero",
                    })}
                  </span>
                )}
              </Fact>
            )}
            {asset.growthRule && growthRate && (
              <Fact label={t("detail.facts.growth")}>
                <span className="font-mono">
                  {asset.growthRule.startDate
                    ? t("detail.facts.growthFrom", {
                        rate: growthRate,
                        date: day(asset.growthRule.startDate),
                      })
                    : growthRate}
                </span>
              </Fact>
            )}
            <Fact label={t("detail.facts.visibility")}>
              {asset.isPrivate
                ? t("detail.facts.private")
                : t("detail.facts.shared")}
            </Fact>
            {!asset.isOwner && asset.ownerFirstName && (
              <Fact label={t("detail.facts.owner")}>
                {asset.ownerFirstName}
              </Fact>
            )}
          </dl>
          {asset.notes && (
            <div className="mt-4 text-sm">
              <div className="text-muted-foreground mb-1">
                {t("detail.facts.notes")}
              </div>
              <p className="whitespace-pre-wrap">{asset.notes}</p>
            </div>
          )}
          <div className="mt-6 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              loading={updateMutation.isPending}
              onClick={() =>
                // Bringing an asset back needs no confirmation; archiving does.
                asset.archived
                  ? void setArchived(false)
                  : setPending({ action: "archive" })
              }
            >
              <Archive className="size-4" />
              {asset.archived ? t("actions.unarchive") : t("actions.archive")}
            </Button>
            <Button
              variant="ghost"
              loading={deleteMutation.isPending}
              onClick={() => setPending({ action: "delete" })}
            >
              <Trash2 className="size-4" />
              {t("actions.delete")}
            </Button>
          </div>
        </Section>
      </div>

      <ConfirmAssetAction
        title={
          pending === null
            ? null
            : pending.action === "archive"
              ? t("detail.archiveTitle")
              : pending.action === "delete"
                ? t("detail.deleteTitle")
                : t("detail.valuations.removeTitle")
        }
        description={
          pending?.action === "archive"
            ? t("detail.archiveConfirm")
            : pending?.action === "delete"
              ? t("detail.deleteConfirm")
              : t("detail.valuations.removeConfirm")
        }
        confirmLabel={
          pending?.action === "archive"
            ? t("actions.archive")
            : pending?.action === "delete"
              ? t("actions.delete")
              : t("detail.valuations.remove")
        }
        destructive={pending?.action !== "archive"}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          const confirmed = pending;
          setPending(null);
          if (confirmed?.action === "archive") void setArchived(true);
          else if (confirmed?.action === "delete") void deleteAsset();
          else if (confirmed?.action === "removeValuation")
            void removeValuation(confirmed.valuation);
        }}
      />
      <ManualAssetFormDrawer
        open={editOpen}
        onOpenChange={setEditOpen}
        asset={asset}
      />
      {!isWallet && (
        <ValuationDrawer
          open={valuationOpen}
          onOpenChange={(open) => {
            setValuationOpen(open);
            if (!open) setEditingValuation(null);
          }}
          asset={asset}
          valuation={editingValuation}
        />
      )}
    </div>
  );
}
