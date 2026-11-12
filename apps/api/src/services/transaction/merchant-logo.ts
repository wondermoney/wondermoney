import { isMerchantLogoTemplate } from '@config/merchant-logo-template';
import { BACKEND_URL } from '@utils/constants';
import logger from '@utils/logger';
import { isSafeImageUrl } from '@validators/merchant';

/**
 * Merchant logos.
 *
 * A merchant shows, in order:
 *
 *   1. the logo URL the household set (`TransactionMerchant.logoUrl`), loaded by each viewer's
 *      browser or phone straight from that address;
 *   2. when the instance sets `MERCHANT_LOGO_URL_TEMPLATE` (an https URL with `{domain}`) and the
 *      merchant has a website, the provider's image for the website's domain, **fetched by this
 *      server** and served from `GET /v1/account/transaction-merchants/:merchantId/logo`;
 *   3. otherwise nothing, and the clients draw the merchant's initial.
 *
 * The server proxies the template's images instead of handing the provider's URL to clients, so
 * the provider sees this instance's address and a domain, never a viewer's IP address, browser or
 * which person shops where. With no template nothing about a merchant leaves the server: no URL is
 * built and no request is made. The template is the operator's choice, so the server only ever
 * fetches from the host the operator configured, with the domain as the one variable part.
 */

export interface MerchantDto {
  logoUrl: null | string;
  name: string;
  /** The image a client renders, or null for the initial-letter avatar. */
  resolvedLogoUrl: null | string;
  transactionMerchantKey: number;
  website: null | string;
}

export interface MerchantLogo {
  body: Buffer;
  contentType: string;
}

export interface MerchantLogoFields {
  logoUrl?: null | string;
  name: string;
  transactionMerchantKey: number;
  website?: null | string;
}

/** The instance's logo template (validated at boot), or null when logo lookup is off. */
export function merchantLogoTemplate(value = process.env['MERCHANT_LOGO_URL_TEMPLATE']): null | string {
  const template = value?.trim();
  return template && isMerchantLogoTemplate(template) ? template : null;
}

/** The website's host without a leading `www.`, or null when there is no usable https website. */
export function websiteDomain(website: null | string | undefined): null | string {
  if (!website || !isSafeImageUrl(website)) return null;
  const host = new URL(website).hostname.toLowerCase();
  return host.startsWith('www.') ? host.slice(4) : host;
}

/** What a client should load for this merchant; see the module comment for the order. */
export function resolveMerchantLogoUrl(merchant: MerchantLogoFields, options: { apiUrl?: string; template?: null | string } = {}): null | string {
  if (merchant.logoUrl && isSafeImageUrl(merchant.logoUrl)) return merchant.logoUrl;
  const template = options.template === undefined ? merchantLogoTemplate() : options.template;
  if (!template || !websiteDomain(merchant.website)) return null;
  return `${options.apiUrl ?? BACKEND_URL}/v1/account/transaction-merchants/${merchant.transactionMerchantKey}/logo`;
}

/** The merchant as every response shows it. */
export function toMerchantDto(merchant: MerchantLogoFields): MerchantDto {
  return {
    logoUrl: merchant.logoUrl ?? null,
    name: merchant.name,
    resolvedLogoUrl: resolveMerchantLogoUrl(merchant),
    transactionMerchantKey: merchant.transactionMerchantKey,
    website: merchant.website ?? null,
  };
}

// --- the proxy ---------------------------------------------------------------

/** Raster formats only: an SVG can carry script, and the proxy serves from the API's own origin. */
const IMAGE_TYPES = new Set(['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/vnd.microsoft.icon', 'image/webp', 'image/x-icon']);
const MAX_LOGO_BYTES = 200 * 1024;
const MAX_CACHE_BYTES = 32 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 5_000;
const FOUND_TTL_MS = 24 * 60 * 60 * 1000;
const MISSING_TTL_MS = 60 * 60 * 1000;

interface CacheEntry {
  expiresAt: number;
  logo: MerchantLogo | null;
}

/** Per process, oldest first (a `Map` keeps insertion order), bounded by total image bytes. */
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<MerchantLogo | null>>();
let cachedBytes = 0;

/** Empty the logo cache (tests). */
export function clearMerchantLogoCache(): void {
  cache.clear();
  inFlight.clear();
  cachedBytes = 0;
}

/**
 * The provider's image for `domain`, or null when it has none or it is not a small raster image.
 * One request per domain at a time; a found logo is kept for a day and a missing one for an hour,
 * so a list of fifty rows does not become fifty requests to the provider.
 */
export async function fetchMerchantLogo(domain: string, template: string): Promise<MerchantLogo | null> {
  const key = `${template}\n${domain}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.logo;
  if (hit) forget(key, hit);

  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = download(template.replaceAll('{domain}', encodeURIComponent(domain)))
    .then((logo) => {
      remember(key, { expiresAt: Date.now() + (logo ? FOUND_TTL_MS : MISSING_TTL_MS), logo });
      return logo;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

async function download(url: string): Promise<MerchantLogo | null> {
  try {
    const response = await fetch(url, { headers: { accept: [...IMAGE_TYPES].join(', ') }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) return null;
    const contentType = (response.headers.get('content-type') ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';
    if (!IMAGE_TYPES.has(contentType)) return null;
    if (Number(response.headers.get('content-length') ?? 0) > MAX_LOGO_BYTES) return null;
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length === 0 || body.length > MAX_LOGO_BYTES) return null;
    return { body, contentType };
  } catch (error) {
    // The provider's host is the operator's own setting; the domain is not logged.
    logger.warn({ err: error instanceof Error ? error.message : String(error) }, 'Merchant logo fetch failed');
    return null;
  }
}

function forget(key: string, entry: CacheEntry): void {
  cache.delete(key);
  cachedBytes -= entry.logo?.body.length ?? 0;
}

function remember(key: string, entry: CacheEntry): void {
  const previous = cache.get(key);
  if (previous) forget(key, previous);
  cache.set(key, entry);
  cachedBytes += entry.logo?.body.length ?? 0;
  for (const [oldestKey, oldest] of cache) {
    if (cachedBytes <= MAX_CACHE_BYTES) break;
    forget(oldestKey, oldest);
  }
}
