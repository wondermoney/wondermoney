import { useState, useMemo } from "react";
import { useTranslations } from "@/lib/reactTranslations";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";
import { Input } from "@/components/ui/input";

type SearchableItem = {
  title: string;
  description?: string;
  href: string;
  category?: string;
  date?: string;
};

type Props = {
  items: SearchableItem[];
  placeholder?: string;
  /** The field's accessible name, naming what it searches ("Search guides"); a placeholder is not one. */
  label?: string;
};

export default function ContentSearch({ items, placeholder, label, locale }: Props & { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <ContentSearchContent items={items} placeholder={placeholder} label={label} />
    </ReactTranslationsProvider>
  );
}

function ContentSearchContent({ items, placeholder, label }: Props) {
  const { t } = useTranslations();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query.trim()) return null;
    const q = query.toLowerCase();
    return items.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        (item.description && item.description.toLowerCase().includes(q)) ||
        (item.category && item.category.toLowerCase().includes(q)),
    );
  }, [query, items]);

  return (
    <div className="mt-8">
      <Input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label={label || t("global.search.label")}
        placeholder={placeholder || t("global.search.placeholder")}
        prefix={
          <svg
            aria-hidden="true"
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
            />
          </svg>
        }
      />

      {filtered !== null && (
        <div className="mt-6">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("global.search.noResults")}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="group rounded-card border border-border p-5 transition-colors hover:border-primary/40 hover:bg-accent"
                >
                  {item.category && (
                    <span className="inline-block rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                      {t(`category.${item.category}`, { defaultValue: item.category })}
                    </span>
                  )}
                  <h3 className="mt-2 text-lg font-semibold text-foreground group-hover:text-primary">
                    {item.title}
                  </h3>
                  {item.description && (
                    <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">
                      {item.description}
                    </p>
                  )}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
