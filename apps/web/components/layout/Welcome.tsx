"use client";

import { CheckCircle, Database, Plus, Shield } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import AccountCreateModal from "@/components/account/AccountCreateModal";
import AccountCreateOfflineModal from "@/components/account/AccountCreateOfflineModal";
import AccountCreateSyncModal from "@/components/account/AccountCreateSyncModal";
import { HelpHint } from "@/components/ui/help-hint";
import { PreviewBadge } from "@/components/ui/PreviewBadge";
import { Text } from "@/components/ui/Typography";
import { getDocsLink } from "@/lib/docs-links";
import {
  formatPreviewAmount,
  PREVIEW_ACCOUNTS,
  PREVIEW_TOTAL_BALANCE,
} from "@/lib/preview/sample-accounts";

import { Button } from "../ui/button";

// Illustrative only — this card is labelled "Preview". Institution names are
// proper nouns so they need no translation.
export default function Welcome() {
  const locale = useLocale();
  const t = useTranslations();
  const [isAccountAddModalOpen, setIsAccountAddModalOpen] = useState(false);
  const [isAddSyncAccountModalOpen, setIsAddSyncAccountModalOpen] =
    useState(false);
  const [isAddOfflineAccountModalOpen, setIsAddOfflineAccountModalOpen] =
    useState(false);

  const onAddSyncAccountClick = () => {
    setIsAccountAddModalOpen(false);
    setIsAddSyncAccountModalOpen(true);
  };

  const onAddOfflineAccountClick = () => {
    setIsAccountAddModalOpen(false);
    setIsAddOfflineAccountModalOpen(true);
  };

  const docsHref = getDocsLink("accountsTransactions", locale);

  return (
    <>
      <div className="grid min-h-[60vh] w-full items-center gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
        <div className="flex max-w-2xl flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-foreground text-2xl font-semibold tracking-tight">
              {t("connect-your-bank-account")}
            </h1>
            <p className="text-muted-foreground text-sm">
              {t("bank-connection-description")}
            </p>
          </div>

          <AccountCreateModal
            isOpen={isAccountAddModalOpen}
            setOpen={setIsAccountAddModalOpen}
            onAddSyncAccountClick={onAddSyncAccountClick}
            onAddOfflineAccountClick={onAddOfflineAccountClick}
            trigger={
              <Button className="w-fit gap-2" size="lg">
                <Plus className="size-4" />
                {t("add-account")}
              </Button>
            }
          />
          <HelpHint href={docsHref}>{t("help-hint-accounts")}</HelpHint>

          {/* Trust indicators are neutral, not green. Green is reserved for
              positive money values (Brand Section 3: "green and red are never
              decorative") — and this very component uses it on
              "+€127 this week" below, so tinting reassurance icons the same
              green makes one colour mean two things on one screen. The icon
              plus its label already carry the meaning. */}
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <Shield className="size-3.5" />
              {t("secure-bank-redirect")}
            </div>
            <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <CheckCircle className="size-3.5" />
              {t("read-only-access")}
            </div>
            <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <Database className="size-3.5" />
              {t("bank-data-updates")}
            </div>
          </div>
        </div>

        <div className="border-border bg-card rounded-lg border">
          <div className="border-border flex items-center justify-between border-b px-4 py-3">
            <span className="text-foreground text-sm font-medium">
              {t("accounts")}
            </span>
            <PreviewBadge />
          </div>
          {/* Lead with the number this screen is actually about, then the rows
              that make it up — the same data-forward shape PortfolioEmptyState
              uses, per DESIGN.md section 5. Previously this was a single
              account row, which left the column looking unfinished next to the
              copy and showed a total of nothing. */}
          <div className="border-border border-b px-4 py-4">
            <p className="text-muted-foreground text-xs font-medium tracking-[0.18em] uppercase">
              {t("total-balance")}
            </p>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-foreground min-w-0 font-mono text-2xl font-semibold tracking-tight">
                {formatPreviewAmount(PREVIEW_TOTAL_BALANCE)}
              </span>
              <span className="text-success-text font-mono text-xs font-medium">
                {t("plus-amount-this-week")}
              </span>
            </div>
          </div>
          <ul className="divide-border divide-y">
            {PREVIEW_ACCOUNTS.map((account) => (
              <li
                key={account.institution}
                className="flex items-center justify-between p-4"
              >
                <div className="flex min-w-0 items-center gap-3">
                  {/* Neutral initial chip rather than remote bank logos: no
                      network dependency in an empty state, and legible in
                      both themes. */}
                  <span
                    aria-hidden
                    className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md font-mono text-xs font-semibold"
                  >
                    {account.initials}
                  </span>
                  <Text className="text-foreground truncate text-sm">
                    {account.institution}
                  </Text>
                </div>
                <p className="text-foreground shrink-0 font-mono text-sm font-semibold">
                  {formatPreviewAmount(account.balance)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <AccountCreateSyncModal
        isOpen={isAddSyncAccountModalOpen}
        setOpen={setIsAddSyncAccountModalOpen}
      />
      <AccountCreateOfflineModal
        isOpen={isAddOfflineAccountModalOpen}
        closeModal={() => setIsAddOfflineAccountModalOpen(false)}
      />
    </>
  );
}
