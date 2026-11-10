import { useState, useMemo } from "react";
import { useTranslations } from "@/lib/reactTranslations";
import type { Lang } from "@/lib/i18nLocale";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";

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
};

export default function ContentSearch({ items, placeholder, locale }: Props & { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <ContentSearchContent items={items} placeholder={placeholder} />
    </ReactTranslationsProvider>
  );
}

function ContentSearchContent({ items, placeholder }: Props) {
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
      <div className="relative">
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
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
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder || t("global.search.placeholder")}
          className="w-full rounded-lg border border-input py-2.5 pl-10 pr-4 text-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

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
