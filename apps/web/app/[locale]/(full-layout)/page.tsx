import Axios from "axios";

import { getAccounts } from "@/lib/api/account/useAccounts";
import { getTransactions } from "@/lib/api/account/useTransactions";
import { getServerApi } from "@/lib/api/api-server";
import { getBudgetsFull } from "@/lib/api/budget/useBudgetsFull";
import { getPortfolios } from "@/lib/api/portfolio/usePortfolios";
import { getRateLimitInfo } from "@/lib/api/rate-limit";
import { serverDataTimestamp } from "@/lib/query/server-seed";

import { HomeClient } from "./home-client";

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const api = await getServerApi(locale);
  const serverRenderedAt = serverDataTimestamp();

  let data;
  try {
    data = await Promise.all([
      getAccounts(api),
      getPortfolios(api),
      getBudgetsFull(api),
      getTransactions({ includeEmptyAccounts: true, limit: 1 }, api),
      getTransactions(
        { includeEmptyAccounts: true, limit: 1, unreviewedOnly: true },
        api,
      ),
    ]);
  } catch (error) {
    const rateLimit = getRateLimitInfo(error);

    if (
      rateLimit ||
      (Axios.isAxiosError(error) && (error.response?.status ?? 0) >= 500)
    ) {
      const status = Axios.isAxiosError(error)
        ? error.response?.status
        : undefined;

      console.error("[Home SSR] initial dashboard fetch failed", {
        status,
        url: Axios.isAxiosError(error) ? error.config?.url : undefined,
        method: Axios.isAxiosError(error) ? error.config?.method : undefined,
      });

      return (
        <HomeClient
          initialDataStatus="unavailable"
          initialErrorStatus={status}
          // Threaded so the client can count the window down rather than
          // showing the boundary's generic "something went wrong".
          initialRetryAfterSeconds={rateLimit?.retryAfterSeconds}
        />
      );
    }

    throw error;
  }

  const [
    accountsData,
    portfoliosData,
    budgetsData,
    transactionsData,
    unreviewedTransactionsData,
  ] = data;

  return (
    <HomeClient
      serverRenderedAt={serverRenderedAt}
      initialAccountsData={accountsData}
      initialPortfoliosData={portfoliosData}
      initialBudgetsData={budgetsData}
      initialTransactionsData={transactionsData}
      initialUnreviewedTransactionsData={unreviewedTransactionsData}
    />
  );
}
