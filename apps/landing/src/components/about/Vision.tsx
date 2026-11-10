import { CircleCheck } from "lucide-react";
import Section from "../shared/Section";
import { useTranslations } from "@/lib/reactTranslations";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";

export default function Vision({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <VisionContent />
    </ReactTranslationsProvider>
  );
}

function VisionContent() {
  const { t } = useTranslations();

  const items = [
    t("about.vision.item1"),
    t("about.vision.item2"),
    t("about.vision.item3"),
    t("about.vision.item4"),
  ];

  return (
    <Section>
      <div className="w-full max-w-7xl lg:px-8">
        <div className="grid max-w-2xl grid-cols-1 gap-x-8 gap-y-8 lg:mx-0 lg:max-w-none lg:grid-cols-2">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            <span className="mb-4 block text-base tracking-normal text-foreground">{t("about.vision.title")}</span>{" "}
            {t("about.vision.headline")}
          </h2>
          <div className="lg:ml-auto lg:pl-4 lg:pt-4">
            <ul className="max-w-xl space-y-6 leading-7 text-muted-foreground lg:max-w-none">
              {items.map((item, i) => (
                <li key={item} className="flex flex-col gap-2">
                  <div className="flex gap-2 items-start">
                    <CircleCheck
                      className="size-4 text-primary shrink-0 mt-1"
                      aria-hidden="true"
                    />
                    <span className="font-semibold">{item}</span>
                  </div>
                  <span>{t(`about.vision.item${i + 1}desc`)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </Section>
  );
}
