import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion";
import { useTranslations } from "@/lib/reactTranslations";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";

const faqKeys = ["faq1", "faq2", "faq3", "faq5"];

export default function Faq({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <FaqContent />
    </ReactTranslationsProvider>
  );
}

function FaqContent() {
  const { t } = useTranslations();

  return (
    <section className="border-t border-border bg-background">
      <div className="mx-auto grid max-w-7xl gap-12 px-6 py-24 lg:grid-cols-12 lg:gap-10 lg:px-8 lg:py-32">
        <div className="min-w-0 lg:col-span-5">
          <h2 className="text-4xl font-semibold leading-[1.08] tracking-[-0.02em] text-foreground sm:text-5xl lg:text-[3.25rem]">
            {t("homepage.faq.title")}
          </h2>
          <p className="mt-6 text-lg leading-8 text-muted-foreground">
            {t("homepage.faq.subtitle")}
          </p>
        </div>
        <Accordion
          type="single"
          collapsible
          className="w-full min-w-0 border-t border-border lg:col-span-6 lg:col-start-7"
        >
          {faqKeys.map((key, index) => (
            <AccordionItem key={index} value={`item-${index}`}>
              <AccordionTrigger className="py-3.5 text-left text-base">
                {t(`homepage.faq.${key}.question`)}
              </AccordionTrigger>
              <AccordionContent className="max-w-2xl text-base leading-7 text-muted-foreground">
                {t(`homepage.faq.${key}.answer`)}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
