import "../../theme/globals.css";

import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { notFound } from "next/navigation";
import Script from "next/script";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { use } from "react";

import PivotBanner from "@/components/layout/PivotBanner";
import { TailwindIndicator } from "@/components/ui/TailwindIndicator";
import { routing } from "@/i18n/routing";
import { cn } from "@/lib/utils";

import AnalyticsPageView from "../AnalyticsPageView";
import { Providers } from "../providers";

const reactDevToolsEnabled =
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_DISABLE_REACT_DEVTOOLS !== "1";

/* export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
} */

export default function RootLayout(props: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const params = use(props.params);

  const { locale } = params;

  // Ensure that the incoming `locale` is valid
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {reactDevToolsEnabled ? (
          <>
            <Script
              src="https://unpkg.com/react-grab/dist/index.global.js"
              crossOrigin="anonymous"
              strategy="beforeInteractive"
            />
            <Script
              src="https://unpkg.com/react-scan/dist/auto.global.js"
              crossOrigin="anonymous"
              strategy="beforeInteractive"
            />
          </>
        ) : null}
      </head>
      <body
        className={cn(
          "bg-background min-h-dvh font-sans antialiased",
          GeistSans.variable,
          GeistMono.variable,
        )}
      >
        <NextIntlClientProvider>
          <Providers>
            <AnalyticsPageView />
            <PivotBanner />
            {props.children}
          </Providers>
        </NextIntlClientProvider>
        <TailwindIndicator />
      </body>
    </html>
  );
}
