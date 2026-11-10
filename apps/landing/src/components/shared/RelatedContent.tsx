import { useTranslations } from "@/lib/reactTranslations";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";

type ContentType = "calculator" | "guide" | "glossary";

type RelatedItem = {
  title: string;
  description: string;
  href: string;
  type: ContentType;
};

type RelatedContentContentProps = {
  items: RelatedItem[];
  title?: string;
};

export type Props = RelatedContentContentProps & {
  locale: Lang;
};

const typeColors: Record<ContentType, string> = {
  calculator: "bg-primary/10 text-primary",
  guide: "bg-success/10 text-success-text",
  glossary: "bg-warning/10 text-warning-text",
};

export default function RelatedContent({ items, title, locale }: Props) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <RelatedContentContent items={items} title={title} />
    </ReactTranslationsProvider>
  );
}

function RelatedContentContent({ items, title }: RelatedContentContentProps) {
  const { t } = useTranslations();

  if (!items || items.length === 0) return null;

  const typeLabels: Record<ContentType, string> = {
    calculator: t("global.relatedContent.calculator"),
    guide: t("global.relatedContent.guide"),
    glossary: t("global.relatedContent.glossary"),
  };

  return (
    <section className="py-12">
      <h2 className="text-2xl font-bold tracking-tight text-foreground">
        {title || t("global.relatedContent.title")}
      </h2>
      <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className="group rounded-card border border-border p-6 transition-colors hover:border-primary/40 hover:bg-accent"
          >
            <span
              className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${typeColors[item.type]}`}
            >
              {typeLabels[item.type]}
            </span>
            <h3 className="mt-3 text-lg font-semibold text-foreground group-hover:text-primary">
              {item.title}
            </h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {item.description}
            </p>
            <span className="mt-4 inline-block text-sm font-medium text-primary underline underline-offset-4 decoration-primary/40 group-hover:opacity-80">
              {t("global.relatedContent.view")}
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}
