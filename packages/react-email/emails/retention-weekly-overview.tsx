import { LifecycleEmailLayout } from "./components/LifecycleEmail";
import { MetricsPanel, type MetricItem } from "./components/LifecycleVisuals";
import type { LifecycleTrackingProps } from "./lib/lifecycle";
import { buildCampaignUrl } from "./lib/urls";

export const subject = "A tua semana financeira, em 60 segundos";
export const preheader = "Património, gastos, orçamento e investimentos num resumo curto.";

export interface RetentionWeeklyOverviewProps extends LifecycleTrackingProps {
  firstName?: string;
  netWorth: string;
  netWorthChange?: string;
  weeklySpending?: string;
  topCategory?: string;
  budgetStatus?: string;
  portfolioChange?: string;
}

export default function RetentionWeeklyOverview({
  firstName,
  netWorth,
  netWorthChange,
  weeklySpending,
  topCategory,
  budgetStatus,
  portfolioChange,
  destinationUrl = "https://app.wonder.money/pt",
  nextPath = "/pt",
  utmSource = "mailjet",
  utmMedium = "email",
  utmCampaign = "retention_weekly_overview",
  utmContent = "active_weekly_digest",
  unsubscribeUrl = "[[UNSUB_LINK_PT]]",
}: RetentionWeeklyOverviewProps) {
  const ctaUrl = buildCampaignUrl({ destinationUrl, nextPath, utmSource, utmMedium, utmCampaign, utmContent });
  const metrics: MetricItem[] = [
    {
      label: "Património líquido",
      value: netWorth,
      detail: netWorthChange ? `Variação na semana: ${netWorthChange}` : undefined,
    },
  ];

  if (weeklySpending) metrics.push({ label: "Gastos esta semana", value: weeklySpending, detail: topCategory ? `Maior categoria: ${topCategory}` : undefined });
  if (budgetStatus) metrics.push({ label: "Estado do orçamento", value: budgetStatus });
  if (portfolioChange) metrics.push({ label: "Variação dos Portefólios", value: portfolioChange });

  return (
    <LifecycleEmailLayout
      preview={preheader}
      firstName={firstName}
      heading="A semana, resumida nos números que mudaram"
      intro="Um resumo curto ajuda-te a manter o contexto sem teres de rever cada conta ou movimento em separado."
      visual={<MetricsPanel title="Resumo semanal" metrics={metrics} />}
      ctaLabel="Ver o resumo completo"
      ctaUrl={ctaUrl}
      unsubscribeUrl={unsubscribeUrl}
    >
      <p className="m-0">Abre o resumo para veres o detalhe por conta, confirmar transações recentes e perceber de onde vieram as principais alterações.</p>
      <p className="m-0 mt-[10px]">Os valores refletem os dados atualizados disponíveis na tua conta no momento em que este email foi preparado.</p>
    </LifecycleEmailLayout>
  );
}

RetentionWeeklyOverview.PreviewProps = {
  firstName: "Marta",
  netWorth: "€42.860,20",
  netWorthChange: "+€315,40",
  weeklySpending: "€286,70",
  topCategory: "Supermercado",
  budgetStatus: "62% utilizado",
  portfolioChange: "+1,8%",
} satisfies RetentionWeeklyOverviewProps;
