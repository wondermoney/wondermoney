import { render } from "@react-email/render";
import { createElement, type ReactElement } from "react";

import AccountConnectedEmail, {
  getAccountConnectedPreheader,
  getAccountConnectedSubject,
} from "./templates/account-connected.js";
import BudgetThresholdAlert, {
  getBudgetThresholdPreheader,
  getBudgetThresholdSubject,
} from "./templates/budget-threshold-alert.js";
import InternalAlertEmail, {
  getInternalAlertPreheader,
} from "./templates/internal-alert.js";
import LifecycleNudgeEmail, {
  getLifecycleNudgePreheader,
} from "./templates/lifecycle-nudge.js";
import LifecycleCampaignEmail from "./templates/lifecycle-campaign.js";
import { MetricsPanel, StatusPanel, StepFlow } from "./components/LifecycleVisuals.js";
import { getLifecycleCopy, type LifecycleLanguage } from "./lifecycle-copy.js";
import { buildDynamicVisual, type LifecycleDynamicData } from "./lifecycle-dynamic.js";
import WeeklyInsights, {
  getWeeklyInsightsSubject,
} from "./templates/weekly-insights.js";
import MonthlyStory, {
  getMonthlyStoryPreheader,
  getMonthlyStorySubject,
} from "./templates/monthly-story.js";
import type {
  AccountConnectedEmailProps,
  BudgetThresholdAlertProps,
  InternalAlertEmailProps,
  LifecycleNudgeEmailProps,
  MonthlyStoryProps,
  WeeklyInsightsProps,
} from "./types.js";
import { getWeeklyInsightsPreheader } from "./weekly-insights-preheader.js";

export type { AccountConnectedEmailProps, BudgetThresholdAlertProps, BudgetThresholdItem, InternalAlertDetail, InternalAlertEmailProps, LifecycleNudgeEmailProps, MonthlyStoryCategoryDelta, MonthlyStoryDataSufficientProps, MonthlyStoryInsufficientDataProps, MonthlyStoryMetric, MonthlyStoryProps, MonthlyStoryRecurringChange, TransactionalEmailLanguage, WeeklyBudgetSummary, WeeklyInsightsProps } from "./types.js";
export { getWeeklyInsightsPreheader } from "./weekly-insights-preheader.js";
export { LIFECYCLE_COPY, getLifecycleCopy } from "./lifecycle-copy.js";
export type { LifecycleLanguage, LifecycleStepCopy } from "./lifecycle-copy.js";
export type { LifecycleDynamicData } from "./lifecycle-dynamic.js";

export interface RenderedEmail {
  subject: string;
  preheader: string;
  html: string;
  text: string;
}

const externalUrlFields = [
  "ctaUrl",
  "settingsUrl",
  "privacyUrl",
  "unsubscribeUrl",
] as const;

type ExternalUrls = Pick<BudgetThresholdAlertProps, (typeof externalUrlFields)[number]>;

/**
 * Links must be absolute web URLs. `http:` is allowed alongside `https:` so a self-hosted
 * instance on a LAN address can send working links; any other scheme (`javascript:`, `data:`,
 * relative paths) is rejected.
 */
