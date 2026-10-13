import { Fragment } from "react";
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

import { StepFlow } from "../components/LifecycleVisuals.js";
import type { LifecycleNudgeEmailProps, TransactionalEmailLanguage } from "../types";

export type { LifecycleNudgeEmailProps } from "../types";

const FOOTER = {
  en: { note: "You're receiving this as part of your WonderMoney account.", unsubscribe: "Unsubscribe", settings: "Notification settings" },
  pt: { note: "Recebes este email por teres uma conta WonderMoney.", unsubscribe: "Cancelar subscrição", settings: "Definições de notificações" },
} as const satisfies Record<TransactionalEmailLanguage, Record<string, string>>;

function greetingFor(language: TransactionalEmailLanguage, firstName?: string): string {
  const name = firstName?.trim();
  if (language === "pt") return name ? `Olá ${name},` : "Olá,";
  return name ? `Hi ${name},` : "Hi there,";
}

export const getLifecycleNudgePreheader = (props: Pick<LifecycleNudgeEmailProps, "body" | "preheader">) =>
  props.preheader?.trim() ? props.preheader.trim() : (props.body[0] ?? "");

export default function LifecycleNudgeEmail({
  language,
  firstName,
  heading,
  body,
  steps,
  ctaLabel,
  ctaUrl,
  unsubscribeUrl,
  settingsUrl,
  footerNote,
}: LifecycleNudgeEmailProps) {
  const t = FOOTER[language];

  return (
    <Html lang={language}>
      <Head />
      <Preview>{getLifecycleNudgePreheader({ body, preheader: undefined })}</Preview>
      <Tailwind
        config={{
          presets: [pixelBasedPreset],
          theme: { extend: { fontFamily: { sans: ["Geist", "Helvetica Neue", "Arial", "sans-serif"], mono: ["Geist Mono", "SFMono-Regular", "Consolas", "monospace"] } } },
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
                {greetingFor(language, firstName)}
              </Text>
              <Heading as="h1" className="m-0 mt-[9px] font-sans text-[26px] font-semibold leading-[33px] text-[#111111]">
                {heading}
              </Heading>

              {body.map((paragraph, index) => (
                <Fragment key={index}>
                  <Text className="m-0 mt-[13px] font-sans text-[16px] leading-[25px] text-[#374151]">
                    {paragraph}
                  </Text>
                  {steps && index === 0 ? (
                    <Section className="mt-[16px]">
                      <StepFlow steps={steps} />
                    </Section>
                  ) : null}
                </Fragment>
              ))}

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
              <Text className="m-0 font-sans text-[11px] leading-[18px] text-[#6b7280]">{footerNote ?? t.note}</Text>
              <Text className="m-0 mt-[5px] font-sans text-[11px] leading-[18px] text-[#6b7280]">
                <Link href={unsubscribeUrl} className="text-[#6b7280] underline">{t.unsubscribe}</Link>
                {settingsUrl ? (
                  <>
                    {" · "}
                    <Link href={settingsUrl} className="text-[#6b7280] underline">{t.settings}</Link>
                  </>
                ) : null}
              </Text>
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
