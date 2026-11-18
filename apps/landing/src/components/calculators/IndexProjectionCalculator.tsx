import { useEffect, useMemo, useRef, useState } from "react";
import {
  computeIndexProjection,
  INDEX_PROJECTION_EXAMPLE,
  INDEX_PROJECTION_LIMITS,
  type IndexProjectionInput,
} from "@/lib/calculators/indexProjection";
import { getPageType, pushGtmEvent } from "@/lib/gtm";
import type { Lang } from "@/lib/i18nLocale";
import { formatMoney, formatNumber } from "@/lib/numberFormat";
import { ReactTranslationsProvider, useTranslations } from "@/lib/reactTranslations";
import CalculatorInput from "./CalculatorInput";
import CalculatorLayout from "./CalculatorLayout";
import CalculatorResult from "./CalculatorResult";

const key = "tools.investmentReturn.projection";

export default function IndexProjectionCalculator({ locale }: { locale: Lang }) {
  return (
    <ReactTranslationsProvider locale={locale}>
      <IndexProjectionContent />
    </ReactTranslationsProvider>
  );
}

function IndexProjectionContent() {
  const { t, locale } = useTranslations();
  const [input, setInput] = useState(INDEX_PROJECTION_EXAMPLE);
  const projection = useMemo(() => computeIndexProjection(input), [input]);
  const reported = useRef(false);

  useEffect(() => {
    if (input === INDEX_PROJECTION_EXAMPLE || projection.status !== "ok" || reported.current) return;
    reported.current = true;
    pushGtmEvent({
      event: "tool_used",
      tool: "investment_return",
      mode: "index_projection",
      page_type: getPageType(),
    });
  }, [input, projection.status]);

  const field = (
    id: keyof IndexProjectionInput,
    step: number,
    units: { prefix?: string; suffix?: string } = {},
  ) => {
    const { min, max } = INDEX_PROJECTION_LIMITS[id];
    return (
      <CalculatorInput
        id={`index-${id}`}
        label={t(`${key}.${id}`)}
        value={input[id]}
        onChange={(value) => setInput((current) => ({ ...current, [id]: value }))}
        min={min}
        max={max}
        step={step}
        helpText={t(`${key}.range`, { min: formatNumber(locale, min), max: formatNumber(locale, max) })}
        {...units}
      />
    );
  };

  return (
    <CalculatorLayout>
      <div className="space-y-5 rounded-card border border-border bg-background p-6">
        {field("principal", 100, { prefix: "€" })}
        {field("monthlyContribution", 50, { prefix: "€" })}
        {field("annualRate", 0.1, { suffix: "%" })}
        {field("annualFee", 0.05, { suffix: "%" })}
        {field("years", 1)}
      </div>
      <div className="rounded-card border border-border bg-background p-6 lg:sticky lg:top-24" aria-live="polite">
        {projection.status === "ok" ? (
          <CalculatorResult items={[
            { label: t(`${key}.contributed`), value: formatMoney(locale, projection.contributed) },
            { label: t(`${key}.beforeFees`), value: formatMoney(locale, projection.beforeFees) },
            { label: t(`${key}.afterFees`), value: formatMoney(locale, projection.afterFees), highlight: true },
            { label: t(`${key}.feeImpact`), value: formatMoney(locale, projection.feeImpact) },
          ]} />
        ) : (
          <p className="text-sm text-muted-foreground">{t(`${key}.${projection.status}`)}</p>
        )}
      </div>
    </CalculatorLayout>
  );
}
