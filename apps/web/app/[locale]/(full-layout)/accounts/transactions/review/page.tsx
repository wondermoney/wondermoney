import { getAccounts } from "@/lib/api/account/useAccounts";
import { getTransactions } from "@/lib/api/account/useTransactions";
import { getServerApi } from "@/lib/api/api-server";
import { getConfigs } from "@/lib/api/configs/useConfigs";
import { serverDataTimestamp } from "@/lib/query/server-seed";

import ReviewTransactionsClient from "./review-client";

export default async function ReviewTransactionsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const api = await getServerApi(locale);
  const serverRenderedAt = serverDataTimestamp();

  const [accountsData, transactionsData, configsData] = await Promise.all([
    getAccounts(api),
    getTransactions({ unreviewedOnly: true }, api),
    getConfigs(api),
  ]);

  return (
    <ReviewTransactionsClient
      serverRenderedAt={serverRenderedAt}
      initialAccountsData={accountsData}
      initialTransactionsData={transactionsData}
      initialConfigsData={configsData}
    />
  );
}
