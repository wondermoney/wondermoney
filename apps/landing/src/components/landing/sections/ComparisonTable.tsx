import { useTranslations } from "@/lib/reactTranslations";
import { Check, X } from "lucide-react";

type CellStatus = "check" | "cross";

type ComparisonRow = {
  featureKey: string;
  competitorKey: string;
  wmKey: string;
  wmHighlight?: boolean;
  competitorStatus?: CellStatus;
  wmStatus?: CellStatus;
};

type Props = {
  titleKey: string;
  subtitleKey: string;
  competitorName: string;
  featureLabelKey: string;
  rows: ComparisonRow[];
};

export default function ComparisonTable({
  titleKey,
  subtitleKey,
  competitorName,
  featureLabelKey,
  rows,
}: Props) {
  const { t } = useTranslations();

  return (
    <section className="py-16 md:py-20 bg-paper-2">
      <div className="mx-auto max-w-4xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center mb-10">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground">
            {t(titleKey)}
          </h2>
          <p className="mt-3 text-muted-foreground">{t(subtitleKey)}</p>
        </div>
        <div className="hidden md:block overflow-x-auto rounded-card border border-border">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-paper-2">
              <tr>
                <th className="px-6 py-4 text-left font-semibold text-foreground w-1/2">
                  {t(featureLabelKey)}
                </th>
                <th className="px-6 py-4 text-center font-semibold text-muted-foreground w-1/4">
                  {competitorName}
                </th>
                <th className="px-6 py-4 text-center font-semibold text-primary w-1/4">
                  WonderMoney
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-background">
              {rows.map((row, i) => (
                <tr key={i} className={i % 2 === 0 ? "bg-background" : "bg-paper-2/50"}>
                  <td className="px-6 py-4 text-foreground font-medium">{t(row.featureKey)}</td>
                  <td className="px-6 py-4 text-center text-muted-foreground">
                    <CellValue value={t(row.competitorKey)} status={row.competitorStatus} muted />
                  </td>
                  <td
                    className={`px-6 py-4 text-center font-medium ${row.wmHighlight ? "text-primary" : "text-foreground"}`}
                  >
                    <CellValue value={t(row.wmKey)} status={row.wmStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="md:hidden divide-y divide-border overflow-hidden rounded-card border border-border bg-background">
          {rows.map((row, i) => (
            <div key={i} className="p-4">
              <p className="text-sm font-semibold text-foreground">{t(row.featureKey)}</p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-paper-2 p-3">
                  <p className="text-[11px] font-semibold text-muted-foreground">
                    {competitorName}
                  </p>
                  <div className="mt-1 text-sm text-muted-foreground">
                    <CellValue value={t(row.competitorKey)} status={row.competitorStatus} muted />
                  </div>
                </div>
                <div className={`rounded-lg p-3 ${row.wmHighlight ? "bg-primary/10" : "bg-paper-2"}`}>
                  <p className="text-[11px] font-semibold text-primary">
                    WonderMoney
                  </p>
                  <div
                    className={`mt-1 text-sm font-medium ${row.wmHighlight ? "text-primary" : "text-foreground"}`}
                  >
                    <CellValue value={t(row.wmKey)} status={row.wmStatus} />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CellValue({
  value,
  status,
  muted = false,
}: {
  value: string;
  status?: CellStatus;
  muted?: boolean;
}) {
  if (status === "check") {
    return (
      <span className="inline-flex items-center gap-2">
        <Check className="h-4 w-4 flex-none text-success-text" aria-hidden="true" />
        <span>{value}</span>
      </span>
    );
  }
  if (status === "cross") {
    return (
      <span className={`inline-flex items-center gap-2 ${muted ? "text-muted-foreground" : ""}`}>
        <X className="h-4 w-4 flex-none text-destructive-text" aria-hidden="true" />
        <span>{value}</span>
      </span>
    );
  }
  return <>{value}</>;
}
