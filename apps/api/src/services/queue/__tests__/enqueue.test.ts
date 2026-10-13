import '@app/jobs/queue';
import '@app/jobs/portfolio-csv-import-confirmed.queue';
import '@app/jobs/portfolio-csv-parse-preview.queue';

import { describe, expect, it, vi } from 'vitest';

import { createRequestEnqueueAdapter, createWorkerEnqueueAdapter, type Enqueue } from '@service/queue/enqueue';
import { getRegisteredQueueNames } from '@service/queue/queues';

describe('enqueue seam factories', () => {
  it('builds a worker adapter that owns no lifecycle', () => {
    const boss = { send: vi.fn(), sendAfter: vi.fn() };
    const enqueue: Enqueue = createWorkerEnqueueAdapter(boss);

    expect(typeof enqueue.send).toBe('function');
    expect(typeof enqueue.sendAfter).toBe('function');
    // Wrapping an already-started boss must not itself start, stop or send anything.
    expect(boss.send).not.toHaveBeenCalled();
    expect(boss.sendAfter).not.toHaveBeenCalled();
  });

  it('builds a request adapter that defers boss creation until a job is sent', () => {
    const createRuntime = vi.fn();
    const enqueue: Enqueue = createRequestEnqueueAdapter({ createRuntime });

    expect(typeof enqueue.send).toBe('function');
    expect(typeof enqueue.sendAfter).toBe('function');
    expect(createRuntime).not.toHaveBeenCalled();
  });

  it('registers every PR1 queue name', () => {
    expect(getRegisteredQueueNames()).toEqual([
      'foundation.health-check',
      'portfolio.csv-import-confirmed',
      'portfolio.csv-parse-preview',
    ]);
  });
});
