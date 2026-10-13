"use client";

import { ColumnDef, createColumnHelper } from "@tanstack/react-table";
import { intlFormatDistance } from "date-fns";
import { Loader2, RefreshCw, RefreshCwOff } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Table } from "@/components/ui/Table";
import { Text } from "@/components/ui/Typography";
import { saveBankAccountSyncReturnMarker } from "@/lib/account/bank-account-sync-return-marker";
import useBankList from "@/lib/api/banking/useBankList";
import useCreateRequisition from "@/lib/api/banking/useCreateRequisition";
import {
  Account,
  EnableBankingRequisition,
  getRequisitionKey,
  Requisition,
} from "@/lib/api/user/useRequisitions";
import GoCardlessBlackLogo from "@/public/gocardless-black.svg";

import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import BankConnectionUnsyncModal from "../../user/BankConnectionUnsyncModal";

/**
 * How close to (or past) `expiresAt` an Enable Banking connection has to be
 * before its row offers a "Reconnect" action (plan §5 — Enable Banking's
 * consent has a real expiry and no separate renew endpoint, so renewing
 * means starting a brand-new connection).
 */
const RENEWAL_WINDOW_DAYS = 14;

function isEnableBankingRequisition(
  requisition: Requisition,
): requisition is EnableBankingRequisition {
  return requisition.provider === "EnableBanking";
}

