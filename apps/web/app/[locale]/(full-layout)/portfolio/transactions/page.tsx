import { endOfDay, startOfDay, subDays } from "date-fns";

import { getServerApi } from "@/lib/api/api-server";
import { getPortfolios } from "@/lib/api/portfolio/usePortfolios";
import { getPortfoliosTransactions } from "@/lib/api/portfolio/usePortfoliosTransactions";
import { serverDataTimestamp } from "@/lib/query/server-seed";

import PortfolioTransactionsClient from "./portfolio-transactions-client";

export default async function PortfolioTransactionsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const api = await getServerApi(locale);
  const serverRenderedAt = serverDataTimestamp();

  const defaultDateRange = {
    from: startOfDay(subDays(new Date(), 60)),
    to: endOfDay(new Date()),
  };

  const [
    portfoliosData,
    portfoliosTransactionsData,
    anyPortfoliosTransactionsData,
  ] = await Promise.all([
    getPortfolios(api),
    getPortfoliosTransactions(
      {
        fromDate: defaultDateRange.from,
        toDate: defaultDateRange.to,
      },
      api,
    ),
    getPortfoliosTransactions({ limit: 1 }, api),
  ]);

  return (
    <PortfolioTransactionsClient
      serverRenderedAt={serverRenderedAt}
      initialPortfoliosData={portfoliosData}
      initialPortfoliosTransactionsData={portfoliosTransactionsData}
      hasAnyTransactions={
        (anyPortfoliosTransactionsData.transactions?.length ?? 0) > 0
      }
      defaultDateRange={defaultDateRange}
    />
  );
}
