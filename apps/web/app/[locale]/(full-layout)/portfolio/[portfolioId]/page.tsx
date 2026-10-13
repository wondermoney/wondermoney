import { notFound } from "next/navigation";

import { getServerApi } from "@/lib/api/api-server";
import { getPortfolio } from "@/lib/api/portfolio/usePortfolio";

import PortfolioClient from "./portfolio-client";

interface PortfolioPageProps {
  params: Promise<{ locale: string; portfolioId: string }>;
}

export default async function PortfolioPage({ params }: PortfolioPageProps) {
  const { locale, portfolioId: portfolioIdParam } = await params;
  const portfolioId = Number(portfolioIdParam);

  if (!portfolioId || Number.isNaN(portfolioId)) {
    notFound();
  }

  const api = await getServerApi(locale);

  const portfolioData = await getPortfolio(portfolioId, api);

  return (
    <PortfolioClient
      portfolioId={portfolioId}
      initialPortfolioData={portfolioData}
    />
  );
}
