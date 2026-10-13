import { useQuery, type UseQueryOptions } from "@tanstack/react-query";

import api from "../api";
import { emailNotificationPreferenceQueryKeys } from "./queryKeys";
import type {
  EmailNotificationPreferencesApiError,
  EmailNotificationPreferencesResponse,
} from "./types";

export interface EmailNotificationPreferencesGetClient {
  get: <T>(url: string) => Promise<{ data: T }>;
}

export async function getEmailNotificationPreferences(
  apiClient: EmailNotificationPreferencesGetClient = api,
): Promise<EmailNotificationPreferencesResponse> {
  const { data } = await apiClient.get<EmailNotificationPreferencesResponse>(
    "/v1/user/me/email-notification-preferences",
  );
  return data;
}

export default function useEmailNotificationPreferences<
  R = EmailNotificationPreferencesResponse,
>(
  options?: Omit<
    UseQueryOptions<
      EmailNotificationPreferencesResponse,
      EmailNotificationPreferencesApiError,
      R
    >,
    "queryKey" | "queryFn"
  >,
) {
  return useQuery({
    queryKey: emailNotificationPreferenceQueryKeys.all,
    queryFn: () => getEmailNotificationPreferences(),
    ...options,
  });
}
