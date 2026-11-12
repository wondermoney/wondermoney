/**
 * `MERCHANT_LOGO_URL_TEMPLATE`: an https URL whose path or query holds `{domain}`, such as
 * `https://logos.example.com/{domain}.png`. The host is fixed, so a merchant's website can choose
 * which image the server asks for but never which server it asks.
 */
export function isMerchantLogoTemplate(value: string): boolean {
  return /^https:\/\/[^/?#\s{}]+[/?#]/u.test(value) && value.includes('{domain}') && URL.canParse(value.replaceAll('{domain}', 'example.com'));
}
