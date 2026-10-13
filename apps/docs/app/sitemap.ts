import type { MetadataRoute } from 'next';
import { locales } from '@/lib/i18n';
import { source } from '@/lib/source';
import {
  absoluteUrl,
  docsLanguageAlternates,
  homeLanguageAlternates,
  homePath,
  type SitemapEntry,
} from '@/lib/metadata';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const homeEntries: SitemapEntry[] = locales.map((locale) => ({
    url: absoluteUrl(homePath(locale)),
    lastModified: now,
    changeFrequency: 'weekly',
    priority: 1,
    alternates: {
      languages: homeLanguageAlternates(),
    },
  }));

  const docsEntries: SitemapEntry[] = source.getPages().map((page) => ({
    url: absoluteUrl(page.url),
    lastModified: now,
    changeFrequency: 'weekly',
    priority: page.slugs.length === 0 ? 0.9 : 0.7,
    alternates: {
      languages: docsLanguageAlternates(page.slugs),
    },
  }));

  const legalEntries: SitemapEntry[] = [
    '/about/privacy-policy',
    '/about/terms-of-service',
    '/pt/about/privacy-policy',
    '/pt/about/terms-of-service',
  ].map((path) => ({
    url: absoluteUrl(path),
    lastModified: now,
    changeFrequency: 'yearly',
    priority: 0.5,
  }));

  return [...homeEntries, ...docsEntries, ...legalEntries];
}
