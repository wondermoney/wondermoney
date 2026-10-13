import {
  Body,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Row,
  Section,
  Tailwind,
  Text,
  pixelBasedPreset,
} from "react-email";

import type { InternalAlertEmailProps } from "../types";

export type { InternalAlertDetail, InternalAlertEmailProps } from "../types";

const ACCENT = { info: "#7c3aed", warning: "#b45309" } as const;

export const getInternalAlertPreheader = (props: Pick<InternalAlertEmailProps, "intro" | "title">) =>
  props.intro?.trim() ? props.intro.trim() : props.title;

export default function InternalAlertEmail({
  variant = "info",
  title,
  intro,
  details = [],
}: InternalAlertEmailProps) {
  const accent = ACCENT[variant];

  return (
    <Html lang="en">
      <Head />
      <Preview>{getInternalAlertPreheader({ intro, title })}</Preview>
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
            <Section
              className="border-t-[3px] border-solid border-x-0 border-b-0 bg-white px-[26px] pb-[26px] pt-[20px]"
              style={{ borderTopColor: accent }}
            >
              <Text className="m-0 font-sans text-[11px] font-semibold uppercase leading-[16px] tracking-[0.06em]" style={{ color: accent }}>
                WonderMoney · Internal {variant === "warning" ? "alert" : "notice"}
              </Text>
              <Heading as="h1" className="m-0 mt-[8px] font-sans text-[22px] font-semibold leading-[29px] text-[#111111]">
                {title}
              </Heading>
              {intro?.trim() ? (
                <Text className="m-0 mt-[10px] whitespace-pre-line font-sans text-[14px] leading-[22px] text-[#374151]">
                  {intro}
                </Text>
              ) : null}

              {details.length > 0 ? (
                <Section className="mt-[18px] rounded-[8px] border border-solid border-[#e5e7eb] px-[16px] py-[6px]">
                  {details.map((detail, index) => (
                    <Row key={`${index}-${detail.label}`}>
                      <Column className="py-[8px] align-top" style={{ borderTop: index > 0 ? "1px solid #eef0f2" : undefined, width: "38%" }}>
                        <Text className="m-0 font-sans text-[12px] leading-[18px] text-[#6b7280]">{detail.label}</Text>
                      </Column>
                      <Column className="py-[8px] align-top" style={{ borderTop: index > 0 ? "1px solid #eef0f2" : undefined }}>
                        <Text className="m-0 break-words font-mono text-[12px] leading-[18px] text-[#111111]">{detail.value || "—"}</Text>
                      </Column>
                    </Row>
                  ))}
                </Section>
              ) : null}
            </Section>

            <Section className="px-[20px] pb-[8px] pt-[18px] text-center">
              <Hr className="my-[10px] border-[#e5e7eb]" />
              <Text className="m-0 font-sans text-[10px] leading-[16px] text-[#9ca3af]">
                Automated internal notification · WonderMoney · Radix Catch, Lda.
              </Text>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
