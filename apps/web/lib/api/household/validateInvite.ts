import { getServerApiUrl } from "@/lib/api/server-api-url";

/**
 * Server-side, pre-signup validation for the /join page. Hits the public API
 * endpoint (no auth) keyed only by the invite token, so we can greet the
 * invitee and lock the email before any account exists. Returns null for any
 * invalid / expired / unknown token (the page renders the "invalid" screen).
 */
export interface InviteValidation {
  email: string;
  expiresAt: string;
  inviterName: null | string;
}


export async function validateInvite(
  token: string,
): Promise<InviteValidation | null> {
  try {
    const res = await fetch(
      `${getServerApiUrl()}/v1/household/invites/validate?token=${encodeURIComponent(token)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    return (await res.json()) as InviteValidation;
  } catch {
    return null;
  }
}
