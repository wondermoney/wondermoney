import type { EntityManager } from '@mikro-orm/core';
import type { LifecycleDynamicData } from '@wondermoney/react-email';

import type { Appuser } from '@entity/Appuser';
import type { LifecycleCampaign } from '@service/lifecycle/lifecycle-types';

/**
 * A lifecycle campaign: its steps, and how to decide (at send time) whether a
 * given step should still go to a user. The generic send worker looks the
 * campaign up in the registry and drives it — so adding a track is just
 * adding a definition, no new queue/worker. Copy (subject/heading/body/CTA)
 * is NOT part of this definition — it lives exclusively in
 * `@wondermoney/react-email` (`getLifecycleCopy`/`renderLifecycleEmail`),
 * keyed by `campaign`/step, so there is only ever one source of truth for
 * what gets sent.
 */
export interface CampaignDefinition {
  campaign: LifecycleCampaign;
  /**
   * Optional real per-user figures for steps whose visual needs live data
   * (net worth, spend, dates, prices) rather than static copy. Returns
   * undefined when the step has no dynamic visual, or the data isn't
   * available for this user — the render then falls back to static copy.
   */
  buildData?(em: EntityManager, appuser: Appuser, step: string, language: 'EN' | 'PT'): Promise<LifecycleDynamicData | undefined>;
  /** Send-time eligibility — re-evaluated when the delivery is about to go out. */
  isEligible(em: EntityManager, appuserKey: number, step: string): Promise<boolean>;
  /** Optional human reply-to inbox (e.g. feedback asks). */
  replyTo?: string;
  steps: readonly string[];
  templateVersion: string;
}

const REGISTRY = new Map<LifecycleCampaign, CampaignDefinition>();

export function allCampaigns(): CampaignDefinition[] {
  return [...REGISTRY.values()];
}

export function getCampaign(campaign: LifecycleCampaign): CampaignDefinition | undefined {
  return REGISTRY.get(campaign);
}

export function registerCampaign(def: CampaignDefinition): void {
  REGISTRY.set(def.campaign, def);
}
