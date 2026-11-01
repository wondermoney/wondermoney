import type { ReactNode } from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Tailwind,
  Text,
  pixelBasedPreset,
} from "react-email";

import { BrandFooterLine, BrandHeader, resolveBrandName } from "../../src/components/Brand";

export type TransactionalEmailLanguage = "en" | "pt";

export interface TransactionalEmailLayoutProps {
  language: TransactionalEmailLanguage;
  preview: string;
  firstName?: string;
  heading: string;
  intro: ReactNode;
  children: ReactNode;
  ctaLabel?: string;
  ctaUrl?: string;
  /** Localized single-line explanation of why the recipient got this email. */
  footerNote: string;
  /** Instance name shown in the header and footer; defaults to WonderMoney. */
  brandName?: string;
}

function greetingFor(language: TransactionalEmailLanguage, firstName?: string): string {
  const name = firstName?.trim();
  if (language === "pt") return name ? `Olá ${name},` : "Olá,";
  return name ? `Hi ${name},` : "Hi there,";
}

/**
 * Brand-consistent layout for TRANSACTIONAL emails (auth, receipts) — no marketing footer,
 * no unsubscribe, no tracking. Shares the WonderMoney visual system with `LifecycleEmailLayout`
 * but is localized (EN/PT) so it can back English auth emails without a Portuguese greeting.
 */
export function TransactionalEmailLayout({
  language,
  preview,
  firstName,
  heading,
  intro,
  children,
  ctaLabel,
  ctaUrl,
  footerNote,
  brandName,
}: TransactionalEmailLayoutProps) {
  const brand = resolveBrandName(brandName);
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
                {greetingFor(language, firstName)}
              </Text>
              <Heading as="h1" className="m-0 mt-[9px] font-sans text-[28px] font-semibold leading-[35px] text-[#111111]">
                {heading}
              </Heading>
              <Text className="m-0 mt-[12px] font-sans text-[16px] leading-[25px] text-[#374151]">
                {intro}
              </Text>

              {ctaLabel && ctaUrl ? (
                <Button
                  href={ctaUrl}
                  className="mt-[22px] box-border rounded-[8px] bg-[#7c3aed] px-[22px] py-[13px] text-center font-sans text-[15px] font-semibold leading-[20px] text-white no-underline"
                >
                  {ctaLabel}
                </Button>
              ) : null}

              <Section className="mt-[22px] font-sans text-[14px] leading-[22px] text-[#4b5563]">
                {children}
              </Section>
            </Section>

            <Section className="px-[20px] pb-[8px] pt-[20px] text-center">
              <Text className="m-0 font-sans text-[11px] leading-[18px] text-[#6b7280]">
                {footerNote}
              </Text>
              <Hr className="my-[15px] border-[#e5e7eb]" />
              <BrandFooterLine brandName={brand} />
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
