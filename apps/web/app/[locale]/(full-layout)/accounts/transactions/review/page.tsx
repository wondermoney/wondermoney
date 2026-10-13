import { getAccounts } from "@/lib/api/account/useAccounts";
import { getTransactions } from "@/lib/api/account/useTransactions";
import { getServerApi } from "@/lib/api/api-server";
import { getConfigs } from "@/lib/api/configs/useConfigs";

import ReviewTransactionsClient from "./review-client";

export default async function ReviewTransactionsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const api = await getServerApi(locale);

  const [accountsData, transactionsData, configsData] = await Promise.all([
    getAccounts(api),
    getTransactions({ unreviewedOnly: true }, api),
    getConfigs(api),
  ]);

  return (
    <ReviewTransactionsClient
      initialAccountsData={accountsData}
      initialTransactionsData={transactionsData}
      initialConfigsData={configsData}
    />
  );
}
