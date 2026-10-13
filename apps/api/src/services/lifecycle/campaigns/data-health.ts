
import type { CampaignDefinition } from '@service/lifecycle/lifecycle-registry';
import { LifecycleCampaign } from '@service/lifecycle/lifecycle-types';
import { buildConsentExpiringData } from '@service/lifecycle/lifecycle-visual-data.service';

export const DataHealthSteps = { CONSENT_EXPIRING: 'consent_expiring', RECONNECT_FINAL: 'reconnect_final', RECONNECT_REMINDER: 'reconnect_reminder' } as const;

export const dataHealthCampaign: CampaignDefinition = {
  buildData: async (em, appuser, step, language) => {
    if (step === DataHealthSteps.CONSENT_EXPIRING) return buildConsentExpiringData(em, appuser, language);
    return undefined;
  },
  campaign: LifecycleCampaign.DATA_HEALTH,
  isEligible: async () => true,
  steps: Object.values(DataHealthSteps),
  templateVersion: 'data-health.v1',
};
