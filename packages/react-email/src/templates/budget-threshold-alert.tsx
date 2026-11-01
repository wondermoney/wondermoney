import { Column, Hr, Row, Section, Text } from "react-email";

import { LifecycleEmailLayout } from "../../emails/components/LifecycleEmail";
import { resolveBrandName } from "../components/Brand";
import { buildCampaignUrl } from "../../emails/lib/urls";
import type { BudgetThresholdAlertProps, BudgetThresholdItem, TransactionalEmailLanguage } from "../types";

export type { BudgetThresholdAlertProps, BudgetThresholdItem } from "../types";

const COPY = {
  en: {
    subject: {
      empty: "An update on your budgets",
      over: "Some categories are over plan",
      atLimit: "Some categories hit their set amount",
      near: "Some categories are close to their set amount",
    },
    preheader: {
      empty: "Review the amounts and transactions included in your budgets.",
      over: "Some categories are over the amount planned for this month.",
      atLimit: "Some categories reached the amount set for this month.",
      near: "Some categories are close to the amount set for this month.",
    },
    status: {
      near: { suffix: "close to set", secondaryLabel: "Still available", ariaState: "close to the set amount" },
      at_limit: { suffix: "set amount reached", secondaryLabel: "Available", ariaState: "set amount reached" },
      over: { suffix: "over plan", secondaryLabel: "Over plan", ariaState: "over the planned amount" },
    },
    usedOverPlanned: "Used / planned",
    ariaOf: "of",
    ariaCategoriesIncluded: (count: number) => `${count} categories included`,
    heading: "Categories to review in your budgets",
    intro: (periodLabel: string) => `This is the aggregated summary for ${periodLabel}. It shows the categories that reached 80% or 100% of their set amount.`,
    ctaLabel: "View budgets",
    marketingFooterText: (brand: string) => `You're receiving this summary because you turned on budget alerts in ${brand}.`,
    bodyParagraphs: [
      "The amounts are based on the transactions currently available. Review the transactions included in each category to confirm the summary matches what you expected.",
      "Categories from different budgets may appear together in this email to avoid several notifications on the same day.",
    ],
  },
  pt: {
    subject: {
      empty: "Atualização dos teus orçamentos",
      over: "Há categorias acima do valor planeado",
      atLimit: "Há categorias que atingiram o valor definido",
      near: "Há categorias perto do valor definido",
    },
    preheader: {
      empty: "Revê os valores e movimentos incluídos nos teus orçamentos.",
      over: "Algumas categorias estão acima do valor planeado para este mês.",
      atLimit: "Algumas categorias atingiram o valor definido para este mês.",
      near: "Algumas categorias estão perto do valor definido para este mês.",
    },
    status: {
      near: { suffix: "perto do definido", secondaryLabel: "Ainda disponível", ariaState: "perto do valor definido" },
      at_limit: { suffix: "valor definido atingido", secondaryLabel: "Disponível", ariaState: "valor definido atingido" },
      over: { suffix: "acima do planeado", secondaryLabel: "Acima do planeado", ariaState: "acima do valor planeado" },
    },
    usedOverPlanned: "Utilizado / definido",
    ariaOf: "de",
    ariaCategoriesIncluded: (count: number) => `${count} categorias incluídas`,
    heading: "Categorias a rever nos teus orçamentos",
    intro: (periodLabel: string) => `Este é o resumo agregado de ${periodLabel}. Mostra as categorias que chegaram a 80% ou 100% do valor definido.`,
    ctaLabel: "Ver orçamentos",
    marketingFooterText: (brand: string) => `Recebeste este resumo porque ativaste os alertas de orçamento na ${brand}.`,
    bodyParagraphs: [
      "Os valores baseiam-se nas transações atualmente disponíveis. Revê os movimentos incluídos em cada categoria para confirmares se o resumo corresponde ao que esperavas.",
      "Categorias de diferentes orçamentos podem aparecer juntas neste email para evitar várias notificações no mesmo dia.",
    ],
  },
} as const satisfies Record<TransactionalEmailLanguage, unknown>;

export function getBudgetThresholdSubject(
  items: readonly Pick<BudgetThresholdItem, "state">[],
  language: TransactionalEmailLanguage = "pt",
) {
  const t = COPY[language].subject;
  if (items.length === 0) return t.empty;
  if (items.some((item) => item.state === "over")) return t.over;
  if (items.some((item) => item.state === "at_limit")) return t.atLimit;
  return t.near;
}

export function getBudgetThresholdPreheader(
  items: readonly Pick<BudgetThresholdItem, "state">[],
  language: TransactionalEmailLanguage = "pt",
) {
  const t = COPY[language].preheader;
  if (items.length === 0) return t.empty;
  if (items.some((item) => item.state === "over")) return t.over;
  if (items.some((item) => item.state === "at_limit")) return t.atLimit;
  return t.near;
}

export const subject = getBudgetThresholdSubject([{ state: "over" }]);
export const preheader = getBudgetThresholdPreheader([{ state: "over" }]);

