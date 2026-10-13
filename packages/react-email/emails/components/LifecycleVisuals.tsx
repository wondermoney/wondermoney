import { Column, Hr, Row, Section, Text } from "react-email";

export interface StepItem {
  label: string;
  detail?: string;
}

export function StepFlow({ steps }: { steps: StepItem[] }) {
  return (
    <Section aria-label={steps.map((step) => step.label).join("; depois ")}>
      {steps.map((step, index) => (
        <Row key={step.label} className={index < steps.length - 1 ? "mb-[10px]" : ""}>
          <Column style={{ verticalAlign: "top", width: "30px" }}>
            <Text className="m-0 h-[22px] w-[22px] rounded-[6px] bg-[#ede9fe] text-center font-mono text-[11px] font-semibold leading-[22px] text-[#6d28d9]">
              {index + 1}
            </Text>
          </Column>
          <Column style={{ verticalAlign: "top" }}>
            <Text className="m-0 font-sans text-[13px] font-medium leading-[20px] text-[#111111]">
              {step.label}
            </Text>
            {step.detail ? (
              <Text className="m-0 mt-[1px] font-sans text-[11px] leading-[17px] text-[#6b7280]">
                {step.detail}
              </Text>
            ) : null}
          </Column>
        </Row>
      ))}
    </Section>
  );
}

export interface MetricItem {
  label: string;
  value: string;
  detail?: string;
  tone?: "positive" | "negative" | "neutral";
}

export function MetricsPanel({
  title,
  metrics,
}: {
  title: string;
  metrics: MetricItem[];
}) {
  const toneColor = (tone: MetricItem["tone"]) =>
    tone === "positive" ? "#16803c" : tone === "negative" ? "#b42318" : "#111111";

  return (
    <Section className="rounded-[10px] border border-solid border-[#e5e7eb] bg-white px-[18px] py-[16px]" aria-label={title}>
      <Text className="m-0 font-sans text-[12px] font-medium leading-[18px] text-[#374151]">
        {title}
      </Text>
      <Hr className="my-[11px] border-[#f0f1f3]" />
      {metrics.map((metric, index) => (
        <Section key={metric.label} className={index < metrics.length - 1 ? "mb-[11px]" : ""}>
          <Row>
            <Column>
              <Text className="m-0 font-sans text-[12px] leading-[18px] text-[#6b7280]">
                {metric.label}
              </Text>
              {metric.detail ? (
                <Text className="m-0 mt-[1px] font-sans text-[10px] leading-[15px] text-[#9ca3af]">
                  {metric.detail}
                </Text>
              ) : null}
            </Column>
            <Column align="right">
              <Text
                className="m-0 font-mono text-[14px] font-semibold leading-[20px]"
                style={{ color: toneColor(metric.tone) }}
              >
                {metric.value}
              </Text>
            </Column>
          </Row>
        </Section>
      ))}
    </Section>
  );
}

export function StatusPanel({
  label,
  status,
  detail,
  metadata,
}: {
  label: string;
  status: string;
  detail: string;
  metadata?: string;
}) {
  return (
    <Section className="rounded-[10px] border border-solid border-[#e5e7eb] bg-white px-[18px] py-[16px]" aria-label={`${label}: ${status}. ${detail}`}>
      <Row>
        <Column>
          <Text className="m-0 font-sans text-[11px] leading-[17px] text-[#6b7280]">{label}</Text>
          <Text className="m-0 mt-[2px] font-sans text-[14px] font-semibold leading-[21px] text-[#111111]">{status}</Text>
        </Column>
        {metadata ? (
          <Column align="right">
            <Text className="m-0 font-mono text-[11px] leading-[17px] text-[#6b7280]">{metadata}</Text>
          </Column>
        ) : null}
      </Row>
      <Text className="m-0 mt-[8px] font-sans text-[12px] leading-[18px] text-[#4b5563]">{detail}</Text>
    </Section>
  );
}

export interface ComparisonBarRow {
  formattedValue: string;
  label: string;
  widthPercent: number;
}

export function ComparisonBar({
  title,
  rows,
}: {
  title: string;
  rows: [ComparisonBarRow, ComparisonBarRow];
}) {
  return (
    <Section className="rounded-[10px] border border-solid border-[#e5e7eb] bg-white px-[18px] py-[16px]" aria-label={title}>
      <Text className="m-0 font-sans text-[12px] font-medium leading-[18px] text-[#374151]">
        {title}
      </Text>
      <Hr className="my-[11px] border-[#f0f1f3]" />
      {rows.map((row, index) => (
        <Section key={row.label} className={index === 0 ? "mb-[10px]" : ""}>
          <Row>
            <Column>
              <Text className="m-0 font-sans text-[11px] leading-[17px] text-[#6b7280]">{row.label}</Text>
            </Column>
            <Column align="right">
              <Text className="m-0 font-mono text-[12px] font-semibold leading-[18px] text-[#111111]">{row.formattedValue}</Text>
            </Column>
          </Row>
          <Row className="mt-[4px]">
            <Column>
              <table role="presentation" width="100%" cellPadding="0" cellSpacing="0" style={{ borderCollapse: "collapse" }}>
                <tr>
                  <td
                    width={`${Math.max(0, Math.min(100, row.widthPercent))}%`}
                    style={{ backgroundColor: index === 0 ? "#ede9fe" : "#7c3aed", borderRadius: "4px", height: "8px" }}
                  />
                  <td width={`${100 - Math.max(0, Math.min(100, row.widthPercent))}%`} />
                </tr>
              </table>
            </Column>
          </Row>
        </Section>
      ))}
    </Section>
  );
}

export function DeltaPillRow({ deltas }: { deltas: import("../../src/types").MonthlyStoryCategoryDelta[] }) {
  const toneColor = (direction: "increase" | "decrease") => (direction === "increase" ? "#b42318" : "#16803c");
  const toneBg = (direction: "increase" | "decrease") => (direction === "increase" ? "#fef2f2" : "#f0fdf4");
  const toneSign = (direction: "increase" | "decrease") => (direction === "increase" ? "▲" : "▼");

  return (
    <Section aria-label="Category changes">
      {deltas.map((delta, index) => (
        <Section key={delta.categoryName} className={index < deltas.length - 1 ? "mb-[10px]" : ""}>
          <Row>
            <Column>
              <Text className="m-0 font-sans text-[13px] font-medium leading-[20px] text-[#111111]">
                {delta.categoryName}
              </Text>
              <Text className="m-0 mt-[1px] font-mono text-[11px] leading-[17px] text-[#6b7280]">
                {delta.formattedBaselineAmount} → {delta.formattedSubjectAmount}
              </Text>
            </Column>
            <Column align="right" style={{ verticalAlign: "top" }}>
              <Text
                className="m-0 rounded-[10px] px-[8px] py-[3px] font-mono text-[11px] font-semibold leading-[16px]"
                style={{ backgroundColor: toneBg(delta.direction), color: toneColor(delta.direction), display: "inline-block" }}
              >
                {toneSign(delta.direction)} {delta.formattedDelta}
              </Text>
            </Column>
          </Row>
        </Section>
      ))}
    </Section>
  );
}
