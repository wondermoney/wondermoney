import type { ReactNode } from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Tailwind,
  Text,
  pixelBasedPreset,
} from "react-email";

import { BrandFooterLine, BrandHeader, resolveBrandName } from "../../src/components/Brand";
import type { TransactionalEmailLanguage } from "../../src/types";

export interface LifecycleEmailLayoutProps {
  /** Copy language for the shell (greeting + footer). Defaults to `'pt'` for backward compatibility. */
  language?: TransactionalEmailLanguage;
  preview: string;
  firstName?: string;
  heading: string;
  intro: ReactNode;
  visual?: ReactNode;
  children: ReactNode;
  ctaLabel?: string;
  ctaUrl?: string;
  footerMode?: "marketing" | "transactional";
  marketingFooterText?: ReactNode;
  unsubscribeUrl?: string;
  settingsUrl?: string;
  privacyUrl?: string;
  /** Instance name shown in the header, footer and default footer copy; defaults to WonderMoney. */
  brandName?: string;
}

const SHELL_COPY = {
  en: {
    greeting: (name?: string) => (name ? `Hi ${name},` : "Hi there,"),
    marketingFooterDefault: (brand: string) => `You're receiving this because you have a ${brand} account with product communications on.`,
    unsubscribe: "Unsubscribe from product updates",
    settings: "Notification settings",
    privacy: "Privacy",
    transactionalFooter: (brand: string) => `This is a billing notice for your ${brand} account.`,
  },
  pt: {
    greeting: (name?: string) => (name ? `Olá ${name},` : "Olá,"),
    marketingFooterDefault: (brand: string) => `Recebeste este email por teres uma conta ${brand} e comunicações de produto ativas.`,
    unsubscribe: "Cancelar comunicações de produto",
    settings: "Definições de notificações",
    privacy: "Privacidade",
    transactionalFooter: (brand: string) => `Este é um aviso de faturação relativo à tua conta ${brand}.`,
  },
} as const satisfies Record<TransactionalEmailLanguage, Record<string, unknown>>;

export function LifecycleEmailLayout({
  language = "pt",
  preview,
  firstName,
  heading,
  intro,
  visual,
  children,
  ctaLabel,
  ctaUrl,
  footerMode = "marketing",
  marketingFooterText,
  unsubscribeUrl = "[[UNSUB_LINK_PT]]",
  settingsUrl,
  privacyUrl,
  brandName,
}: LifecycleEmailLayoutProps) {
  const brand = resolveBrandName(brandName);
  const t = SHELL_COPY[language];
  const greeting = t.greeting(firstName?.trim() ? firstName.trim() : undefined);

  return (
    <Html lang={language}>
      <Head />
      <Preview>{preview}</Preview>
      <Tailwind
        config={{
          presets: [pixelBasedPreset],
          theme: {
            extend: {
              fontFamily: {
                sans: ["Geist", "Helvetica Neue", "Arial", "sans-serif"],
                mono: ["Geist Mono", "SFMono-Regular", "Consolas", "monospace"],
              },
            },
          },
        }}
      >
        <Body className="m-0 bg-[#f7f8fa] px-[12px] py-[28px] font-sans text-[#111111]">
          <Container className="mx-auto w-full max-w-[600px]">
            <Section className="border-t-[3px] border-solid border-x-0 border-b-0 border-[#7c3aed] bg-white px-[26px] pb-[28px] pt-[22px]">
              <BrandHeader brandName={brand} />
              <Text className="m-0 mt-[24px] font-sans text-[15px] leading-[23px] text-[#374151]">
                {greeting}
              </Text>
              <Heading as="h1" className="m-0 mt-[9px] font-sans text-[28px] font-semibold leading-[35px] text-[#111111]">
                {heading}
              </Heading>
              <Text className="m-0 mt-[12px] font-sans text-[16px] leading-[25px] text-[#374151]">
                {intro}
              </Text>

              {visual ? <Section className="mt-[22px]">{visual}</Section> : null}

              <Section className="mt-[21px] font-sans text-[14px] leading-[22px] text-[#4b5563]">
                {children}
              </Section>

              {ctaLabel && ctaUrl ? (
                <Button
                  href={ctaUrl}
                  className="mt-[22px] box-border rounded-[8px] bg-[#7c3aed] px-[22px] py-[13px] text-center font-sans text-[15px] font-semibold leading-[20px] text-white no-underline"
                >
                  {ctaLabel}
                </Button>
              ) : null}
            </Section>

            <Section className="px-[20px] pb-[8px] pt-[20px] text-center">
              {footerMode === "marketing" ? (
                <>
                  <Text className="m-0 font-sans text-[11px] leading-[18px] text-[#6b7280]">
                    {marketingFooterText ?? t.marketingFooterDefault(brand)}
                  </Text>
                  <Text className="m-0 mt-[5px] font-sans text-[11px] leading-[18px] text-[#6b7280]">
                    <Link href={unsubscribeUrl} className="text-[#6b7280] underline">
                      {t.unsubscribe}
                    </Link>
                  </Text>
                  {settingsUrl || privacyUrl ? (
                    <Text className="m-0 mt-[5px] font-sans text-[11px] leading-[18px] text-[#6b7280]">
                      {settingsUrl ? (
                        <Link href={settingsUrl} className="text-[#6b7280] underline">
                          {t.settings}
                        </Link>
                      ) : null}
                      {settingsUrl && privacyUrl ? " · " : null}
                      {privacyUrl ? (
                        <Link href={privacyUrl} className="text-[#6b7280] underline">
                          {t.privacy}
                        </Link>
                      ) : null}
                    </Text>
                  ) : null}
                </>
              ) : (
                <Text className="m-0 font-sans text-[11px] leading-[18px] text-[#6b7280]">
                  {t.transactionalFooter(brand)}
                </Text>
              )}
              <Hr className="my-[15px] border-[#e5e7eb]" />
              <BrandFooterLine brandName={brand} />
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
