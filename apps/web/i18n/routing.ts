import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  // A list of all locales that are supported
  locales: ["en", "pt", "es"],
  // Used when no locale matches
  defaultLocale: "en",
  localePrefix: "always",
  localeDetection: true,
  localeCookie: {
    // Custom cookie name
    name: "WONDERMONEY_LOCALE",
    // Expire in one year
    maxAge: 60 * 60 * 24 * 365,
  },
});
