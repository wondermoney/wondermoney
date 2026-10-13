import { QueryCache, QueryClient } from "@tanstack/react-query";
import { AxiosError } from "axios";
import posthog from "posthog-js";

import { getRateLimitInfo } from "@/lib/api/rate-limit";
import { rateLimitCoordinator } from "@/lib/api/rate-limit-coordinator";
import {
  buildLocalizedLoginPath,
  deriveAuthLocaleFromPathname,
} from "@/lib/auth/auth-error-redirect";
import { clearBetterAuthCookies } from "@/lib/auth/clear-client-auth";
import { authClient } from "@/lib/auth/client";
import { SENTRY_CLIENT_ENABLED } from "@/lib/utils/sentry-enabled";

let consecutive401Count = 0;
let forcedLogoutInProgress = false;
const CONSECUTIVE_401_THRESHOLD = 2;

function handleForcedLogout(error: AxiosError, queryClient: QueryClient) {
  if (forcedLogoutInProgress) return;
  forcedLogoutInProgress = true;

  if (SENTRY_CLIENT_ENABLED) {
    void import("@/lib/utils/sentry-client")
      .then(({ captureClientException }) => {
        captureClientException(error, {
          tags: { type: "forced_logout", reason: "consecutive_401_errors" },
          extra: {
            consecutive401Count,
            requestUrl: error.config?.url,
            requestMethod: error.config?.method,
          },
        });
      })
      .catch(() => {});
  }

  consecutive401Count = 0;
  const loginPath = buildLocalizedLoginPath(
    deriveAuthLocaleFromPathname(window.location.pathname),
  );

  try {
    clearBetterAuthCookies();

    void queryClient.cancelQueries().catch((queryCancelError) => {
      console.error(
        "Error cancelling queries during forced logout",
        queryCancelError,
      );
    });
    queryClient.clear();

    void authClient.signOut().catch((signOutError) => {
      console.error("Error signing out during forced logout", signOutError);
    });

    posthog.reset();
  } catch (logoutError) {
    if (!(logoutError instanceof Error)) throw logoutError;
    console.error("Error during forced logout cleanup", logoutError);
  } finally {
    window.location.assign(loginPath);
  }
}

function makeQueryClient() {
  let queryClient: QueryClient;
  const queryCache = new QueryCache({
    onError(error) {
      console.log("[QueryCache] onError triggered", error);
      if (error instanceof AxiosError) {
        console.log(
          "[QueryCache] AxiosError detected, status:",
          error.response?.status,
        );
        if (error.response?.status === 401) {
          consecutive401Count++;
          console.log("[QueryCache] 401 error count:", consecutive401Count);
          if (consecutive401Count >= CONSECUTIVE_401_THRESHOLD) {
            console.log(
              "[QueryCache] Threshold reached, triggering forced logout",
            );
            void handleForcedLogout(error, queryClient);
          }
        } else {
          consecutive401Count = 0;
        }
      }
    },
    onSuccess() {
      consecutive401Count = 0;
    },
  });

  queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        retry: (failureCount, error) => {
          if (error instanceof AxiosError && error.response?.status === 401) {
            return false;
          }
          return failureCount < 2;
        },
        refetchOnWindowFocus: false,
      },
    },
    queryCache,
  });

  return queryClient;
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient() {
  if (typeof window === "undefined") return makeQueryClient();
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}
