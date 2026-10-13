import * as Sentry from '@sentry/node';
import type { NextFunction, Request, Response } from 'express';

import { DI } from '@app/app';
import { Appuser } from '@entity/Appuser';
import { BadRequestError } from '@utils/errors';
import logger from '@utils/logger';

async function getUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (!req.authUser?.user.id) {
    logger.error('Auth user not found');
    throw new BadRequestError('Auth user not found');
  }
  const appUser = await DI.em.findOne(Appuser, {
    deletedAt: undefined,
    externalUserId: req.authUser.user.id,
    recordActive: true,
  });
  if (!appUser) {
    logger.error('User not found');
    throw new BadRequestError('User not found');
  }
  req.user = appUser;
  Sentry.setUser({
    email: req.user.emailAddress,
    id: req.user.appuserKey.toString(),
  });
  next();
}

async function getUserOptional(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (!req.authUser?.user.id) {
    next();
    return;
  }
  const appUser = await DI.em.findOne(Appuser, {
    deletedAt: undefined,
    externalUserId: req.authUser.user.id,
    recordActive: true,
  });
  if (appUser) {
    req.user = appUser;
  }
  next();
}

export { getUser, getUserOptional };
