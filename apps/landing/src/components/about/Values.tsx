import { Shield, Lock, CircleCheck } from "lucide-react";
import Section from "../shared/Section";
import { useTranslations } from "@/lib/reactTranslations";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";

export default function Values({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <ValuesContent />
    </ReactTranslationsProvider>
  );
}

function ValuesContent() {
  const { t } = useTranslations();

  const valuesData = [
    {
      name: t("about.values.value1.title"),
      icon: Shield,
      description: t("about.values.value1.description"),
    },
    {
      name: t("about.values.value2.title"),
      icon: Lock,
      description: t("about.values.value2.description"),
    },
    {
      name: t("about.values.value3.title"),
      icon: CircleCheck,
      description: t("about.values.value3.description"),
    },
  ];

  return (
    <Section>
      <div className="max-w-7xl lg:px-8">
        <div className="max-w-2xl lg:mx-0">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            <span className="mb-4 block text-base tracking-normal text-foreground">{t("about.values.pretitle")}</span>{" "}
            {t("about.values.title")}
          </h2>
          <p className="mt-6 text-lg leading-8 text-muted-foreground">
            {t("about.values.subtitle")}
          </p>
        </div>
        <div className="mt-16 max-w-2xl sm:mt-20 lg:mt-24 lg:max-w-none">
          <dl className="grid max-w-xl grid-cols-1 gap-x-8 gap-y-16 lg:max-w-none lg:grid-cols-3">
            {valuesData.map((value) => (
              <div key={value.name} className="flex flex-col">
                <dt className="text-base font-semibold leading-7 text-foreground">
                  <div className="mb-6 flex h-10 w-10 items-center justify-center rounded-lg">
                    <value.icon
                      className="size-8 text-primary"
                      aria-hidden="true"
                    />
                  </div>
                  {value.name}
                </dt>
                <dd className="mt-1 flex flex-auto flex-col text-base leading-7 text-muted-foreground">
                  <p className="flex-auto">{value.description}</p>
                  {/* <p className="mt-6">
                    <a
                      href={value.href}
                      className="text-sm font-semibold leading-6 text-primary"
                    >
                      {t("about.values.learnMore")}
                    </a>
                  </p> */}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </Section>
  );
}
