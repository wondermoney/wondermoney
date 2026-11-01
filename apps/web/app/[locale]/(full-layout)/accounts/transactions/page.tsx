import { endOfDay, startOfDay, subDays } from "date-fns";

import { getAccounts } from "@/lib/api/account/useAccounts";
import { getTransactions } from "@/lib/api/account/useTransactions";
import { getServerApi } from "@/lib/api/api-server";
import { getConfigs } from "@/lib/api/configs/useConfigs";
import { serverDataTimestamp } from "@/lib/query/server-seed";

import AccountsTransactionsClient from "./transactions-client";

export default async function AccountsTransactionsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const api = await getServerApi(locale);
  const serverRenderedAt = serverDataTimestamp();

  // Server-side parallel data fetching with default date range
  const defaultDateRange = {
    from: startOfDay(subDays(new Date(), 60)),
    to: endOfDay(new Date()),
  };

  const [accountsData, transactionsData, configsData] = await Promise.all([
    getAccounts(api),
    getTransactions(
      { fromDate: defaultDateRange.from, toDate: defaultDateRange.to },
      api,
    ),
    getConfigs(api),
  ]);

  return (
    <AccountsTransactionsClient
      serverRenderedAt={serverRenderedAt}
      initialAccountsData={accountsData}
      initialTransactionsData={transactionsData}
      initialConfigsData={configsData}
      defaultDateRange={defaultDateRange}
    />
  );
}
