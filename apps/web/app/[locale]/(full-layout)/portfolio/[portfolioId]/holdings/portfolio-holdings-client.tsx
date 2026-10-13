"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import PortfolioHoldingsEmptyState from "@/components/portfolio/PortfolioHoldingsEmptyState";
import PortfolioHoldingsTable from "@/components/portfolio/PortfolioHoldingsTable";
import PortfolioTransactionAddModal from "@/components/portfolio/PortfolioTransactionAddModal";
import { Spinner } from "@/components/ui/Spinner";
import type { GetPortfolioHoldingsResponse } from "@/lib/api/portfolio/usePortfolioHoldings";
import usePortfolioHoldings from "@/lib/api/portfolio/usePortfolioHoldings";

interface PortfolioHoldingsClientProps {
  portfolioId: string;
  initialPortfolioHoldingsData: GetPortfolioHoldingsResponse;
}

export default function PortfolioHoldingsClient({
  portfolioId,
  initialPortfolioHoldingsData,
}: PortfolioHoldingsClientProps) {
  const t = useTranslations();
  const [isAddTransactionOpen, setIsAddTransactionOpen] = useState(false);

  const {
    data: portfoliosHoldingsData,
    isLoading: isLoadingPortfoliosHoldings,
  } = usePortfolioHoldings(portfolioId, {
    initialData: initialPortfolioHoldingsData,
  });

  if (isLoadingPortfoliosHoldings) {
    return (
      <div className="flex h-[100px] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const noHoldings =
    !portfoliosHoldingsData?.holdings ||
    portfoliosHoldingsData.holdings.length === 0;

  if (noHoldings) {
    return (
      <>
        <PortfolioHoldingsEmptyState
          onCreatePortfolio={() => setIsAddTransactionOpen(true)}
        />
        <PortfolioTransactionAddModal
          isOpen={isAddTransactionOpen}
          setOpen={setIsAddTransactionOpen}
          defaultPortfolioId={portfolioId}
          trigger={<span />}
        />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-foreground text-xl font-semibold tracking-tight">
        {t("holdings")}
      </h1>
      <section className="border-border bg-card rounded-lg border">
        <PortfolioHoldingsTable
          transactions={portfoliosHoldingsData?.holdings ?? []}
          portfolioId={portfolioId}
        />
      </section>
    </div>
  );
}
