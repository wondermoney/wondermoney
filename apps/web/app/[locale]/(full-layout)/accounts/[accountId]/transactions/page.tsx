import { endOfDay, startOfDay, subDays } from "date-fns";
import { notFound } from "next/navigation";

import { getAccount } from "@/lib/api/account/useAccount";
import { getAccountTransactions } from "@/lib/api/account/useAccountTransactions";
import { getServerApi } from "@/lib/api/api-server";
import { getConfigs } from "@/lib/api/configs/useConfigs";

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

  const defaultDateRange = {
    from: startOfDay(subDays(new Date(), 60)),
    to: endOfDay(new Date()),
  };

  const [accountData, transactionsData, anyTransactionsData, configsData] =
    await Promise.all([
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
    ]);

  return (
    <AccountTransactionsClient
      accountId={accountId}
      showUnreviewedOnly={Boolean(showUnreviewedOnly)}
      initialAccountData={accountData}
      initialTransactionsData={transactionsData}
      initialConfigsData={configsData}
      hasAnyTransactions={(anyTransactionsData.transactions?.length ?? 0) > 0}
      defaultDateRange={defaultDateRange}
    />
  );
}
