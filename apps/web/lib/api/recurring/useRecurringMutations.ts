import { useMutation, useQueryClient } from "@tanstack/react-query";

import { invalidateRecurring } from "@/lib/utils/queryInvalidation";

import api from "../api";
import type {
  RecurringAmountType,
  RecurringCadence,
  RecurringStatus,
  RecurringType,
} from "./useRecurringItems";

export interface UpdateRecurringRequest {
  recurringSeriesKey: number;
  displayName?: string;
  type?: RecurringType;
  status?: RecurringStatus;
  cadence?: RecurringCadence;
  amountType?: RecurringAmountType;
  expectedAmount?: number | null;
  expectedAmountMin?: number | null;
  expectedAmountMax?: number | null;
  categoryKey?: number | null;
}

export const useConfirmRecurring = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (recurringSeriesKey: number) =>
      api.post(`/v1/recurring/${recurringSeriesKey}/confirm`),
    onSuccess: () => {
      invalidateRecurring(queryClient);
    },
  });
};

export const useDismissRecurring = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (recurringSeriesKey: number) =>
      api.post(`/v1/recurring/${recurringSeriesKey}/dismiss`),
    onSuccess: () => {
      invalidateRecurring(queryClient);
    },
  });
};

export const useDetectRecurring = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/v1/recurring/detect"),
    onSuccess: () => {
      invalidateRecurring(queryClient);
    },
  });
};

export const useUpdateRecurring = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ recurringSeriesKey, ...body }: UpdateRecurringRequest) =>
      api.patch(`/v1/recurring/${recurringSeriesKey}`, body),
    onSuccess: () => {
      invalidateRecurring(queryClient);
    },
  });
};