function needsRenewal(requisition: Requisition): boolean {
  if (!isEnableBankingRequisition(requisition) || !requisition.expiresAt) {
    return false;
  }
  const msUntilExpiry = new Date(requisition.expiresAt).getTime() - Date.now();
  return msUntilExpiry <= RENEWAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

interface ConnectionsTableProps {
  data: Requisition[];
}

const ConnectionsTable: React.FC<ConnectionsTableProps> = ({ data }) => {
  const t = useTranslations();
  const [isUnsyncAccountModalOpen, setIsUnsyncAccountModalOpen] =
    useState(false);
  const [selectedRequisitionData, setSelectedRequisitionData] = useState<{
    id: number | null;
    daysLeft: number | null;
  }>({
    id: null,
    daysLeft: null,
  });
  const accountNames = data.flatMap((r) =>
    r.accounts.map((a) => a.accountName),
  );

  const openUnsyncAccountModal = useCallback(
    (requisitionKey: number) => {
      const requisition = data.find(
        (requisition) => getRequisitionKey(requisition) === requisitionKey,
      );
      if (!requisition) {
        return;
      }
      setSelectedRequisitionData({
        id: requisitionKey,
        daysLeft: 123, // FIXME: calculate days left
      });
      setIsUnsyncAccountModalOpen(true);
    },
    [data],
  );

  // Reconnecting an Enable Banking row means starting a brand-new connection
  // flow for the same bank — there's no renew endpoint (plan §5). This
  // reuses `useCreateRequisition` exactly the way the initial bank-connect
  // flow does (see AccountCreateSyncModal.tsx): resolve the bank's id from
  // its country's bank list by name, fetch a fresh redirect URL, then send
  // the browser to the bank's consent page.
  //
  // Routed back through "accounts" (not "settings") on purpose: that page
  // already has the full post-redirect success/error handling
  // (accounts-client.tsx's `bankSyncStatus` machinery) — Settings has no
  // equivalent callback handling built yet, and duplicating it here would be
  // a much bigger change than "wire the button".
  const [reconnectTarget, setReconnectTarget] = useState<{
    key: number;
    country: string;
    name: string;
  } | null>(null);

  const { data: reconnectBankList, isError: isReconnectBankListError } =
    useBankList(reconnectTarget?.country ?? "", {
      enabled: !!reconnectTarget,
    });

  const reconnectBankId = useMemo(() => {
    if (!reconnectTarget || !reconnectBankList) return null;
    return (
      reconnectBankList.find((bank) => bank.name === reconnectTarget.name)
        ?.id ?? null
    );
  }, [reconnectTarget, reconnectBankList]);

  const bankListLoadedWithoutMatch = !!(
    reconnectTarget &&
    reconnectBankList &&
    !reconnectBankId
  );

  const {
    data: reconnectRequisitionData,
    isError: isReconnectRequisitionError,
  } = useCreateRequisition(reconnectBankId ?? "", "accounts", {
    enabled: !!reconnectBankId,
    retry: false,
  });

  useEffect(() => {
    if (reconnectRequisitionData?.redirectUrl) {
      saveBankAccountSyncReturnMarker("accounts");
      window.location.href = reconnectRequisitionData.redirectUrl;
    }
  }, [reconnectRequisitionData?.redirectUrl]);

  useEffect(() => {
    if (!reconnectTarget) return;
    if (
      isReconnectBankListError ||
      isReconnectRequisitionError ||
      bankListLoadedWithoutMatch
    ) {
      toast.error(t("reconnect-error"));
      setReconnectTarget(null);
    }
  }, [
    reconnectTarget,
    isReconnectBankListError,
    isReconnectRequisitionError,
    bankListLoadedWithoutMatch,
    t,
  ]);

  const onReconnectClick = useCallback(
    (requisition: EnableBankingRequisition) => {
      setReconnectTarget({
        key: requisition.enableBankingConnectionKey,
        country: requisition.aspspCountry,
        name: requisition.aspspName,
      });
    },
    [],
  );

  const columnHelper = createColumnHelper<Requisition>();
  const columns: ColumnDef<Requisition, any>[] = [
    columnHelper.accessor("provider", {
      header: t("provider"),
      cell: (info) => {
        const requisition = info.row.original;
        if (isEnableBankingRequisition(requisition)) {
          return requisition.institution.logoUrl ? (
            <Image
              src={requisition.institution.logoUrl}
              alt={requisition.institution.name}
              width={120}
              height={18}
              style={{ objectFit: "contain" }}
            />
          ) : (
            <Text variant="smallText">{requisition.institution.name}</Text>
          );
        }
        return (
          <Image
            src={GoCardlessBlackLogo.src}
            alt="gocardless"
            width={120}
            height={18}
          />
        );
      },
    }),
    columnHelper.accessor("accounts", {
      header: t("accounts"),
      cell: (info) =>
        info.getValue().length > 0 && (
          <ul className="list-inside list-disc space-y-2">
            {info.getValue().map((acc: Account) => (
              <Text
                as="li"
                variant="smallText"
                key={acc.accountKey}
                className="whitespace-nowrap"
              >
                {acc.accountName}
              </Text>
            ))}
          </ul>
        ),
    }),
    columnHelper.accessor("expiresAt", {
      header: t("expires"),
      // Shared field name across both providers (see useRequisitions.ts) —
      // this rendering logic doesn't need to know which provider a row is.
      cell: (info) =>
        info.getValue() ? (
          <Text variant="span">
            {intlFormatDistance(new Date(info.getValue()), new Date(), {
              unit: "day",
            })}
          </Text>
        ) : null,
    }),
    columnHelper.accessor("status", {
      header: t("status"),
      cell: (info) => {
        switch (info.getValue()) {
          case "created":
            return <Badge variant="secondary">{t("created")}</Badge>;
          case "authorized":
            return <Badge variant="secondary">{t("authorized")}</Badge>;
          case "linked":
            return <Badge>{t("linked")}</Badge>;
          case "error":
            return <Badge variant="destructive">{t("error")}</Badge>;
          case "expired":
            return <Badge variant="warning">{t("expired")}</Badge>;
          default:
            return <Text variant="span">{t("unknown")}</Text>;
        }
      },
    }),
    columnHelper.display({
      header: t("actions"),
      id: "actions",
      cell: ({ row }) => {
        const requisition = row.original;
        const showReconnect =
          isEnableBankingRequisition(requisition) &&
          needsRenewal(requisition);
        const isReconnectingThisRow =
          reconnectTarget?.key === getRequisitionKey(requisition);

        return (
          <div className="flex items-center gap-2">
            {showReconnect ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={isReconnectingThisRow}
                onClick={() =>
                  onReconnectClick(requisition as EnableBankingRequisition)
                }
              >
                {isReconnectingThisRow ? (
                  <Loader2
                    className="size-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <RefreshCw className="size-4" aria-hidden="true" />
                )}
                {t("reconnect")}
              </Button>
            ) : null}
            <RefreshCwOff
              onClick={() =>
                openUnsyncAccountModal(getRequisitionKey(requisition))
              }
            />
          </div>
        );
      },
    }),
  ];

  return (
    <>
      <Table columns={columns} data={data} />
      {selectedRequisitionData &&
      selectedRequisitionData.id &&
      selectedRequisitionData.daysLeft ? (
        <BankConnectionUnsyncModal
          isOpen={isUnsyncAccountModalOpen}
          closeModal={() => setIsUnsyncAccountModalOpen(false)}
          requisitionData={
            { ...selectedRequisitionData, accountNames } as any
          }
        />
      ) : null}
    </>
  );
};

export default ConnectionsTable;
