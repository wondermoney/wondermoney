import { useMutation } from "@tanstack/react-query";

import { routing } from "@/i18n/routing";

import api from "../api";

type AppLocale = (typeof routing.locales)[number];

/** The account language the API stores: emails and other server-written texts go out in it. */
export type AccountLanguage = "EN" | "ES" | "PT";

const ACCOUNT_LANGUAGE: Readonly<Record<AppLocale, AccountLanguage>> = {
  en: "EN",
  es: "ES",
  pt: "PT",
};

/** The account language for a web locale (`es` → `ES`); anything unknown is English. */
export function toAccountLanguage(locale: string): AccountLanguage {
  return Object.hasOwn(ACCOUNT_LANGUAGE, locale)
    ? ACCOUNT_LANGUAGE[locale as AppLocale]
    : "EN";
}

export interface AccountLanguagePatchClient {
  patch: (url: string, body: { language: AccountLanguage }) => Promise<unknown>;
}

/**
 * `PATCH /v1/user/:userId` with the account language. The API resolves the
 * account from the session; the path segment is only there because the route
 * has one.
 */
export async function updateAccountLanguage(
  userId: string,
  locale: string,
  apiClient: AccountLanguagePatchClient = api,
): Promise<void> {
  await apiClient.patch(`/v1/user/${encodeURIComponent(userId)}`, {
    language: toAccountLanguage(locale),
  });
}

/**
 * Keeps the account language in step with the language the person picks in
 * Settings, so their emails follow it.
 */
export default function useUpdateAccountLanguage(userId: string | undefined) {
  return useMutation({
    mutationFn: async (locale: string) => {
      if (!userId) return;
      await updateAccountLanguage(userId, locale);
    },
    scope: { id: "account-language" },
  });
}
