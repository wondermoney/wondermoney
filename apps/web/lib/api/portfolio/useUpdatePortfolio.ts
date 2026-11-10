import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { PortfolioAccountLinkInput } from "@/lib/portfolio/account-link";

import api from "../api";

interface UpdatePortfolioRequest {
  portfolioId: number;
  name?: string;
  description?: string | null;
  currencyId?: string;
  excluded?: boolean;
  favored?: boolean;
  benchmarkSymbol?: string;
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
      // A link changes what net worth counts.
      queryClient.invalidateQueries({ queryKey: ["net-worth"] });
      queryClient.invalidateQueries({ queryKey: ["net-worth-history"] });
    },
  });
};

export default useUpdatePortfolio;
