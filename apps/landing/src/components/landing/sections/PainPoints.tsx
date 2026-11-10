import { useTranslations } from "@/lib/reactTranslations";
import { X } from "lucide-react";

function PainCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-card border border-destructive-text/30 bg-background p-6">
      <h3 className="flex items-start gap-2 text-base font-semibold text-foreground">
        <X className="mt-0.5 h-5 w-5 flex-none text-destructive-text" aria-hidden="true" />
        {title}
      </h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
    </div>
  );
}

type Props = {
  titleKey: string;
  items: { titleKey: string; bodyKey: string }[];
};

export default function PainPoints({ titleKey, items }: Props) {
  const { t } = useTranslations();

  return (
    <section className="py-16 md:py-20">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center mb-12">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground">
            {t(titleKey)}
          </h2>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {items.map((item, i) => (
            <PainCard key={i} title={t(item.titleKey)} body={t(item.bodyKey)} />
          ))}
        </div>
      </div>
    </section>
  );
}