function getItemStatusCopy(item: BudgetThresholdItem, language: TransactionalEmailLanguage) {
  const status = COPY[language].status[item.state];
  return {
    status: `${item.formattedPercentageUsed} · ${status.suffix}`,
    secondaryLabel: status.secondaryLabel,
    ariaState: status.ariaState,
  };
}

function BudgetItemRow({ item, language }: { item: BudgetThresholdItem; language: TransactionalEmailLanguage }) {
  const t = COPY[language];
  const statusCopy = getItemStatusCopy(item, language);

  return (
    <Section
      aria-label={`${item.budgetName}, ${item.categoryName}: ${item.formattedPercentageUsed}, ${statusCopy.ariaState}. ${item.formattedSpent} ${t.ariaOf} ${item.formattedBudgeted}. ${statusCopy.secondaryLabel}: ${item.formattedRemainingOrOver}`}
    >
      <Row>
        <Column style={{ verticalAlign: "top" }}>
          <Text className="m-0 font-sans text-[14px] font-medium leading-[21px] text-[#111111]">
            {item.categoryName}
          </Text>
          <Text className="m-0 mt-[1px] font-sans text-[11px] leading-[17px] text-[#6b7280]">
            {item.budgetName}
          </Text>
        </Column>
        <Column align="right" style={{ verticalAlign: "top", width: "142px" }}>
          <Text
            className="m-0 font-sans text-[11px] font-medium leading-[17px]"
            style={{ color: item.state === "over" ? "#b42318" : "#6d28d9" }}
          >
            {statusCopy.status}
          </Text>
        </Column>
      </Row>
      <Row className="mt-[9px]">
        <Column>
          <Text className="m-0 font-sans text-[10px] leading-[15px] text-[#6b7280]">
            {t.usedOverPlanned}
          </Text>
          <Text className="m-0 mt-[1px] font-mono text-[13px] font-semibold leading-[19px] text-[#111111]">
            {item.formattedSpent} / {item.formattedBudgeted}
          </Text>
        </Column>
        <Column align="right">
          <Text className="m-0 font-sans text-[10px] leading-[15px] text-[#6b7280]">
            {statusCopy.secondaryLabel}
          </Text>
          <Text className="m-0 mt-[1px] font-mono text-[13px] font-semibold leading-[19px] text-[#111111]">
            {item.formattedRemainingOrOver}
          </Text>
        </Column>
      </Row>
    </Section>
  );
}

export default function BudgetThresholdAlert({
  language = "pt",
  firstName,
  periodLabel,
  items,
  ctaUrl,
  settingsUrl,
  privacyUrl,
  unsubscribeUrl,
  utmSource = "mailjet",
  utmMedium = "email",
  utmCampaign = "budget_threshold_alert",
  utmContent = "daily_aggregated_thresholds",
  brandName,
}: BudgetThresholdAlertProps) {
  if (items.length === 0) {
    throw new Error("BudgetThresholdAlert requires at least one threshold item");
  }
  const t = COPY[language];
  const brand = resolveBrandName(brandName);

  const stateStrength: Record<BudgetThresholdItem["state"], number> = {
    over: 3,
    at_limit: 2,
    near: 1,
  };
  const orderedItems = [...items]
    .map((item, index) => ({ item, index }))
    .sort((left, right) =>
      stateStrength[right.item.state] === stateStrength[left.item.state]
        ? left.index - right.index
        : stateStrength[right.item.state] - stateStrength[left.item.state],
    )
    .map(({ item }) => item);
  const adaptivePreheader = getBudgetThresholdPreheader(items, language);
  const trackedCtaUrl = buildCampaignUrl({
    destinationUrl: ctaUrl,
    nextPath: `/${language}/budgets`,
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
  });

  return (
    <LifecycleEmailLayout
      language={language}
      preview={adaptivePreheader}
      firstName={firstName}
      heading={t.heading}
      intro={t.intro(periodLabel)}
      visual={
        <Section aria-label={t.ariaCategoriesIncluded(items.length)}>
          {orderedItems.map((item, index) => (
            <Section key={`${index}-${item.budgetName}-${item.categoryName}-${item.threshold}`}>
              {index > 0 ? <Hr className="my-[15px] border-[#e5e7eb]" /> : null}
              <BudgetItemRow item={item} language={language} />
            </Section>
          ))}
        </Section>
      }
      ctaLabel={t.ctaLabel}
      ctaUrl={trackedCtaUrl}
      marketingFooterText={t.marketingFooterText(brand)}
      brandName={brand}
      settingsUrl={settingsUrl}
      privacyUrl={privacyUrl}
      unsubscribeUrl={unsubscribeUrl}
    >
      <p className="m-0">{t.bodyParagraphs[0]}</p>
      <p className="m-0 mt-[10px]">{t.bodyParagraphs[1]}</p>
    </LifecycleEmailLayout>
  );
}
