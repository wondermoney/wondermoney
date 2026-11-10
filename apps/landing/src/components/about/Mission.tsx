import mission from "../../assets/mission.webp";
import Section from "../shared/Section";
import { useTranslations } from "@/lib/reactTranslations";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";

export default function Mission({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <MissionContent />
    </ReactTranslationsProvider>
  );
}

function MissionContent() {
  const { t } = useTranslations();

  return (
    <Section>
      <div className="w-full max-w-7xl lg:px-8">
        <div className="grid max-w-2xl grid-cols-1 gap-x-8 gap-y-8 lg:mx-0 lg:max-w-none lg:grid-cols-2">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            <span className="mb-4 block text-base tracking-normal text-foreground">{t("about.mission.title")}</span>{" "}
            {t("about.mission.statement")}
          </h2>
          <div className="lg:max-w-lg">
            <p className="max-w-xl leading-7 text-muted-foreground">
              {t("about.mission.description")}
            </p>
          </div>
        </div>
      </div>
      <div className="rounded-xl lg:rounded-2xl lg:px-8">
        <img
          src={mission.src}
          alt="man working in laptop"
          width={1600}
          height={741}
        />
      </div>
    </Section>
  );
}
