import { getAccounts } from "@/lib/api/account/useAccounts";
import { getServerApi } from "@/lib/api/api-server";
import { getRecurringItems } from "@/lib/api/recurring/useRecurringItems";
import { getRecurringSummary } from "@/lib/api/recurring/useRecurringSummary";
import { serverDataTimestamp } from "@/lib/query/server-seed";

import RecurringClient from "./recurring-client";

export default async function AccountsRecurringPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const api = await getServerApi(locale);
  const serverRenderedAt = serverDataTimestamp();

  const [initialAccountsData, initialRecurringItemsData, initialRecurringSummaryData] =
    await Promise.all([
      getAccounts(api),
      getRecurringItems(api),
      getRecurringSummary(api),
    ]);
  // A Server Component renders once per request, so reading the clock here is
  // deterministic for that render; the client receives it as a prop.
  // eslint-disable-next-line react-hooks/purity
  const referenceTime = Date.now();

  return (
    <RecurringClient
      serverRenderedAt={serverRenderedAt}
      initialAccountsData={initialAccountsData}
      initialRecurringItemsData={initialRecurringItemsData}
      initialRecurringSummaryData={initialRecurringSummaryData}
      referenceTime={referenceTime}
    />
  );
}
