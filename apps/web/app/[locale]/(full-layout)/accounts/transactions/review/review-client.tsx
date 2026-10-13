"use client";

import { usePostHog } from "posthog-js/react";
import { useState } from "react";

import AccountAddModal from "@/components/account/AccountCreateModal";
import AccountAddOfflineModal from "@/components/account/AccountCreateOfflineModal";
import AccountAddSyncModal from "@/components/account/AccountCreateSyncModal";
import AccountsTransactionsEmptyState from "@/components/account/AccountsTransactionsEmptyState";
import TransactionReviewInbox from "@/components/account/TransactionReviewInbox";
import { Spinner } from "@/components/ui/Spinner";
import type { GetAccountsResponse } from "@/lib/api/account/useAccounts";
import useAccounts from "@/lib/api/account/useAccounts";
import type { GetTransactionsResponse } from "@/lib/api/account/useTransactions";
import useTransactions from "@/lib/api/account/useTransactions";
import type { GetConfigsResponse } from "@/lib/api/configs/useConfigs";
import useConfigs from "@/lib/api/configs/useConfigs";

interface ReviewTransactionsClientProps {
  initialAccountsData: GetAccountsResponse;
  initialTransactionsData: GetTransactionsResponse;
  initialConfigsData: GetConfigsResponse;
}

export default function ReviewTransactionsClient({
  initialAccountsData,
  initialTransactionsData,
  initialConfigsData,
}: ReviewTransactionsClientProps) {
  const posthog = usePostHog();

  const [accountAddModalIsOpen, setAccountAddModalIsOpen] = useState(false);
  const [accountAddSyncModalIsOpen, setAccountAddSyncModalIsOpen] =
    useState(false);
  const [accountAddOfflineModalIsOpen, setAccountAddOfflineModalIsOpen] =
    useState(false);
  const onAddSyncAccountClick = () => {
    setAccountAddModalIsOpen(false);
    setAccountAddSyncModalIsOpen(true);
    posthog.capture("account_add_sync_modal", { action: "open" });
  };
  const closeAccountAddSyncModal = () => {
    setAccountAddSyncModalIsOpen(false);
    posthog.capture("account_add_sync_modal", { action: "close" });
  };
  const onAddOfflineAccountClick = () => {
    setAccountAddModalIsOpen(false);
    setAccountAddOfflineModalIsOpen(true);
    posthog.capture("account_add_offline_modal", { action: "open" });
  };
  const closeAccountAddOfflineModal = () => {
    setAccountAddOfflineModalIsOpen(false);
    posthog.capture("account_add_offline_modal", { action: "close" });
  };

  const { data: accountsData, isLoading: isLoadingAccountsData } = useAccounts({
    initialData: initialAccountsData,
  });

  const { data: transactionsData, isLoading: isLoadingTransactions } =
    useTransactions(
      { unreviewedOnly: true },
      {
        enabled: accountsData?.accounts && accountsData.accounts.length > 0,
        initialData: initialTransactionsData,
      },
    );

  const { data: configsData, isLoading: isLoadingConfigs } = useConfigs({
    initialData: initialConfigsData,
  });

  const isLoading =
    isLoadingAccountsData || isLoadingTransactions || isLoadingConfigs;

  const noAccounts =
    !isLoadingAccountsData &&
    accountsData?.accounts &&
    accountsData.accounts.length === 0;

  if (isLoading || !transactionsData) {
    return <Spinner />;
  }

  if (noAccounts) {
    return (
      <>
        <AccountsTransactionsEmptyState
          noAccounts
          onAddAccount={() => setAccountAddModalIsOpen(true)}
          onAddTransaction={() => undefined}
        />
        <AccountAddModal
          isOpen={accountAddModalIsOpen}
          setOpen={setAccountAddModalIsOpen}
          onAddSyncAccountClick={onAddSyncAccountClick}
          onAddOfflineAccountClick={onAddOfflineAccountClick}
          trigger={false}
        />
        <AccountAddSyncModal
          isOpen={accountAddSyncModalIsOpen}
          setOpen={closeAccountAddSyncModal}
        />
        <AccountAddOfflineModal
          isOpen={accountAddOfflineModalIsOpen}
          closeModal={closeAccountAddOfflineModal}
        />
      </>
    );
  }

  return (
    <TransactionReviewInbox
      categories={configsData?.categories ?? []}
      transactions={transactionsData.transactions}
    />
  );
}
