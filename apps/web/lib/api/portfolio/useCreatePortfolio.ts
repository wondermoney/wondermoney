import { useMutation, useQueryClient } from "@tanstack/react-query";

import api from "../api";
import { getPortfolioCreateInvalidationKeys } from "./portfolioInvalidation";

interface CreatePortfolioRequest {
  name: string;
  currencyId: string;
  broker?: string;
}

interface CreatePortfolioResponse {
  portfolio: {
    portfolioKey: number;
  };
}

const useCreatePortfolio = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ name, currencyId, broker }: CreatePortfolioRequest) =>
      api.post<CreatePortfolioResponse>(`/v1/portfolio/`, {
        name,
        currencyId,
        broker,
      }),
    onSuccess: () => {
      for (const queryKey of getPortfolioCreateInvalidationKeys()) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
};

export default useCreatePortfolio;
