import "../../theme/globals.css";

import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { notFound } from "next/navigation";
import Script from "next/script";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";

import { InstanceNameProvider } from "@/components/instance/InstanceNameProvider";
import PivotBanner from "@/components/layout/PivotBanner";
import { TailwindIndicator } from "@/components/ui/TailwindIndicator";
import { routing } from "@/i18n/routing";
import { getInstanceName } from "@/lib/instance-name.server";
import { cn } from "@/lib/utils";

import AnalyticsPageView from "../AnalyticsPageView";
import { Providers } from "../providers";

const reactDevToolsEnabled =
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_DISABLE_REACT_DEVTOOLS !== "1";

/* export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
} */

export default async function RootLayout(props: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;

  // Ensure that the incoming `locale` is valid
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);
  const instanceName = await getInstanceName();

  return (
    <html lang={locale} className="overflow-x-clip" suppressHydrationWarning>
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
          "bg-background min-h-dvh overflow-x-clip font-sans antialiased",
          GeistSans.variable,
          GeistMono.variable,
        )}
      >
        <NextIntlClientProvider>
          <InstanceNameProvider name={instanceName}>
            <Providers>
              <AnalyticsPageView />
              <PivotBanner />
              {props.children}
            </Providers>
          </InstanceNameProvider>
        </NextIntlClientProvider>
        <TailwindIndicator />
      </body>
    </html>
  );
}
