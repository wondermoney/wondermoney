"use client";

import { formatDistanceToNow } from "date-fns";
import {
  Lock,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Trash,
  Users,
  Wallet,
} from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useCallback, useState } from "react";

import AccountDeleteModal from "@/components/account/AccountDeleteModal";
import AccountEditSheet from "@/components/account/AccountEditSheet";
import AccountSyncBadge from "@/components/account/AccountSyncBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InspectorDrawer, PropertyList } from "@/components/ui/InspectorDrawer";
import { useRouter } from "@/i18n/navigation";
import type { Account } from "@/lib/api/account/useAccounts";
import { cn } from "@/lib/utils";
import { useFormatCurrency } from "@/lib/utils/useFormatCurrency";

import { Amount } from "../ui/Amount";

export default function AccountsList({ accounts }: { accounts: Account[] }) {
  const t = useTranslations();
  const formatCurrency = useFormatCurrency();
  const posthog = usePostHog();
  const router = useRouter();

  const [accountData, setAccountData] = useState<{
    name: string | null;
    key: number | null;
    isPrivate: boolean;
    isOwnedByViewer: boolean;
  }>({ name: null, key: null, isPrivate: false, isOwnedByViewer: false });
  const [editAccModalIsOpen, setEditAccModalIsOpen] = useState(false);
  const [deleteAccModalIsOpen, setDeleteAccModalIsOpen] = useState(false);

  const editAccOpenModal = useCallback(
    (account: Account) => {
      setAccountData({
        name: account.accountName ?? t("unknown"),
        key: account.accountKey,
        isPrivate: account.isPrivate,
        isOwnedByViewer: account.isOwnedByViewer,
      });
      setEditAccModalIsOpen(true);
      posthog.capture("edit_account_modal", { action: "opened" });
    },
    [posthog, t],
  );

  const deleteAccOpenModal = useCallback(
    (account: Account) => {
      setAccountData({
        name: account.accountName ?? t("unknown"),
        key: account.accountKey,
        isPrivate: account.isPrivate,
        isOwnedByViewer: account.isOwnedByViewer,
      });
      setDeleteAccModalIsOpen(true);
      posthog.capture("delete_account_modal", { action: "opened" });
    },
    [posthog, t],
  );

  const totalBalance = accounts.reduce<number | null>(
    (sum, account) =>
      sum === null || account.appuserCurrencyBalance === null
        ? null
        : sum + account.appuserCurrencyBalance,
    0,
  );
  const userCurrency =
    accounts[0]?.accountOwnerAppuserKey?.currencyKey?.code ?? "EUR";

  /*
   * § 9 `InspectorDrawer` (D1) — inspect a row without leaving the list.
   *
   * Clicking an account does not push `/accounts/{id}` immediately: that is the
   * pattern the archetype exists to replace, a full navigation to answer "what
   * is the IBAN on this one again?". The drawer answers that in place.
   *
   * Navigation is kept, not removed — unlike transactions, an account has a real
   * detail route with charts and its own transaction list, so the drawer carries
   * a primary action through to it rather than pretending to be it.
   */
  const [inspectedAccount, setInspectedAccount] = useState<Account | null>(null);

  return (
    <>
      <div className="divide-border divide-y">
        {accounts.map((account) => (
          <div
            key={account.accountKey}
            onClick={() => {
              posthog.capture("accounts_table_row_clicked");
              setInspectedAccount(account);
            }}
            className="hover:bg-muted/50 flex cursor-pointer items-center justify-between px-5 py-3.5 transition-colors"
          >
            <div className="flex items-center gap-3">
              {account.accountFinancialInstitutionKey?.logoUrl ? (
                <Image
                  src={account.accountFinancialInstitutionKey.logoUrl}
                  height={36}
                  width={36}
                  alt={
                    account.accountFinancialInstitutionKey.displayName ??
                    account.accountName ??
                    t("unknown")
                  }
                  className="h-9 w-9 rounded-lg"
                />
              ) : (
                <div className="bg-muted flex h-9 w-9 items-center justify-center rounded-lg">
                  <Wallet className="text-muted-foreground h-4 w-4" />
                </div>
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-foreground text-sm font-medium">
                    {account.accountName ?? t("unknown")}
                  </p>
                  {account.isPrivate && (
                    <Lock
                      className="text-muted-foreground size-3"
                      aria-label={t("account-private")}
                    />
                  )}
                </div>
                <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
                  {!account.isOwnedByViewer && account.ownerFirstName && (
                    <span className="flex items-center gap-1">
                      <Users className="h-2.5 w-2.5" />
                      {t("shared-by", { name: account.ownerFirstName })}
                    </span>
                  )}
                  {!account.isOwnedByViewer &&
                    account.ownerFirstName &&
                    account.accountFinancialInstitutionKey?.displayName && (
                      <span aria-hidden="true" className="bg-border h-3 w-px shrink-0" />
                    )}
                  {account.accountFinancialInstitutionKey?.displayName && (
                    <span className="min-w-0 truncate">
                      {account.accountFinancialInstitutionKey.displayName}
                    </span>
                  )}
                  {account.source === "open_banking" &&
                    (account.syncStatus || account.refreshedAt) && (
                      <>
                        {account.accountFinancialInstitutionKey
                          ?.displayName && <span aria-hidden="true" className="bg-border h-3 w-px shrink-0" />}
                        <AccountSyncBadge
                          syncStatus={account.syncStatus}
                          refreshedAt={account.refreshedAt}
                          className="shrink-0 whitespace-nowrap"
                        />
                      </>
                    )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="text-right">
                {/* A balance is a level: not coloured by its sign, and a
                    missing one is an em-dash rather than a sentence in the
                    column the eye scans. DESIGN.md § 9 rules 1–3. */}
                <Amount
                  value={account.appuserCurrencyBalance}
                  currency={account.accountOwnerAppuserKey.currencyKey.code}
                  className="font-mono text-sm font-medium"
                />
                {account.accountOwnerAppuserKey.currencyKey.code !==
                  account.currencyKey.code && (
                  <p className="text-muted-foreground font-mono text-xs">
                    <Amount
                      value={account.balance}
                      currency={account.currencyKey.code}
                      className="font-mono text-xs"
                    />
                  </p>
                )}
                {account.appuserCurrencyAvailableBalance !== null &&
                  account.appuserCurrencyBalance !== null &&
                  account.appuserCurrencyAvailableBalance !==
                    account.appuserCurrencyBalance && (
                    <p className="text-muted-foreground text-xs">
                      {t("available")}:{" "}
                      <span className="font-mono">
                        <Amount value={account.appuserCurrencyAvailableBalance} currency={account.accountOwnerAppuserKey.currencyKey.code} />
                      </span>
                    </p>
                  )}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="size-8 p-0"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="sr-only">{t("open-menu")}</span>
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    className="flex items-center gap-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      editAccOpenModal(account);
                    }}
                  >
                    <Pencil className="size-4" /> {t("edit")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive-text flex items-center gap-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteAccOpenModal(account);
                    }}
                  >
                    <Trash className="size-4" /> {t("delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        ))}
      </div>
      {/* Total footer */}
      <div className="border-border bg-muted/30 flex items-center justify-between border-t px-5 py-3">
        <span className="text-muted-foreground text-sm font-medium">
          {t("total")}
        </span>
        <span className="text-foreground font-mono text-sm font-semibold">
          {totalBalance === null
            ? t("total-balance-incomplete")
            : formatCurrency(totalBalance, userCurrency)}
        </span>
      </div>


        <InspectorDrawer
          open={inspectedAccount !== null}
          onOpenChange={(open) => {
            if (!open) setInspectedAccount(null);
          }}
          objectType={t("account")}
          title={inspectedAccount?.accountName ?? t("unknown")}
          subtitle={
            inspectedAccount?.accountFinancialInstitutionKey?.displayName ??
            undefined
          }
          badges={
            <>
              {inspectedAccount?.isPrivate ? (
                <Badge variant="secondary">{t("private-account")}</Badge>
              ) : null}
              {inspectedAccount &&
              (inspectedAccount.syncStatus || inspectedAccount.refreshedAt) ? (
                <AccountSyncBadge
                  syncStatus={inspectedAccount.syncStatus}
                  refreshedAt={inspectedAccount.refreshedAt}
                />
              ) : null}
            </>
          }
          actions={
            inspectedAccount ? (
              <Button
                onClick={() => {
                  const key = inspectedAccount.accountKey;
                  setInspectedAccount(null);
                  router.push(`/accounts/${key}`);
                }}
              >
                {t("account-details")}
              </Button>
            ) : null
          }
        >
          {inspectedAccount ? (
            <PropertyList
              items={[
                {
                  key: "balance",
                  label: t("balance"),
                  value: (
                    <Amount
                      value={inspectedAccount.appuserCurrencyBalance}
                      currency={
                        inspectedAccount.accountOwnerAppuserKey?.currencyKey
                          ?.code ?? userCurrency
                      }
                    />
                  ),
                },
                {
                  key: "available",
                  label: t("available"),
                  value: (
                    <Amount
                      value={inspectedAccount.appuserCurrencyAvailableBalance}
                      currency={
                        inspectedAccount.accountOwnerAppuserKey?.currencyKey
                          ?.code ?? userCurrency
                      }
                    />
                  ),
                },
              ]}
            />
          ) : null}
        </InspectorDrawer>

      {/* Edit / Delete modals */}
      {accountData.name && accountData.key !== null && (
        <>
          <AccountEditSheet
            accountKey={accountData.key}
            accountName={accountData.name}
            isOpen={editAccModalIsOpen}
            isOwnedByViewer={accountData.isOwnedByViewer}
            isPrivate={accountData.isPrivate}
            onOpenChange={(open) => {
              if (!open) {
                setEditAccModalIsOpen(false);
                setAccountData({
                  name: null,
                  key: null,
                  isPrivate: false,
                  isOwnedByViewer: false,
                });
                posthog.capture("edit_account_modal", { action: "closed" });
              }
            }}
          />
          <AccountDeleteModal
            isOpen={deleteAccModalIsOpen}
            closeModal={() => {
              setDeleteAccModalIsOpen(false);
              setAccountData({
                name: null,
                key: null,
                isPrivate: false,
                isOwnedByViewer: false,
              });
              posthog.capture("delete_account_modal", { action: "closed" });
            }}
            accountName={accountData.name}
            accountKey={accountData.key.toString()}
          />
        </>
      )}
    </>
  );
}
