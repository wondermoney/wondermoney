"use client";

import { useTranslations } from "next-intl";

import Logo from "@/components/layout/Logo";
import { Heading, Text } from "@/components/ui/Typography";
import { useSupportEmail } from "@/lib/api/instance/useInstance";
import { useHydrated } from "@/lib/utils/useHydrated";

const QUESTION_KEYS = ["q1", "q2", "q3", "q4", "q5", "q6"] as const;

export function FaqContent() {
  const t = useTranslations("faq");
  // After hydration only, so the server's answer-less render (no q6) and the
  // first client render agree even when the instance query has already landed.
  const hydrated = useHydrated();
  const instanceSupportEmail = useSupportEmail();
  const supportEmail = hydrated ? instanceSupportEmail : null;
  // The last answer is "write to us"; without a support inbox there is nowhere to write.
  const questions = QUESTION_KEYS.filter((key) => key !== "q6" || supportEmail);

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
          {questions.map((key) => (
            <div key={key} className="space-y-2">
              {/* An h2 at the h3 size: the page went h1 to h3. */}
              <h2 className="scroll-m-20 text-2xl font-semibold tracking-tight">
                {t(`${key}Title`)}
              </h2>
              <Text className="text-muted-foreground leading-6">
                {key === "q6"
                  ? t(`${key}Body`, { email: supportEmail ?? "" })
                  : t(`${key}Body`)}
              </Text>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
