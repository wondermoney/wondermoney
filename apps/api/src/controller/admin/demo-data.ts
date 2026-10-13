import type { Request, Response } from 'express';
import { z } from 'zod';

import { enqueueDemoDataRefreshJob } from '@app/jobs/demo-data-refresh.queue';
import { zParse } from '@validators/parser';

const triggerDemoDataRefreshSchema = z.object({
  body: z.object({
    asOfDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'asOfDate must be YYYY-MM-DD')
      .optional(),
    dryRun: z.boolean().optional(),
  }),
});

export async function triggerDemoDataRefresh(req: Request, res: Response) {
  const {
    body: { asOfDate, dryRun },
  } = await zParse(triggerDemoDataRefreshSchema, req);

  const jobId = await enqueueDemoDataRefreshJob({ asOfDate, dryRun }, { enqueue: req.enqueue });
  return res.status(202).json({ jobId: jobId ?? null, queue: 'demo-data.refresh' });
}
