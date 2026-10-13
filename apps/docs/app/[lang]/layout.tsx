import type { Metadata } from 'next';
import { RootProvider } from 'fumadocs-ui/provider/next';
import { Inter } from 'next/font/google';
import { notFound } from 'next/navigation';
import { getI18nProvider, isLocale, locales } from '@/lib/i18n';
import { absoluteUrl, siteDescription, siteName, siteUrl } from '@/lib/metadata';
import { siteJsonLd } from '@/lib/schema';
import { JsonLd } from '@/components/json-ld';
import '../global.css';

const inter = Inter({
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: siteName,
  title: {
    default: siteName,
    template: `%s | ${siteName}`,
  },
  description: siteDescription,
  openGraph: {
    type: 'website',
    siteName,
    title: siteName,
    description: siteDescription,
    url: absoluteUrl('/en'),
  },
  twitter: {
    card: 'summary_large_image',
    title: siteName,
    description: siteDescription,
  },
};

export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

export default async function Layout({ children, params }: LayoutProps<'/[lang]'>) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();

  return (
    <html lang={lang} className={inter.className} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <JsonLd data={siteJsonLd(lang)} />
        <RootProvider i18n={getI18nProvider(lang)}>{children}</RootProvider>
      </body>
    </html>
  );
}
