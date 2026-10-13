import { getAccounts } from "@/lib/api/account/useAccounts";
import { getServerApi } from "@/lib/api/api-server";
import { getConfigs } from "@/lib/api/configs/useConfigs";

import AccountsClient from "./accounts-client";

export default async function AccountsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const api = await getServerApi(locale);

  // Server-side parallel data fetching
  const [accountsData, configsData] = await Promise.all([
    getAccounts(api),
    getConfigs(api),
  ]);

  return (
    <AccountsClient
      initialAccountsData={accountsData}
      initialConfigsData={configsData}
    />
  );
}
