import {
  type QueryClient,
  useMutation,
  type UseMutationOptions,
  useQueryClient,
} from "@tanstack/react-query";

import api from "../api";
import { emailNotificationPreferenceQueryKeys } from "./queryKeys";
import type {
  EmailNotificationPreferencesApiError,
  EmailNotificationPreferencesResponse,
  UpdateEmailNotificationPreferencesInput,
} from "./types";

export interface EmailNotificationPreferencesPatchClient {
  patch: <T>(
    url: string,
    input: UpdateEmailNotificationPreferencesInput,
  ) => Promise<{ data: T }>;
}

export async function updateEmailNotificationPreferences(
  input: UpdateEmailNotificationPreferencesInput,
  apiClient: EmailNotificationPreferencesPatchClient = api,
): Promise<EmailNotificationPreferencesResponse> {
  const { data } = await apiClient.patch<EmailNotificationPreferencesResponse>(
    "/v1/user/me/email-notification-preferences",
    input,
  );
  return data;
}

export default function useUpdateEmailNotificationPreferences() {
  const queryClient = useQueryClient();

  return useMutation(
    getUpdateEmailNotificationPreferencesMutationOptions(queryClient),
  );
}

type EmailNotificationPreferencesCache = Pick<
  QueryClient,
  "invalidateQueries" | "setQueryData"
>;

export function getUpdateEmailNotificationPreferencesMutationOptions(
  queryClient: EmailNotificationPreferencesCache,
  apiClient: EmailNotificationPreferencesPatchClient = api,
): UseMutationOptions<
    EmailNotificationPreferencesResponse,
    EmailNotificationPreferencesApiError,
    UpdateEmailNotificationPreferencesInput
  > {
  return {
    mutationFn: (input) =>
      updateEmailNotificationPreferences(input, apiClient),
    scope: { id: "email-notification-preferences" },
    onSuccess: (preferences) => {
      queryClient.setQueryData(
        emailNotificationPreferenceQueryKeys.all,
        preferences,
      );
    },
    onError: () =>
      queryClient.invalidateQueries({
        queryKey: emailNotificationPreferenceQueryKeys.all,
        exact: true,
        refetchType: "active",
      }),
  };
}
