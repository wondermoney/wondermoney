import { useMutation, useQueryClient } from "@tanstack/react-query";

import api from "../api";

interface OnboardingResponse {}

const updateOnboarding = async (userId: string, stepId: number) => {
  const { data } = await api.post<OnboardingResponse>(
    `/v1/user/${userId}/onboarding/${stepId}/complete`,
  );
  return data;
};

export default function useUpdateOnboarding(params: {
  userId: string;
  stepId: number;
}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => updateOnboarding(params.userId, params.stepId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["onboarding", params.userId],
      });
    },
  });
}
