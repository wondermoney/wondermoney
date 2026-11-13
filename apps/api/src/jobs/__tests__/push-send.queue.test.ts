import { describe, expect, it } from 'vitest';

import type { Enqueue } from '@service/queue/enqueue';

import { enqueuePushReceiptCheck, enqueuePushSend, ensurePushSendQueue } from '../push-send.queue';

/** pg-boss's own check (attorney.assertObjectName): anything else crashes the worker at start-up. */
const PG_BOSS_NAME = /^[\w./-]+$/u;

/*
 * The mocked boss in the other tests accepts any name, so a queue or key pg-boss refuses would
 * only show when the real worker starts. Every name the push queue hands pg-boss is checked here.
 */
describe('push-send queue names', () => {
  it('gives pg-boss only names it accepts', async () => {
    const names: string[] = [];
    const record = (name: string, options?: Record<string, unknown>) => {
      names.push(name);
      for (const key of ['deadLetter', 'singletonKey', 'key']) if (typeof options?.[key] === 'string') names.push(options[key]);
    };
    await ensurePushSendQueue({ createQueue: (name: string, options?: Record<string, unknown>) => { record(name, options); return Promise.resolve(); } });
    const enqueue = {
      send: (queue: string, _payload: unknown, options?: Record<string, unknown>) => { record(queue, options); return Promise.resolve('job'); },
      sendAfter: (queue: string, _payload: unknown, options?: Record<string, unknown>) => { record(queue, options); return Promise.resolve('job'); },
    } as unknown as Enqueue;
    await enqueuePushSend({ appuserKey: 1, notification: { kind: 'test' }, type: 'send' }, { enqueue });
    await enqueuePushReceiptCheck([{ id: 'receipt-1', pushDeviceKey: 1 }], new Date(), { enqueue });

    expect(names.length).toBeGreaterThanOrEqual(4);
    for (const name of names) expect(name).toMatch(PG_BOSS_NAME);
  });
});
