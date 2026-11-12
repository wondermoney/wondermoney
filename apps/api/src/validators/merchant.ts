import { z } from 'zod';

import { positiveIntId } from '@validators/shared';

export const MERCHANT_WEBSITE_MAX_LENGTH = 500;
export const MERCHANT_LOGO_URL_MAX_LENGTH = 2048;

const IPV4_HOST = /^\d{1,3}(?:\.\d{1,3}){3}$/u;

/**
 * An address safe to store for a merchant and to render as an `<img>` in another member's browser:
 * https only (so never `javascript:`, `data:`, `blob:` or `file:`), no credentials, and a named
 * host rather than an IP address or a single-label name such as `localhost`.
 */
export function isSafeImageUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return false;
  const host = url.hostname;
  if (host.startsWith('[') || IPV4_HOST.test(host)) return false;
  return host.includes('.') && !host.endsWith('.');
}

/** A trimmed https address of at most `max` characters; null or an empty string clears the field. */
export const clearableHttpsUrl = (max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string().trim().max(max).refine(isSafeImageUrl, { message: 'Must be an https address, such as https://example.com' }).nullable(),
  );

/** `PATCH /v1/account/transaction-merchants/:merchantId`: set or clear the website and logo URL. */
export const updateTransactionMerchantRequestSchema = z.object({
  body: z
    .object({
      logoUrl: clearableHttpsUrl(MERCHANT_LOGO_URL_MAX_LENGTH).optional(),
      website: clearableHttpsUrl(MERCHANT_WEBSITE_MAX_LENGTH).optional(),
    })
    .refine((body) => body.logoUrl !== undefined || body.website !== undefined, { message: 'Send website, logoUrl or both' }),
  params: z.object({ merchantId: positiveIntId }),
});

/** `GET /v1/account/transaction-merchants/:merchantId/logo`. */
export const getTransactionMerchantLogoRequestSchema = z.object({
  params: z.object({ merchantId: positiveIntId }),
});
