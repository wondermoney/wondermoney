import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import api, { getApiUrl } from "../api";
import type { ApiToken } from "./useApiTokens";

/**
 * The calendar feed's own credential (`/v1/user/calendar-feed-token`).
 *
 * The plain token is returned only by the reset, once. The settings page therefore shows the
 * copyable link only straight after creating or resetting it; afterwards it can show the prefix
 * and offer a reset.
 */
export interface CalendarFeedTokenStatus {
  calendarFeedToken: ApiToken | null;
}

export interface RotatedCalendarFeedToken {
  calendarFeedToken: ApiToken;
  token: string;
}

interface CalendarFeedApiClient {
  delete: typeof api.delete;
  get: typeof api.get;
  post: typeof api.post;
}

const CALENDAR_FEED_KEY = ["user", "calendar-feed-token"] as const;

/** The subscribe URL a calendar app fetches. The locale only changes the event text. */
export function calendarFeedUrl(token: string, locale: string): string {
  const params = new URLSearchParams({ locale, token });
  return `${getApiUrl()}/v1/calendar/bills.ics?${params.toString()}`;
}

export async function getCalendarFeedToken(
  apiClient: CalendarFeedApiClient = api,
): Promise<ApiToken | null> {
  const { data } = await apiClient.get<CalendarFeedTokenStatus>(
    "/v1/user/calendar-feed-token",
  );
  return data.calendarFeedToken;
}

export async function resetCalendarFeedToken(
  input: { totpCode?: string } = {},
  apiClient: CalendarFeedApiClient = api,
): Promise<RotatedCalendarFeedToken> {
  const { data } = await apiClient.post<RotatedCalendarFeedToken>(
    "/v1/user/calendar-feed-token",
    {},
    input.totpCode ? { headers: { "x-totp-code": input.totpCode } } : undefined,
  );
  return data;
}

export async function revokeCalendarFeedToken(
  apiClient: CalendarFeedApiClient = api,
): Promise<void> {
  await apiClient.delete("/v1/user/calendar-feed-token");
}

export function useCalendarFeedToken() {
  return useQuery({
    queryKey: CALENDAR_FEED_KEY,
    queryFn: () => getCalendarFeedToken(),
  });
}

export function useResetCalendarFeedToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { totpCode?: string } = {}) =>
      resetCalendarFeedToken(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CALENDAR_FEED_KEY });
    },
  });
}

export function useRevokeCalendarFeedToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => revokeCalendarFeedToken(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CALENDAR_FEED_KEY });
    },
  });
}
