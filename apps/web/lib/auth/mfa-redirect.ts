import { buildLocalizedAuthErrorPath } from "./auth-error-redirect";

export function getMfaFailureRedirectPath(locale: string) {
  return buildLocalizedAuthErrorPath(locale);
}
