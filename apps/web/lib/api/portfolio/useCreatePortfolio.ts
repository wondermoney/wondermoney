import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { PortfolioAccountLinkInput } from "@/lib/portfolio/account-link";

import api from "../api";
import { getPortfolioCreateInvalidationKeys } from "./portfolioInvalidation";

interface CreatePortfolioRequest {
  name: string;
  currencyId: string;
  broker?: string;
  accountLink?: PortfolioAccountLinkInput | null;
}

interface CreatePortfolioResponse {
  portfolio: {
    portfolioKey: number;
  };
}

const useCreatePortfolio = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ name, currencyId, broker, accountLink }: CreatePortfolioRequest) =>
      api.post<CreatePortfolioResponse>(`/v1/portfolio/`, {
        name,
        currencyId,
        broker,
        ...(accountLink ? { accountLink } : {}),
      }),
    onSuccess: () => {
      for (const queryKey of getPortfolioCreateInvalidationKeys()) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
};

export default useCreatePortfolio;
