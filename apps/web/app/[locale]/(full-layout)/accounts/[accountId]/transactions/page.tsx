import { endOfDay, startOfDay, subDays } from "date-fns";
import { notFound } from "next/navigation";

import { getAccount } from "@/lib/api/account/useAccount";
import { getAccountForecast } from "@/lib/api/account/useAccountForecast";
import { getAccountTransactions } from "@/lib/api/account/useAccountTransactions";
import { getServerApi } from "@/lib/api/api-server";
import { getConfigs } from "@/lib/api/configs/useConfigs";
import { serverDataTimestamp } from "@/lib/query/server-seed";

import AccountTransactionsClient from "./account-transactions-client";

interface AccountTransactionsPageProps {
  params: Promise<{
    locale: string;
    accountId: string;
    showUnreviewedOnly?: string;
  }>;
}

export default async function AccountTransactionsPage({
  params,
}: AccountTransactionsPageProps) {
  const { locale, accountId: accountIdParam, showUnreviewedOnly } = await params;
  const accountId = Number(accountIdParam);

  if (!accountId || Number.isNaN(accountId)) {
    notFound();
  }

  const api = await getServerApi(locale);
  const serverRenderedAt = serverDataTimestamp();

  const defaultDateRange = {
    from: startOfDay(subDays(new Date(), 60)),
    to: endOfDay(new Date()),
  };

  const [
    accountData,
    transactionsData,
    anyTransactionsData,
    configsData,
    forecastData,
  ] = await Promise.all([
      getAccount(accountId, api),
      getAccountTransactions(
        {
          accountId,
          unreviewedOnly: Boolean(showUnreviewedOnly),
          fromDate: defaultDateRange.from,
          toDate: defaultDateRange.to,
        },
        api,
      ),
      getAccountTransactions({ accountId, limit: 1 }, api),
      getConfigs(api),
      getAccountForecast({ accountKeys: [accountId], days: 30 }, api),
    ]);

  return (
    <AccountTransactionsClient
      accountId={accountId}
      showUnreviewedOnly={Boolean(showUnreviewedOnly)}
      serverRenderedAt={serverRenderedAt}
      initialAccountData={accountData}
      initialTransactionsData={transactionsData}
      initialConfigsData={configsData}
      initialForecastData={forecastData}
      hasAnyTransactions={(anyTransactionsData.transactions?.length ?? 0) > 0}
      defaultDateRange={defaultDateRange}
    />
  );
}
