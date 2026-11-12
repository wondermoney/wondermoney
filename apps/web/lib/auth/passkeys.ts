"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { authClient } from "./client";

/**
 * Passkeys, through better-auth's passkey plugin on the API (`/api/auth/passkey/*`).
 *
 * The WebAuthn ceremonies run in this page: `authClient.passkey.addPasskey` and
 * `authClient.signIn.passkey` fetch options from the API, call `navigator.credentials` and
 * send the result back. The API's relying party is this web app's hostname (`APP_URL`), so a
 * passkey made here is only ever offered here.
 */
export interface Passkey {
  aaguid?: null | string;
  createdAt: Date | string;
  id: string;
  /** Set by the API on every sign-in with this passkey; absent until the first one. */
  lastUsedAt?: Date | null | string;
  name?: null | string;
}

/** A failed passkey call, carrying better-auth's error code where it gave one. */
export class PasskeyError extends Error {
  readonly code: string | undefined;
  readonly status: number | undefined;

  constructor(error: { code?: string; message?: string; status?: number }) {
    super(error.message ?? "Passkey request failed");
    this.code = error.code;
    this.status = error.status;
  }
}

// How a closed or timed-out browser prompt comes back: `@simplewebauthn/browser` passes the
// browser's NotAllowedError through, reports a prompt replaced by another as aborted, and the
// plugin calls anything else on sign-in AUTH_CANCELLED.
const CANCELLED_CODES = new Set([
  "AUTH_CANCELLED",
  "ERROR_CEREMONY_ABORTED",
  "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
]);

/** True when the browser's passkey prompt was closed, which is not an error to report. */
export function isPasskeyCancelled(error: unknown): boolean {
  return error instanceof PasskeyError && CANCELLED_CODES.has(error.code ?? "");
}

/** True when the API wants a recent sign-in before a passkey is added. */
export function isSessionNotFresh(error: unknown): boolean {
  return error instanceof PasskeyError && error.code === "SESSION_NOT_FRESH";
}

/**
 * Whether this browser can use passkeys at all. False on an insecure origin (plain HTTP on
 * anything but localhost), where the browser hides WebAuthn.
 */
export function browserSupportsPasskeys(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext !== false &&
    typeof window.PublicKeyCredential === "function"
  );
}

/** Whether the browser can offer passkeys from the email field's autofill (conditional UI). */
export async function browserSupportsPasskeyAutofill(): Promise<boolean> {
  if (!browserSupportsPasskeys()) return false;
  const check = window.PublicKeyCredential.isConditionalMediationAvailable;
  if (typeof check !== "function") return false;
  try {
    return await check.call(window.PublicKeyCredential);
  } catch {
    return false;
  }
}

// A best-effort label for an unnamed passkey: the password manager it lives in, from the
// authenticator model id (AAGUID) it reported. Apple and other privacy-preserving platforms
// report all zeros, which matches nothing here.
const AUTHENTICATOR_NAMES: Record<string, string> = {
  "08987058-cadc-4b81-b6e1-30de50dcbe96": "Windows Hello",
  "0ea242b4-43c4-4a1b-8b17-dd6d0b6baec6": "Keeper",
  "50726f74-6f6e-5061-7373-50726f746f6e": "Proton Pass",
  "531126d6-e717-415c-9320-3d9aa6981239": "Dashlane",
  "53414d53-554e-4700-0000-000000000000": "Samsung Pass",
  "6028b017-b1d4-4c02-b4b3-afcdafc96bb2": "Windows Hello",
  "9ddd1817-af5a-4672-a2b9-3e3dd95000a9": "Windows Hello",
  "b78a0a55-6ef8-d246-a042-ba0f6d55050c": "LastPass",
  "b84e4048-15dc-4dd0-8640-f4f60813c8af": "NordPass",
  "bada5566-a7aa-401f-bd96-45619a55120d": "1Password",
  "d548826e-79b4-db40-a3d8-11116f7e8349": "Bitwarden",
  "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4": "Google Password Manager",
};

/** The passkey's own name, else its password manager's, else null (the caller's fallback). */
export function passkeyLabel(
  passkey: Pick<Passkey, "aaguid" | "name">,
): null | string {
  const name = passkey.name?.trim();
  if (name) return name;
  return (
    AUTHENTICATOR_NAMES[passkey.aaguid?.trim().toLowerCase() ?? ""] ?? null
  );
}

type AuthResult<T> = {
  data: T | null;
  error: null | { code?: string; message?: string; status?: number };
};

function unwrap<T>(result: AuthResult<T>): T {
  if (result.error) throw new PasskeyError(result.error);
  if (result.data === null)
    throw new PasskeyError({ message: "Empty passkey response" });
  return result.data;
}

const PASSKEYS_KEY = ["auth", "passkeys"] as const;

export async function listPasskeys(): Promise<Passkey[]> {
  return unwrap(await authClient.passkey.listUserPasskeys()) as Passkey[];
}

export async function addPasskey(): Promise<void> {
  unwrap(await authClient.passkey.addPasskey());
}

export async function renamePasskey(input: {
  id: string;
  name: string;
}): Promise<void> {
  unwrap(await authClient.passkey.updatePasskey(input));
}

export async function deletePasskey(id: string): Promise<void> {
  unwrap(await authClient.passkey.deletePasskey({ id }));
}

/** Sign in with a passkey. `autoFill` waits for the user to pick one from the email field. */
export async function signInWithPasskey({
  autoFill = false,
}: { autoFill?: boolean } = {}): Promise<void> {
  unwrap(await authClient.signIn.passkey({ autoFill }));
}

export function usePasskeys({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({ enabled, queryFn: listPasskeys, queryKey: PASSKEYS_KEY });
}

function usePasskeyMutation<TInput>(
  mutationFn: (input: TInput) => Promise<void>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: () => queryClient.invalidateQueries({ queryKey: PASSKEYS_KEY }),
  });
}

export const useAddPasskey = () => usePasskeyMutation<void>(addPasskey);
export const useRenamePasskey = () => usePasskeyMutation(renamePasskey);
export const useDeletePasskey = () => usePasskeyMutation(deletePasskey);
