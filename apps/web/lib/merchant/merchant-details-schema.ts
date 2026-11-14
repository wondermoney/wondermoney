import { z } from "zod";

/** The API's limits for `PATCH /v1/account/transaction-merchants/:merchantId`. */
export const MERCHANT_WEBSITE_MAX_LENGTH = 500;
export const MERCHANT_LOGO_URL_MAX_LENGTH = 2048;

const IPV4_HOST = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * An address the API will store: https only (never http:, javascript: or data:), no
 * credentials, a named host with a dot in it, not an IP address. The API checks the same and is
 * the authority; this is early feedback in the form.
 */
export function isAcceptedMerchantUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  const host = url.hostname;
  if (host.startsWith("[") || IPV4_HOST.test(host)) return false;
  return host.includes(".") && !host.endsWith(".");
}

export type MerchantDetailsErrorKey = "error-https" | "error-too-long";

/**
 * The form's schema. `message` turns an error key (under `transactionMerchant`) into copy; the
 * default leaves the key, which is what tests compare against.
 */
export function createMerchantDetailsSchema(
  message: (key: MerchantDetailsErrorKey) => string = (key) => key,
) {
  const merchantUrl = (maxLength: number) =>
    z
      .string()
      .trim()
      .max(maxLength, { message: message("error-too-long") })
      .refine((value) => value === "" || isAcceptedMerchantUrl(value), {
        message: message("error-https"),
      });

  return z.object({
    website: merchantUrl(MERCHANT_WEBSITE_MAX_LENGTH),
    logoUrl: merchantUrl(MERCHANT_LOGO_URL_MAX_LENGTH),
  });
}

export type MerchantDetailsValues = z.infer<
  ReturnType<typeof createMerchantDetailsSchema>
>;

/** The form's values as the PATCH body: an empty field clears it. */
export function merchantDetailsPatch(values: MerchantDetailsValues): {
  website: string | null;
  logoUrl: string | null;
} {
  return {
    website: values.website.trim() || null,
    logoUrl: values.logoUrl.trim() || null,
  };
}
