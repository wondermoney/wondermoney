import { expect, it } from 'vitest';

import {
  ANALYTICS_EVENTS,
  LEGACY_MOBILE_EVENT_NAMES,
  LEGACY_WEB_EVENT_NAMES,
  renderAnalyticsEventsMarkdown,
} from '../../lib/analytics';

// Regenerate with `pnpm --filter @wondermoney/shared analytics-events`.
it('docs/analytics-events.md lists the catalogue as it is', async () => {
  await expect(
    renderAnalyticsEventsMarkdown(ANALYTICS_EVENTS, {
      mobile: LEGACY_MOBILE_EVENT_NAMES,
      web: LEGACY_WEB_EVENT_NAMES,
    }),
  ).toMatchFileSnapshot('../../../../docs/analytics-events.md');
});
