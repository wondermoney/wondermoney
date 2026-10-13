import type { ReactNode } from 'react';
import { RootProvider } from 'fumadocs-ui/provider/next';
import { Inter } from 'next/font/google';
import Link from 'next/link';
import { getI18nProvider } from '@/lib/i18n';
import { siteJsonLd } from '@/lib/schema';
import { JsonLd } from '@/components/json-ld';
import '../../global.css';

const inter = Inter({ subsets: ['latin'] });

export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="min-h-screen bg-fd-background text-fd-foreground">
        <JsonLd data={siteJsonLd('en')} />
        <RootProvider i18n={getI18nProvider('en')}>
          <header className="border-b">
            <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4 text-sm">
              <Link href="/en" className="font-semibold">WonderMoney Docs</Link>
              <div className="flex items-center gap-4 text-fd-muted-foreground">
                <Link href="/en/docs" className="hover:text-fd-foreground">Documentation</Link>
                <Link href="https://wonder.money" className="hover:text-fd-foreground">Main site</Link>
              </div>
            </nav>
          </header>
          <main className="mx-auto max-w-4xl px-6 py-12">
            <article className="space-y-6 text-base leading-7 [&_a]:text-fd-primary [&_a]:underline [&_h1]:text-4xl [&_h1]:font-semibold [&_h2]:pt-6 [&_h2]:text-2xl [&_h2]:font-semibold [&_h3]:pt-4 [&_h3]:text-xl [&_h3]:font-semibold [&_li]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-4 [&_ul]:list-disc [&_ul]:pl-6">
              {children}
            </article>
          </main>
        </RootProvider>
      </body>
    </html>
  );
}
