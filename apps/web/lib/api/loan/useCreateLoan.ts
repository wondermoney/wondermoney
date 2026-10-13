import { useMutation, useQueryClient } from "@tanstack/react-query";

import api from "../api";
import type { CreateLoanRequest } from "./types";

const useCreateLoan = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateLoanRequest) => api.post(`/v1/loan`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["loans"] });
      queryClient.invalidateQueries({ queryKey: ["loans", "overview"] });
      queryClient.invalidateQueries({ queryKey: ["net-worth"] });
    },
  });
};

export default useCreateLoan;
