"use client";

import { useTranslations } from "next-intl";

import Logo from "@/components/layout/Logo";
import { Heading, Text } from "@/components/ui/Typography";

const QUESTION_KEYS = ["q1", "q2", "q3", "q4", "q5", "q6"] as const;

export function FaqContent() {
  const t = useTranslations("faq");
  const tRoot = useTranslations();
  const supportEmail = tRoot("support-email");

  return (
    <main className="bg-muted/40 flex min-h-dvh justify-center px-4 py-12 sm:px-6">
      <div className="w-full max-w-2xl space-y-10">
        <div className="flex flex-col items-center space-y-6 text-center">
          <Logo />
          <div className="space-y-2">
            <Heading variant="h1">{t("title")}</Heading>
            <Text variant="mutedText" className="text-muted-foreground">
              {t("intro")}
            </Text>
          </div>
        </div>

        <div className="space-y-8">
          {QUESTION_KEYS.map((key) => (
            <div key={key} className="space-y-2">
              <Heading variant="h3">{t(`${key}Title`)}</Heading>
              <Text className="text-muted-foreground leading-6">
                {key === "q6"
                  ? t(`${key}Body`, { email: supportEmail })
                  : t(`${key}Body`)}
              </Text>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
