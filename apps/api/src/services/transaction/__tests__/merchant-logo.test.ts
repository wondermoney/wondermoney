import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearMerchantLogoCache, fetchMerchantLogo, merchantLogoTemplate, resolveMerchantLogoUrl, toMerchantDto, websiteDomain } from '../merchant-logo';

const TEMPLATE = 'https://logos.example.com/{domain}.png';
const API_URL = 'https://api.money.test';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const merchant = (fields: { logoUrl?: null | string; website?: null | string } = {}) => ({ name: 'Corner Shop', transactionMerchantKey: 41, ...fields });

function imageResponse(body: Uint8Array = PNG, contentType = 'image/png', status = 200) {
  return new Response(body, { headers: { 'content-type': contentType }, status });
}

beforeEach(() => { clearMerchantLogoCache(); });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('merchantLogoTemplate', () => {
  it('is off unless MERCHANT_LOGO_URL_TEMPLATE is set', () => {
    vi.stubEnv('MERCHANT_LOGO_URL_TEMPLATE', '');
    expect(merchantLogoTemplate()).toBeNull();
    vi.stubEnv('MERCHANT_LOGO_URL_TEMPLATE', TEMPLATE);
    expect(merchantLogoTemplate()).toBe(TEMPLATE);
  });

  it('ignores a template that is not https or has no {domain}', () => {
    expect(merchantLogoTemplate('http://logos.example.com/{domain}.png')).toBeNull();
    expect(merchantLogoTemplate('https://logos.example.com/logo.png')).toBeNull();
  });
});

describe('websiteDomain', () => {
  it('is the website host without a leading www', () => {
    expect(websiteDomain('https://www.Example.com/stores?city=lisbon')).toBe('example.com');
    expect(websiteDomain('https://shop.example.co.uk')).toBe('shop.example.co.uk');
  });

  it('is null without a usable website', () => {
    expect(websiteDomain(null)).toBeNull();
    expect(websiteDomain('not a url')).toBeNull();
    expect(websiteDomain('javascript:alert(1)')).toBeNull();
  });
});

describe('resolveMerchantLogoUrl', () => {
  it('produces no logo URL without a template, even with a website', () => {
    expect(resolveMerchantLogoUrl(merchant({ website: 'https://example.com' }), { apiUrl: API_URL, template: null })).toBeNull();
  });

  it('points at the API proxy, never at the provider, when a template is set', () => {
    const url = resolveMerchantLogoUrl(merchant({ website: 'https://www.example.com/about' }), { apiUrl: API_URL, template: TEMPLATE });

    expect(url).toBe(`${API_URL}/v1/account/transaction-merchants/41/logo`);
    expect(url).not.toContain('logos.example.com');
  });

  it('needs a website for the template', () => {
    expect(resolveMerchantLogoUrl(merchant(), { apiUrl: API_URL, template: TEMPLATE })).toBeNull();
  });

  it('prefers the logo URL the household set over the template', () => {
    const own = 'https://cdn.example.org/corner-shop.png';

    expect(resolveMerchantLogoUrl(merchant({ logoUrl: own, website: 'https://example.com' }), { apiUrl: API_URL, template: TEMPLATE })).toBe(own);
    expect(resolveMerchantLogoUrl(merchant({ logoUrl: own }), { apiUrl: API_URL, template: null })).toBe(own);
  });

  it('drops a stored logo URL that is not a safe https address', () => {
    expect(resolveMerchantLogoUrl(merchant({ logoUrl: 'javascript:alert(1)' }), { apiUrl: API_URL, template: null })).toBeNull();
  });
});

describe('toMerchantDto', () => {
  it('carries the stored fields and the logo to show', () => {
    vi.stubEnv('MERCHANT_LOGO_URL_TEMPLATE', '');

    expect(toMerchantDto(merchant({ website: 'https://example.com' }))).toEqual({
      logoUrl: null,
      name: 'Corner Shop',
      resolvedLogoUrl: null,
      transactionMerchantKey: 41,
      website: 'https://example.com',
    });
  });
});

describe('fetchMerchantLogo', () => {
  it('builds the provider URL from the template and the domain', async () => {
    const fetch = vi.fn(() => Promise.resolve(imageResponse()));
    vi.stubGlobal('fetch', fetch);

    const logo = await fetchMerchantLogo('example.com', TEMPLATE);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe('https://logos.example.com/example.com.png');
    expect(logo?.contentType).toBe('image/png');
    expect(logo?.body.equals(Buffer.from(PNG))).toBe(true);
  });

  it('asks the provider once per domain and serves the copy it keeps', async () => {
    const fetch = vi.fn(() => Promise.resolve(imageResponse()));
    vi.stubGlobal('fetch', fetch);

    await Promise.all([fetchMerchantLogo('example.com', TEMPLATE), fetchMerchantLogo('example.com', TEMPLATE)]);
    await fetchMerchantLogo('example.com', TEMPLATE);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('remembers that a domain has no logo instead of asking again', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response('missing', { status: 404 })));
    vi.stubGlobal('fetch', fetch);

    expect(await fetchMerchantLogo('example.com', TEMPLATE)).toBeNull();
    expect(await fetchMerchantLogo('example.com', TEMPLATE)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['an SVG, which can carry script', imageResponse(PNG, 'image/svg+xml')],
    ['an HTML page', imageResponse(PNG, 'text/html')],
    ['an image larger than the limit', imageResponse(new Uint8Array(300 * 1024), 'image/png')],
  ])('refuses %s', async (_label, response) => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response)));

    expect(await fetchMerchantLogo('example.com', TEMPLATE)).toBeNull();
  });

  it('treats a network failure as no logo', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('fetch failed'))));

    expect(await fetchMerchantLogo('example.com', TEMPLATE)).toBeNull();
  });
});
