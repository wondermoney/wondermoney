import { notFound } from "next/navigation";
import { type IntlError, IntlErrorCode } from "next-intl";
import { getRequestConfig } from "next-intl/server";

export const locales = ["en", "pt", "es"] as const;

export const localePrefix = "always";

export const defaultLocale = "en";

export function onError(error: IntlError) {
  if (error.code === IntlErrorCode.MISSING_MESSAGE) {
    // Missing translations are expected and should only log an error
    if (process.env.NODE_ENV === "development") {
      console.error("name", error.name);
    }
  } else {
    // Other errors indicate a bug in the app and should be reported
    throw error;
  }
}

export function getMessageFallback({
  namespace,
  key,
  error,
}: {
  error: IntlError;
  key: string;
  namespace?: string;
}) {
  const path = [namespace, key].filter((part) => part != null).join(".");

  if (error.code === IntlErrorCode.MISSING_MESSAGE) {
    return path + " is not yet translated";
  } else {
    return "Dear developer, please fix this message: " + path;
  }
}

// @ts-ignore
export default getRequestConfig(async ({ locale }) => {
  // Validate that the incoming `locale` parameter is valid
  if (!locales.includes(locale as any)) notFound();

  const messages = {
    ...(await import(`./messages/${locale}/common.json`)).default,
    ...(await import(`./messages/${locale}/categories.json`)).default,
    ...(await import(`./messages/${locale}/navigation.json`)).default,
    ...(await import(`./messages/${locale}/onboarding.json`)).default,
    ...(await import(`./messages/${locale}/loans.json`)).default,
    ...(await import(`./messages/${locale}/household.json`)).default,
    ...(await import(`./messages/${locale}/reports.json`)).default,
  };

  return { messages, onError, getMessageFallback };
});
