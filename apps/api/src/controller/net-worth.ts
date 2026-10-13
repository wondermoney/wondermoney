import type { Request, Response } from 'express';

import netWorthService from '@service/net-worth/net-worth.service';
import { netWorthHistoryQuerySchema } from '@validators/net-worth';
import { zParse } from '@validators/parser';

export async function getNetWorth(req: Request, res: Response) {
  if (!req.user) {
    throw new Error('User not found');
  }
  const summary = await netWorthService.getNetWorth(req.user);
  return res.json(summary);
}

export async function getNetWorthHistory(req: Request, res: Response) {
  if (!req.user) throw new Error('User not found');
  const { query: { granularity, months, toDate } } = await zParse(netWorthHistoryQuerySchema, req);
  const summary = await netWorthService.getNetWorthHistory(req.user, { granularity, months, toDate: toDate ? new Date(`${toDate}T00:00:00.000Z`) : undefined });
  return res.json(summary);
}
