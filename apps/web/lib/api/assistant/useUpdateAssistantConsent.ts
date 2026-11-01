import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AxiosInstance } from "axios";

import api from "../api";
import type { AssistantConsent } from "./types";

export interface UpdateAssistantConsentInput {
  assistantEnabled: boolean;
  launcherHidden?: boolean;
}

export interface UpdateAssistantConsentResponse {
  consent: AssistantConsent;
}

async function updateAssistantConsent(
  input: UpdateAssistantConsentInput,
  apiClient: AxiosInstance = api,
): Promise<AssistantConsent> {
  const { data } = await apiClient.post<UpdateAssistantConsentResponse>(
    "/v1/assistant/consent",
    input,
  );
  return data.consent;
}

export default function useUpdateAssistantConsent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateAssistantConsentInput) =>
      updateAssistantConsent(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assistant", "consent"] });
    },
  });
}
