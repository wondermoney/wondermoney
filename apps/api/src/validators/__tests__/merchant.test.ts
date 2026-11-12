import { describe, expect, it } from 'vitest';

import { isSafeImageUrl, MERCHANT_LOGO_URL_MAX_LENGTH, MERCHANT_WEBSITE_MAX_LENGTH, updateTransactionMerchantRequestSchema } from '../merchant';

const parse = (body: unknown) => updateTransactionMerchantRequestSchema.safeParse({ body, params: { merchantId: '7' } });

/*
 * A merchant's website and logo URL are shown to every member of the household, and the logo is
 * loaded as an image by their browsers and phones. Only a plain https address on a named host gets
 * through: nothing a browser would run, inline or send credentials with.
 */
describe('updateTransactionMerchantRequestSchema', () => {
  it('accepts an https website and logo URL', () => {
    const parsed = parse({ logoUrl: 'https://cdn.example.com/logos/shop.png', website: 'https://www.example.com/' });

    expect(parsed.success).toBe(true);
    expect(parsed.data?.body).toEqual({ logoUrl: 'https://cdn.example.com/logos/shop.png', website: 'https://www.example.com/' });
    expect(parsed.data?.params.merchantId).toBe(7);
  });

  it('clears a field sent as null or as an empty string', () => {
    expect(parse({ logoUrl: null, website: '  ' }).data?.body).toEqual({ logoUrl: null, website: null });
  });

  it('trims the value it keeps', () => {
    expect(parse({ website: '  https://example.com  ' }).data?.body.website).toBe('https://example.com');
  });

  it('needs at least one of the two fields', () => {
    expect(parse({}).success).toBe(false);
  });

  it.each([
    ['javascript:', 'javascript:alert(document.cookie)'],
    ['javascript: in upper case', 'JAVASCRIPT:alert(1)'],
    ['data:', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
    ['data: text', 'data:text/html,<script>alert(1)</script>'],
    ['plain http', 'http://example.com/logo.png'],
    ['a protocol-relative address', '//example.com/logo.png'],
    ['ftp', 'ftp://example.com/logo.png'],
    ['file', 'file:///etc/passwd'],
    ['blob', 'blob:https://example.com/0b2e'],
    ['credentials in the address', 'https://user:secret@example.com/logo.png'],
    ['an IPv4 host', 'https://192.168.1.10/logo.png'],
    ['an IPv6 host', 'https://[::1]/logo.png'],
    ['a host with no dot', 'https://localhost/logo.png'],
    ['no URL at all', 'not a url'],
  ])('refuses %s', (_label, value) => {
    expect(parse({ logoUrl: value }).success).toBe(false);
    expect(parse({ website: value }).success).toBe(false);
  });

  it('refuses a value over the length limit', () => {
    const longPath = (length: number) => `https://example.com/${'a'.repeat(length - 'https://example.com/'.length)}`;

    expect(parse({ website: longPath(MERCHANT_WEBSITE_MAX_LENGTH) }).success).toBe(true);
    expect(parse({ website: longPath(MERCHANT_WEBSITE_MAX_LENGTH + 1) }).success).toBe(false);
    expect(parse({ logoUrl: longPath(MERCHANT_LOGO_URL_MAX_LENGTH) }).success).toBe(true);
    expect(parse({ logoUrl: longPath(MERCHANT_LOGO_URL_MAX_LENGTH + 1) }).success).toBe(false);
  });

  it('refuses a value that is not a string', () => {
    expect(parse({ logoUrl: 42 }).success).toBe(false);
  });
});

describe('isSafeImageUrl', () => {
  it('is the same rule the request schema applies', () => {
    expect(isSafeImageUrl('https://example.com/logo.png')).toBe(true);
    expect(isSafeImageUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeImageUrl('data:image/png;base64,AAAA')).toBe(false);
  });
});
