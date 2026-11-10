import Section from "../shared/Section";
import { useTranslations } from "@/lib/reactTranslations";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";

export default function Story({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <StoryContent />
    </ReactTranslationsProvider>
  );
}

function StoryContent() {
  const { t } = useTranslations();

  return (
    <Section>
      <div className="w-full max-w-7xl lg:px-8">
        <p className="text-primary mb-6 font-semibold text-sm">
          {t("about.story.title")}
        </p>
        <div className="max-w-2xl space-y-6">
          <p className="leading-7 text-muted-foreground">
            {t("about.story.paragraph1")}
          </p>
          <p className="leading-7 text-muted-foreground">
            {t("about.story.paragraph2")}
          </p>
          <p className="leading-7 text-muted-foreground">
            {t("about.story.paragraph3")}
          </p>
        </div>
      </div>
    </Section>
  );
}
