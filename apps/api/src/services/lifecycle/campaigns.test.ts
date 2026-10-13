import '@service/lifecycle/campaigns';

import { getLifecycleCopy } from '@wondermoney/react-email';
import { describe, expect, it } from 'vitest';

import { allCampaigns, getCampaign } from '@service/lifecycle/lifecycle-registry';
import { LifecycleCampaign } from '@service/lifecycle/lifecycle-types';

describe('lifecycle campaign registry', () => {
  it('registers the data-health campaign', () => {
    expect(getCampaign(LifecycleCampaign.DATA_HEALTH)).toBeDefined();
  });

  // Copy itself lives only in @wondermoney/react-email — this just guards
  // against drift between what the registry declares (campaign/step) and
  // what that package actually has copy for, in either direction.
  it('every declared step has EN + PT copy in @wondermoney/react-email', () => {
    for (const def of allCampaigns()) {
      expect(def.steps.length).toBeGreaterThan(0);
      expect(def.templateVersion.length).toBeGreaterThan(0);
      for (const step of def.steps) {
        for (const language of ['en', 'pt'] as const) {
          const c = getLifecycleCopy(def.campaign, step, language);
          expect(c.subject.length, `${def.campaign}/${step}/${language} subject`).toBeGreaterThan(0);
          expect(c.heading.length, `${def.campaign}/${step}/${language} heading`).toBeGreaterThan(0);
          expect(c.body.length, `${def.campaign}/${step}/${language} body`).toBeGreaterThan(0);
          expect(c.ctaLabel.length, `${def.campaign}/${step}/${language} cta`).toBeGreaterThan(0);
        }
      }
    }
  });
});
