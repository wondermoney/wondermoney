import { useMutation, useQueryClient } from "@tanstack/react-query";

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
    },
  });
};

export default useUpdatePortfolio;
