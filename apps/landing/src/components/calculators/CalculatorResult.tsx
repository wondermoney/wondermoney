interface ResultItem {
  label: string;
  value: string;
  highlight?: boolean;
}

interface Props {
  items: ResultItem[];
}

/**
 * A calculator's figures as a ledger: each line its label on the left and its value on the
 * right, a hairline between lines, in the order given. The `highlight` item is the answer:
 * its value is set large in the primary violet, under a firmer rule when lines come before
 * it (a total under its parts), or as the headline when it comes first.
 */
export default function CalculatorResult({ items }: Props) {
  return (
    <dl className="calculator-result">
      {items.map((item, index) =>
        item.highlight ? (
          <div
            key={index}
            className={index === 0 ? "pb-3" : "mt-1 border-t border-foreground/20 pt-4 pb-1"}
          >
            <dt className="text-sm font-medium text-foreground">{item.label}</dt>
            <dd className="mt-1 font-mono text-2xl font-semibold leading-tight tracking-tight text-primary sm:text-3xl">
              {item.value}
            </dd>
          </div>
        ) : (
          <div
            key={index}
            className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5 ${
              index > 0 ? "border-t border-border" : ""
            }`}
          >
            <dt className="text-sm text-ink-2 sm:text-base">{item.label}</dt>
            <dd className="ml-auto text-right font-mono text-base font-medium text-foreground sm:text-lg">
              {item.value}
            </dd>
          </div>
        ),
      )}
    </dl>
  );
}
