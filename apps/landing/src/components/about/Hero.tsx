import SectionHero from "../shared/SectionHero";
import { useTranslations } from "@/lib/reactTranslations";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";

export default function Hero({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <HeroContent />
    </ReactTranslationsProvider>
  );
}

function HeroContent() {
  const { t } = useTranslations();

  return (
    <SectionHero
      title={t("about.hero.title")}
      subTitle={t("about.hero.subtitle")}
    />
  );
}
