import { API_ERROR_CODE, getApiErrorCode } from "@/lib/api/errors";

/**
 * The message key, under `bankProvider.generated`, for an error from setting up an Enable Banking
 * key: each wrong application (unknown ID, Sandbox, not activated) has its own, so the person
 * knows what to fix. Shared by the generated-key and pasted-key forms, which get the same codes.
 */
export type EnableBankingErrorKey =
  | "errorApplicationNotFound"
  | "errorGeneric"
  | "errorInvalidTotp"
  | "errorNotActivated"
  | "errorPendingMissing"
  | "errorRefused"
  | "errorSandbox"
  | "errorSessionNotFresh"
  | "errorTotpRequired";

const KEY_BY_CODE: Record<string, EnableBankingErrorKey> = {
  [API_ERROR_CODE.ENABLE_BANKING_APPLICATION_NOT_ACTIVATED]: "errorNotActivated",
  [API_ERROR_CODE.ENABLE_BANKING_APPLICATION_NOT_FOUND]: "errorApplicationNotFound",
  [API_ERROR_CODE.ENABLE_BANKING_APPLICATION_SANDBOX]: "errorSandbox",
  [API_ERROR_CODE.ENABLE_BANKING_CREDENTIAL_REFUSED]: "errorRefused",
  [API_ERROR_CODE.ENABLE_BANKING_PENDING_CREDENTIAL_MISSING]: "errorPendingMissing",
  invalid_totp: "errorInvalidTotp",
  session_not_fresh: "errorSessionNotFresh",
  totp_required: "errorTotpRequired",
};

export function enableBankingErrorKey(error: unknown): EnableBankingErrorKey {
  const code = getApiErrorCode(error);
  return (code && KEY_BY_CODE[code]) || "errorGeneric";
}

/** Whether the error is one of the codes above (else a caller may fall back to its own message). */
export function isKnownEnableBankingError(error: unknown): boolean {
  const code = getApiErrorCode(error);
  return Boolean(code && KEY_BY_CODE[code]);
}
