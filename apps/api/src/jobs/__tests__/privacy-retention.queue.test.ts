import { describe, expect, it } from 'vitest';

import { PG_BOSS_NAME } from '@app/__tests__/__helpers__/pgboss-names';

import { ensurePrivacyRetentionQueue, schedulePrivacyRetentionJob } from '../privacy-retention.queue';

/*
 * The mocked boss in the other tests accepts any name, so a queue or schedule key pg-boss refuses
 * would only show when the real worker starts. Every name the retention queue hands pg-boss is
 * checked here.
 */
describe('privacy retention queue names', () => {
  it('gives pg-boss only names it accepts', async () => {
    const names: string[] = [];
    const record = (name: string, options?: Record<string, unknown>) => {
      names.push(name);
      for (const key of ['deadLetter', 'singletonKey', 'key']) if (typeof options?.[key] === 'string') names.push(options[key]);
    };
    await ensurePrivacyRetentionQueue({ createQueue: (name, options) => { record(name, options); return Promise.resolve(); } });
    await schedulePrivacyRetentionJob({ schedule: (name, _cron, _data, options) => { record(name, options); return Promise.resolve(); } });

    expect(names.length).toBeGreaterThanOrEqual(3);
    for (const name of names) expect(name).toMatch(PG_BOSS_NAME);
  });
});
