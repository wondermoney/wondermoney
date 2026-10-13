import type { MetadataRoute } from 'next';
import { defaultLocale, locales, type Locale } from './i18n';

export const siteName = 'WonderMoney Docs';
export const siteDescription =
  'Guides and support documentation for managing your money with WonderMoney.';
export const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://docs.wonder.money';

export const localizedSiteDescription: Record<Locale, string> = {
  en: siteDescription,
  pt: 'Guias e documentação de suporte para gerir o seu dinheiro com a WonderMoney.',
  es: 'Guías y documentación de soporte para gestionar tu dinero con WonderMoney.',
};

export const localizedDocumentationLabel: Record<Locale, string> = {
  en: 'Documentation',
  pt: 'Documentação',
  es: 'Documentación',
};

export function absoluteUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return new URL(normalized, siteUrl).toString();
}

export function docsPath(locale: Locale, slugs: string[] = []): string {
  return `/${locale}/docs${slugs.length > 0 ? `/${slugs.join('/')}` : ''}`;
}

export function homePath(locale: Locale): string {
  return `/${locale}`;
}

export function languageAlternates(pathForLocale: (locale: Locale) => string) {
  return Object.fromEntries(locales.map((locale) => [locale, absoluteUrl(pathForLocale(locale))]));
}

export function docsLanguageAlternates(slugs: string[] = []) {
  return {
    ...languageAlternates((locale) => docsPath(locale, slugs)),
    'x-default': absoluteUrl(docsPath(defaultLocale, slugs)),
  };
}

export function homeLanguageAlternates() {
  return {
    ...languageAlternates(homePath),
    'x-default': absoluteUrl(homePath(defaultLocale)),
  };
}

export type SitemapEntry = MetadataRoute.Sitemap[number];
