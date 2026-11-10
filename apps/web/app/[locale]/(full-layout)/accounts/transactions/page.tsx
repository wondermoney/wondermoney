import { endOfDay, startOfDay, subDays } from "date-fns";

import { parseTransactionReportScope } from "@/lib/account/transaction-report-scope";
import { getAccounts } from "@/lib/api/account/useAccounts";
import { getTransactions } from "@/lib/api/account/useTransactions";
import { getServerApi } from "@/lib/api/api-server";
import { getConfigs } from "@/lib/api/configs/useConfigs";
import { serverDataTimestamp } from "@/lib/query/server-seed";

import AccountsTransactionsClient from "./transactions-client";

export default async function AccountsTransactionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  // A report total links here with its scope, so the list holds exactly its rows.
  const reportScope = parseTransactionReportScope(await searchParams);
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
      // A new scope (or none, from "Show all transactions") starts the page
      // afresh: its date range and table filters belong to the old one.
      key={reportScope ? JSON.stringify(reportScope) : "all"}
      serverRenderedAt={serverRenderedAt}
      initialAccountsData={accountsData}
      initialTransactionsData={transactionsData}
      initialConfigsData={configsData}
      defaultDateRange={defaultDateRange}
      reportScope={reportScope}
    />
  );
}
