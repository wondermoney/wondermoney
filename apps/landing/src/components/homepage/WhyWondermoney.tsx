import { Globe, Layers, Banknote, ShieldCheck } from "lucide-react";
import Section from "../shared/Section";
import { useTranslations } from "@/lib/reactTranslations";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";

const cards = [
  { icon: Globe, key: "card1" },
  { icon: Layers, key: "card2" },
  { icon: Banknote, key: "card3" },
  { icon: ShieldCheck, key: "card4" },
] as const;

export default function WhyWondermoney({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <WhyWondermoneyContent />
    </ReactTranslationsProvider>
  );
}

function WhyWondermoneyContent() {
  const { t } = useTranslations();

  return (
    <Section
      title={t("homepage.whyWondermoney.title")}
      subTitle={t("homepage.whyWondermoney.subtitle")}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-4xl">
        {cards.map((card) => (
          <div
            key={card.key}
            className="border border-border rounded-card p-6 bg-background"
          >
            <card.icon className="h-8 w-8 text-primary" />
            <h3 className="mt-4 text-lg font-semibold text-foreground">
              {t(`homepage.whyWondermoney.${card.key}.title`)}
            </h3>
            <p className="mt-2 text-muted-foreground leading-7">
              {t(`homepage.whyWondermoney.${card.key}.description`)}
            </p>
          </div>
        ))}
      </div>
    </Section>
  );
}
