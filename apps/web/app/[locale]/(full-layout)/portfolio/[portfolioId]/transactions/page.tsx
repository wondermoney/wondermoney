import { endOfDay, startOfDay, subDays } from "date-fns";
import { notFound } from "next/navigation";

import { getServerApi } from "@/lib/api/api-server";
import { getPortfolioTransactions } from "@/lib/api/portfolio/usePortfolioTransactions";

import PortfolioTransactionsClient from "./portfolio-transactions-client";

interface PortfolioTransactionsPageProps {
  params: Promise<{ locale: string; portfolioId: string }>;
  searchParams: Promise<{ import?: string }>;
}

export default async function PortfolioTransactionsPage({
  params,
  searchParams,
}: PortfolioTransactionsPageProps) {
  const [{ locale, portfolioId }, { import: importMode }] = await Promise.all([
    params,
    searchParams,
  ]);

  if (!portfolioId) {
    notFound();
  }

  const api = await getServerApi(locale);

  const defaultDateRange = {
    from: startOfDay(subDays(new Date(), 60)),
    to: endOfDay(new Date()),
  };

  const [portfolioTransactionsData, anyPortfolioTransactionsData] =
    await Promise.all([
      getPortfolioTransactions(
        {
          portfolioId,
          fromDate: defaultDateRange.from,
          toDate: defaultDateRange.to,
        },
        api,
      ),
      getPortfolioTransactions({ portfolioId, limit: 1 }, api),
    ]);

  return (
    <PortfolioTransactionsClient
      portfolioId={portfolioId}
      initialPortfolioTransactionsData={portfolioTransactionsData}
      hasAnyTransactions={
        (anyPortfolioTransactionsData.transactions?.length ?? 0) > 0
      }
      defaultDateRange={defaultDateRange}
      initialImportOpen={importMode === "1"}
    />
  );
}
