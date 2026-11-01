import { notFound } from "next/navigation";

import { getAccount } from "@/lib/api/account/useAccount";
import { getAccountMetrics } from "@/lib/api/account/useAccountMetrics";
import { getAccounts } from "@/lib/api/account/useAccounts";
import { getAccountTransactions } from "@/lib/api/account/useAccountTransactions";
import { getServerApi } from "@/lib/api/api-server";
import { getConfigs } from "@/lib/api/configs/useConfigs";
import { serverDataTimestamp } from "@/lib/query/server-seed";

import AccountClient from "./account-client";

interface AccountPageProps {
  params: Promise<{ locale: string; accountId: string }>;
}

export default async function AccountPage({ params }: AccountPageProps) {
  const { locale, accountId: accountIdParam } = await params;
  const accountId = Number(accountIdParam);

  if (!accountId || Number.isNaN(accountId)) {
    notFound();
  }

  const api = await getServerApi(locale);
  const serverRenderedAt = serverDataTimestamp();

  // Server-side parallel data fetching
  const [
    accountData,
    accountsData,
    transactionsData,
    configsData,
    accountMetricsData,
  ] = await Promise.all([
      getAccount(accountId, api),
      // The client gates its first render on the accounts list too. Unseeded,
      // the server rendered a spinner and the browser (with the list cached)
      // rendered the page: a hydration mismatch on every visit.
      getAccounts(api),
      getAccountTransactions({ accountId }, api),
      getConfigs(api),
      getAccountMetrics(accountId, api),
    ]);

  return (
    <AccountClient
      accountId={accountId}
      serverRenderedAt={serverRenderedAt}
      initialAccountData={accountData}
      initialAccountsData={accountsData}
      initialTransactionsData={transactionsData}
      initialConfigsData={configsData}
      initialAccountMetricsData={accountMetricsData}
    />
  );
}
