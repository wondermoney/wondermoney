import type { ReactNode } from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Tailwind,
  Text,
  pixelBasedPreset,
} from "react-email";

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
}

const SHELL_COPY = {
  en: {
    greeting: (name?: string) => (name ? `Hi ${name},` : "Hi there,"),
    marketingFooterDefault: "You're receiving this because you have a WonderMoney account with product communications on.",
    unsubscribe: "Unsubscribe from product updates",
    settings: "Notification settings",
    privacy: "Privacy",
    transactionalFooter: "This is a billing notice for your WonderMoney account.",
  },
  pt: {
    greeting: (name?: string) => (name ? `Olá ${name},` : "Olá,"),
    marketingFooterDefault: "Recebeste este email por teres uma conta WonderMoney e comunicações de produto ativas.",
    unsubscribe: "Cancelar comunicações de produto",
    settings: "Definições de notificações",
    privacy: "Privacidade",
    transactionalFooter: "Este é um aviso de faturação relativo à tua conta WonderMoney.",
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
}: LifecycleEmailLayoutProps) {
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
              <Img
                src="https://app.wonder.money/logo.png"
                width="125"
                height="46"
                alt="WonderMoney"
                className="block h-[46px] w-[125px] object-contain"
              />
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
                    {marketingFooterText ?? t.marketingFooterDefault}
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
                  {t.transactionalFooter}
                </Text>
              )}
              <Hr className="my-[15px] border-[#e5e7eb]" />
              <Text className="m-0 font-sans text-[10px] leading-[16px] text-[#9ca3af]">
                WonderMoney · Radix Catch, Lda. · Portugal
              </Text>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
