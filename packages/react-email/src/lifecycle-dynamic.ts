import { createElement, type ReactElement } from "react";

import { StatusPanel } from "./components/LifecycleVisuals.js";
import type { LifecycleLanguage } from "./lifecycle-copy.js";

/**
 * Real per-user values for lifecycle visuals that can't be static copy. All values are
 * pre-formatted display strings; this package stays presentation-only and never formats
 * dates itself.
 */
export interface LifecycleDynamicData {
  /** Display name of the bank connection nearing expiry (data_health.consent_expiring). */
  bankName?: string;
  /** Formatted expiry date of the bank connection's authorization. */
  expiryDate?: string;
}

const DYNAMIC_VISUAL_COPY = {
  en: {
    connectionLabelFallback: "Bank connection",
    connectionLabelWithBank: (bankName: string) => `Connection to ${bankName}`,
    renewalNeededStatus: "Renewal needed",
    renewalNeededDetail: "Read-only access. Renewing lets you keep updating balances and transactions.",
    expiryMetadata: (expiryDate: string) => `Until ${expiryDate}`,
  },
  pt: {
    connectionLabelFallback: "Ligação bancária",
    connectionLabelWithBank: (bankName: string) => `Ligação a ${bankName}`,
    renewalNeededStatus: "Renovação necessária",
    renewalNeededDetail: "Acesso apenas de leitura. A renovação permite continuar a atualizar saldos e transações.",
    expiryMetadata: (expiryDate: string) => `Até ${expiryDate}`,
  },
} as const satisfies Record<LifecycleLanguage, Record<string, unknown>>;

/**
 * Builds the rich visual for campaigns whose content depends on real per-user
 * data. Returns undefined when the campaign+step has no dynamic visual (the
 * caller should fall back to the static steps/status/metrics visual, if any).
 */
export function buildDynamicVisual(
  campaign: string,
  step: string,
  language: LifecycleLanguage,
  data: LifecycleDynamicData | undefined,
): ReactElement | undefined {
  if (!data) return undefined;
  const t = DYNAMIC_VISUAL_COPY[language];
  const key = `${campaign}.${step}`;

  switch (key) {
    case "data_health.consent_expiring": {
      return createElement(StatusPanel, {
        label: data.bankName ? t.connectionLabelWithBank(data.bankName) : t.connectionLabelFallback,
        status: t.renewalNeededStatus,
        detail: t.renewalNeededDetail,
        metadata: data.expiryDate ? t.expiryMetadata(data.expiryDate) : undefined,
      });
    }

    default:
      return undefined;
  }
}
