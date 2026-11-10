import "server-only";

import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { isPrivacyModeValue, PRIVACY_MODE_COOKIE } from "./privacy-mode-store";
import { PrivacyModeProvider } from "./usePrivacyMode";

/**
 * Reads privacy mode on the server so the first paint is already masked: no
 * flash of real balances on reload, and no real figures in the HTML.
 *
 * Used by the layouts that show money (the signed-in shell, the budget wizard
 * and first-run onboarding) rather than the root layout, so reading the cookie
 * does not make public pages such as sign-in render per request.
 */
export async function PrivacyModeBoundary({
  children,
}: {
  children: ReactNode;
}) {
  const initialHidden = isPrivacyModeValue(
    (await cookies()).get(PRIVACY_MODE_COOKIE)?.value,
  );
  return (
    <PrivacyModeProvider initialHidden={initialHidden}>
      {children}
    </PrivacyModeProvider>
  );
}
