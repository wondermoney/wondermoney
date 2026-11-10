import { useTranslations } from "@/lib/reactTranslations";

function StepCard({
  number,
  title,
  body,
}: {
  number: number;
  title: string;
  body: string;
}) {
  return (
    <div className="flex gap-5">
      <div className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold text-sm">
        {number}
      </div>
      <div>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

type Props = {
  titleKey: string;
  steps: { titleKey: string; bodyKey: string }[];
};

export default function HowItWorks({ titleKey, steps }: Props) {
  const { t } = useTranslations();

  return (
    <section className="py-16 md:py-20 bg-paper-2">
      <div className="mx-auto max-w-3xl px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground">
            {t(titleKey)}
          </h2>
        </div>
        <div className="flex flex-col gap-10">
          {steps.map((step, i) => (
            <StepCard
              key={i}
              number={i + 1}
              title={t(step.titleKey)}
              body={t(step.bodyKey)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
