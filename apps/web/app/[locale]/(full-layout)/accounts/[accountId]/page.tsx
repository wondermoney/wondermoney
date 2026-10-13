import { notFound } from "next/navigation";

import { getAccount } from "@/lib/api/account/useAccount";
import { getAccountMetrics } from "@/lib/api/account/useAccountMetrics";
import { getAccountTransactions } from "@/lib/api/account/useAccountTransactions";
import { getServerApi } from "@/lib/api/api-server";
import { getConfigs } from "@/lib/api/configs/useConfigs";

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

  // Server-side parallel data fetching
  const [accountData, transactionsData, configsData, accountMetricsData] =
    await Promise.all([
      getAccount(accountId, api),
      getAccountTransactions({ accountId }, api),
      getConfigs(api),
      getAccountMetrics(accountId, api),
    ]);

  return (
    <AccountClient
      accountId={accountId}
      initialAccountData={accountData}
      initialTransactionsData={transactionsData}
      initialConfigsData={configsData}
      initialAccountMetricsData={accountMetricsData}
    />
  );
}
