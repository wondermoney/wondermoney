/**
 * Query parameter the reset-password page adds when it sends someone back to
 * the forgot-password page because their link was invalid or expired. The
 * forgot-password page explains why inline: a toast fired before the redirect
 * was lost, because on a fresh page load it ran before the Toaster mounted.
 */
export const RESET_LINK_REASON_PARAM = "reason";
export const INVALID_RESET_LINK_REASON = "invalid-reset-link";

export const INVALID_RESET_LINK_REDIRECT = `/auth/forgot?${RESET_LINK_REASON_PARAM}=${INVALID_RESET_LINK_REASON}`;
