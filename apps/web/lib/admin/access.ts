import { instanceConfig } from "@/lib/instance";

/**
 * Whether a confirmed email belongs to this instance's admin domain
 * (`NEXT_PUBLIC_ADMIN_EMAIL_DOMAIN`). An instance without one has no admins.
 */
export function isInstanceAdminEmail(
  email?: null | string,
  emailConfirmedAt?: null | string,
  adminEmailDomain: null | string = instanceConfig.adminEmailDomain,
) {
  if (!adminEmailDomain || !emailConfirmedAt) return false;
  return email?.trim().toLowerCase().endsWith(adminEmailDomain.toLowerCase()) ?? false;
}