function assertWebUrl(field: string, value: string): void {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${field} must be an absolute http(s) URL`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError(`${field} must be an absolute http(s) URL`);
  }
}

function validateExternalUrls(props: ExternalUrls): void {
  for (const field of externalUrlFields) {
    assertWebUrl(field, props[field]);
  }
}

async function renderElement(element: ReactElement): Promise<Pick<RenderedEmail, "html" | "text">> {
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);

  return { html, text };
}

export async function renderBudgetThresholdAlert(
  props: BudgetThresholdAlertProps,
): Promise<RenderedEmail> {
  validateExternalUrls(props);
  if (props.items.length === 0) {
    throw new TypeError("items must contain at least one budget threshold item");
  }

  const subject = getBudgetThresholdSubject(props.items, props.language);
  const preheader = getBudgetThresholdPreheader(props.items, props.language);
  const output = await renderElement(createElement(BudgetThresholdAlert, props));

  return { subject, preheader, ...output };
}

export async function renderWeeklyInsights(
  props: WeeklyInsightsProps,
): Promise<RenderedEmail> {
  validateExternalUrls(props);
  const preheader = getWeeklyInsightsPreheader(props.budgetSummary, props.language);
  const output = await renderElement(createElement(WeeklyInsights, props));

  return {
    subject: getWeeklyInsightsSubject(props.language),
    preheader,
    ...output,
  };
}

export async function renderMonthlyStory(
  props: MonthlyStoryProps,
): Promise<RenderedEmail> {
  assertWebUrl("ctaUrl", props.ctaUrl);
  assertWebUrl("settingsUrl", props.settingsUrl);
  assertWebUrl("privacyUrl", props.privacyUrl);
  assertWebUrl("unsubscribeUrl", props.unsubscribeUrl);
  const output = await renderElement(createElement(MonthlyStory, props));

  return {
    subject: getMonthlyStorySubject(props),
    preheader: getMonthlyStoryPreheader(props),
    ...output,
  };
}

export async function renderAccountConnectedEmail(
  props: AccountConnectedEmailProps,
): Promise<RenderedEmail> {
  assertWebUrl("dashboardUrl", props.dashboardUrl);
  const output = await renderElement(createElement(AccountConnectedEmail, props));

  return {
    subject: getAccountConnectedSubject(props.language, props.bankName),
    preheader: getAccountConnectedPreheader(props.language, props.bankName),
    ...output,
  };
}

export async function renderInternalAlertEmail(
  props: InternalAlertEmailProps,
): Promise<RenderedEmail> {
  const output = await renderElement(createElement(InternalAlertEmail, props));

  return {
    subject: props.subject,
    preheader: getInternalAlertPreheader(props),
    ...output,
  };
}

export async function renderLifecycleNudgeEmail(
  props: LifecycleNudgeEmailProps,
): Promise<RenderedEmail> {
  assertWebUrl("unsubscribeUrl", props.unsubscribeUrl);
  if (props.ctaUrl !== undefined) assertWebUrl("ctaUrl", props.ctaUrl);
  if (props.settingsUrl !== undefined) assertWebUrl("settingsUrl", props.settingsUrl);
  if (props.body.length === 0) throw new TypeError("body must contain at least one paragraph");
  const output = await renderElement(createElement(LifecycleNudgeEmail, props));

  return {
    subject: props.subject,
    preheader: getLifecycleNudgePreheader(props),
    ...output,
  };
}

export async function renderLifecycleEmail(props: {
  campaign: string;
  step: string;
  language: LifecycleLanguage;
  firstName?: string;
  ctaUrl: string;
  unsubscribeUrl: string;
  settingsUrl?: string;
  /** Real per-user figures for campaigns whose visual needs live data (net worth, spend, dates, prices). */
  data?: LifecycleDynamicData;
}): Promise<RenderedEmail> {
  assertWebUrl("ctaUrl", props.ctaUrl);
  assertWebUrl("unsubscribeUrl", props.unsubscribeUrl);
  if (props.settingsUrl !== undefined) {
    assertWebUrl("settingsUrl", props.settingsUrl);
  }

  const copy = getLifecycleCopy(props.campaign, props.step, props.language);

  const visual =
    buildDynamicVisual(props.campaign, props.step, props.language, props.data) ??
    (copy.steps
      ? createElement(StepFlow, { steps: copy.steps })
      : copy.status
        ? createElement(StatusPanel, copy.status)
        : copy.metrics
          ? createElement(MetricsPanel, copy.metrics)
          : undefined);

  const output = await renderElement(
    createElement(LifecycleCampaignEmail, {
      language: props.language,
      firstName: props.firstName,
      heading: copy.heading,
      body: copy.body,
      visual,
      ctaLabel: copy.ctaLabel,
      ctaUrl: props.ctaUrl,
      unsubscribeUrl: props.unsubscribeUrl,
      settingsUrl: props.settingsUrl,
      preheader: copy.preheader,
    }),
  );

  return {
    subject: copy.subject,
    preheader: copy.preheader,
    ...output,
  };
}
