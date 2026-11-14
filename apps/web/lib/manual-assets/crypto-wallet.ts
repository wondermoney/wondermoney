import { looksLikeWalletSecret } from "@wondermoney/shared/crypto-wallet";

import { API_ERROR_CODE, getApiErrorCode } from "@/lib/api/errors";
import type { ManualAsset } from "@/lib/api/manual-asset/types";

export { looksLikeWalletSecret };

export function isCryptoWallet(asset: Pick<ManualAsset, "kind">): boolean {
  return asset.kind === "crypto_wallet";
}

/** An address or xpub cut to its two ends for a row; the full one is in its title and screen-reader label. */
export function shortAddress(address: string): string {
  return address.length <= 20
    ? address
    : `${address.slice(0, 10)}…${address.slice(-6)}`;
}

/**
 * The `assets.wallet.errors` message for a wallet error the API names, or null
 * for any other error. Never the API's own message: for a refused secret that
 * would be the place a value could leak back, and the translated line says the
 * same thing in the reader's language.
 */
export function walletErrorKey(
  error: unknown,
):
  | "secretRejected"
  | "addressInvalid"
  | "addressExists"
  | "featureDisabled"
  | null {
  switch (getApiErrorCode(error)) {
    case API_ERROR_CODE.CRYPTO_WALLET_SECRET_REJECTED:
      return "secretRejected";
    case API_ERROR_CODE.CRYPTO_WALLET_ADDRESS_INVALID:
      return "addressInvalid";
    case API_ERROR_CODE.CRYPTO_WALLET_ADDRESS_EXISTS:
      return "addressExists";
    case API_ERROR_CODE.FEATURE_DISABLED:
      return "featureDisabled";
    default:
      return null;
  }
}
