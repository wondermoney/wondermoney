import type { ReactNode } from "react";

import { PRIVACY_MODE_COOKIE } from "./privacy-mode-store";
import { PrivacyModeProvider } from "./usePrivacyMode";

/** Sets the stored choice (what a client render reads). */
export function setStoredPrivacyMode(hidden: boolean) {
  document.cookie = hidden
    ? `${PRIVACY_MODE_COOKIE}=1; path=/`
    : `${PRIVACY_MODE_COOKIE}=; path=/; max-age=0`;
}

export function WithPrivacyMode({
  hidden,
  children,
}: {
  hidden: boolean;
  children: ReactNode;
}) {
  return (
    <PrivacyModeProvider initialHidden={hidden}>{children}</PrivacyModeProvider>
  );
}

/** A money figure as en renders one: a digit run with a grouping or decimal. */
export const EN_MONEY_PATTERN = /\d[\d,]*\.\d{2}|\d{1,3}(,\d{3})+/;
