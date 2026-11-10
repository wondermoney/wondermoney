interface ResultItem {
  label: string;
  value: string;
  highlight?: boolean;
}

interface Props {
  items: ResultItem[];
}

export default function CalculatorResult({ items }: Props) {
  return (
    <div className="space-y-4">
      {items.map((item, index) => (
        <div
          key={index}
          className={
            item.highlight
              ? "border-t-2 border-primary/30 pt-4"
              : ""
          }
        >
          <p className="text-sm text-muted-foreground">{item.label}</p>
          <p
            className={
              item.highlight
                ? "text-2xl font-bold font-mono text-primary"
                : "text-xl font-semibold font-mono text-foreground"
            }
          >
            {item.value}
          </p>
        </div>
      ))}
    </div>
  );
}
