import { getAccounts } from "@/lib/api/account/useAccounts";
import { getServerApi } from "@/lib/api/api-server";
import { getRecurringItems } from "@/lib/api/recurring/useRecurringItems";
import { getRecurringSummary } from "@/lib/api/recurring/useRecurringSummary";

import RecurringClient from "./recurring-client";

export default async function AccountsRecurringPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const api = await getServerApi(locale);

  const [initialAccountsData, initialRecurringItemsData, initialRecurringSummaryData] =
    await Promise.all([
      getAccounts(api),
      getRecurringItems(api),
      getRecurringSummary(api),
    ]);
  const referenceTime = Date.now();

  return (
    <RecurringClient
      initialAccountsData={initialAccountsData}
      initialRecurringItemsData={initialRecurringItemsData}
      initialRecurringSummaryData={initialRecurringSummaryData}
      referenceTime={referenceTime}
    />
  );
}
