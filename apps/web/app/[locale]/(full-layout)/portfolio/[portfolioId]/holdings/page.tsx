import { notFound } from "next/navigation";

import { getServerApi } from "@/lib/api/api-server";
import { getPortfolioHoldings } from "@/lib/api/portfolio/usePortfolioHoldings";

import PortfolioHoldingsClient from "./portfolio-holdings-client";

interface PortfolioHoldingsPageProps {
  params: Promise<{ locale: string; portfolioId: string }>;
}

export default async function PortfolioHoldingsPage({
  params,
}: PortfolioHoldingsPageProps) {
  const { locale, portfolioId } = await params;

  if (!portfolioId) {
    notFound();
  }

  const api = await getServerApi(locale);

  const portfolioHoldingsData = await getPortfolioHoldings(portfolioId, api);

  return (
    <PortfolioHoldingsClient
      portfolioId={portfolioId}
      initialPortfolioHoldingsData={portfolioHoldingsData}
    />
  );
}
