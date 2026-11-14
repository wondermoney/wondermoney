import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { PortfolioAccountLinkInput } from "@/lib/portfolio/account-link";

import api from "../api";
import type { PortfolioCostBasisMethod } from "./usePortfolio";

interface UpdatePortfolioRequest {
  portfolioId: number;
  name?: string;
  description?: string | null;
  currencyId?: string;
  costBasisMethod?: PortfolioCostBasisMethod;
  excluded?: boolean;
  benchmarkSymbol?: string | null;
  targetAllocation?: Record<string, number> | null;
  accountLink?: PortfolioAccountLinkInput | null;
}

const useUpdatePortfolio = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ portfolioId, ...body }: UpdatePortfolioRequest) =>
      api.put(`/v1/portfolio/${portfolioId}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portfolios"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-allocation"] });
      // A cost basis method change re-prices every holding and realized gain.
      queryClient.invalidateQueries({ queryKey: ["portfolio-holdings"] });
      queryClient.invalidateQueries({ queryKey: ["portfolios-holdings"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-holding-lots"] });
      queryClient.invalidateQueries({ queryKey: ["realized-gains"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-metrics"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-performance"] });
      // "Exclude from aggregate dashboard" changes every combined figure.
      queryClient.invalidateQueries({ queryKey: ["portfolio-top-movers"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-calendar"] });
      queryClient.invalidateQueries({ queryKey: ["dividend-income"] });
      // A link changes what net worth counts.
      queryClient.invalidateQueries({ queryKey: ["net-worth"] });
      queryClient.invalidateQueries({ queryKey: ["net-worth-history"] });
    },
  });
};

export default useUpdatePortfolio;
