import type { NextPage } from "next";
import { getTranslations } from "next-intl/server";

import FinancialMarketsWatchlist from "@/components/financial-market/FinancialMarketsWatchlist";
import { createMetadata } from "@/lib/utils/metadata";

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ locale: string }>;
}) => {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "navigation" });

  return createMetadata({ title: t("watchlist"), description: t("watchlist") });
};

const Watchlist: NextPage = () => {
  return <FinancialMarketsWatchlist />;
};

export default Watchlist;
