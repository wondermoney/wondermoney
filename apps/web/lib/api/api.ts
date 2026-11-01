import Axios, { type InternalAxiosRequestConfig } from "axios";

import { attachRateLimitInfo } from "@/lib/api/rate-limit";
import { authClient } from "@/lib/auth/client";
import { env } from "@/lib/utils/env";

type AuthRetryRequestConfig = InternalAxiosRequestConfig & {
  _authRetry?: boolean;
};

let sessionRevalidationPromise: Promise<boolean> | null = null;

function isBrowserRequest(): boolean {
  return typeof window !== "undefined";
}

function isGetRequest(request: AuthRetryRequestConfig): boolean {
  return (request.method ?? "get").toLowerCase() === "get";
}

// better-auth's session cookie is opaque and has no client-driven refresh
// flow. On a 401 the best we can do is ask
// the better-auth server whether the (cookie-based) session is still valid
// — if it isn't, the session is effectively gone and we surface the error.
async function revalidateSession(): Promise<boolean> {
  if (!sessionRevalidationPromise) {
    sessionRevalidationPromise = authClient
      .getSession()
      .then(({ data, error }) => {
        if (error || !data?.session) {
          return false;
        }

        return true;
      })
      .catch((error) => {
        console.error("Error revalidating better-auth session", error);
        return false;
      })
      .finally(() => {
        sessionRevalidationPromise = null;
      });
  }

  return sessionRevalidationPromise;
}

export const getApiUrl = () => {
  return env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
};

const apiUrl = getApiUrl();

const api = Axios.create({
  baseURL: apiUrl,
  headers: {
    Accept: "application/json",
    "Content-Type": "application/json",
  },
  withCredentials: true,
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    // Normalise 429 at the moment the response lands. A date-form
    // `Retry-After` measured later would be short by however long the error
    // sat in a query cache before something asked about it.
    attachRateLimitInfo(error);

    if (!Axios.isAxiosError(error) || error.response?.status !== 401) {
      throw error;
    }

    const originalRequest = error.config as AuthRetryRequestConfig | undefined;

    if (
      !originalRequest ||
      !isBrowserRequest() ||
      !isGetRequest(originalRequest) ||
      originalRequest._authRetry
    ) {
      throw error;
    }

    originalRequest._authRetry = true;

    const hasValidSession = await revalidateSession();
    if (!hasValidSession) {
      throw error;
    }

    return api(originalRequest);
  },
);

export default api;
