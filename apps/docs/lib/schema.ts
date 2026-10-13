import { type Locale } from './i18n';
import {
  absoluteUrl,
  docsPath,
  homePath,
  localizedDocumentationLabel,
  localizedSiteDescription,
  siteName,
  siteUrl,
} from './metadata';

type BreadcrumbItem = {
  name: string;
  url: string;
};

function humanizeSlug(slug: string) {
  return slug
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function siteJsonLd(locale: Locale) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${siteUrl}/#organization`,
        name: 'WonderMoney',
        url: 'https://wonder.money',
      },
      {
        '@type': 'WebSite',
        '@id': `${siteUrl}/#website`,
        name: siteName,
        description: localizedSiteDescription[locale],
        url: absoluteUrl(homePath(locale)),
        publisher: {
          '@id': `${siteUrl}/#organization`,
        },
        inLanguage: locale,
      },
    ],
  };
}

export function breadcrumbJsonLd(items: BreadcrumbItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function docsBreadcrumbItems(locale: Locale, slugs: string[], title: string): BreadcrumbItem[] {
  const items: BreadcrumbItem[] = [
    {
      name: 'WonderMoney Docs',
      url: absoluteUrl(homePath(locale)),
    },
    {
      name: localizedDocumentationLabel[locale],
      url: absoluteUrl(docsPath(locale)),
    },
  ];

  slugs.forEach((slug, index) => {
    const isLast = index === slugs.length - 1;
    const name = isLast ? title : humanizeSlug(slug);

    if (slug !== 'index') {
      items.push({
        name,
        url: absoluteUrl(docsPath(locale, slugs.slice(0, index + 1))),
      });
    }
  });

  return items;
}

export function docsPageJsonLd({
  locale,
  title,
  description,
  url,
}: {
  locale: Locale;
  title: string;
  description?: string;
  url: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: title,
    description,
    url,
    isPartOf: {
      '@id': `${siteUrl}/#website`,
    },
    publisher: {
      '@id': `${siteUrl}/#organization`,
    },
    inLanguage: locale,
  };
}
