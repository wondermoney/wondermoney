import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { BadRequestError, FeatureDisabledError, InternalServerError, NotFoundError, UnauthorizedError } from '@utils/errors';

const sentry = vi.hoisted(() => ({ captureException: vi.fn() }));
const log = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }));

vi.mock('@sentry/node', () => ({ captureException: sentry.captureException }));
vi.mock('@utils/logger', () => ({ default: log }));

const { errorHandler } = await import('../error-handler');

function appThrowing(err: unknown) {
  const app = express();
  app.get('/boom', () => {
    throw err;
  });
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  sentry.captureException.mockClear();
  log.error.mockClear();
  log.warn.mockClear();
});

describe('errorHandler', () => {
  it.each([
    ['a bad request', new BadRequestError('No Enable Banking credential configured'), 400],
    ['an unauthenticated request', new UnauthorizedError(), 401],
    ['a missing resource', new NotFoundError(), 404],
    ['a validation failure', z.object({ id: z.string() }).safeParse({}).error, 422],
    ['a feature this server has not configured', new FeatureDisabledError('Bank sync'), 501],
  ])('answers %s without an error log or a Sentry event', async (_name, err, status) => {
    const res = await request(appThrowing(err)).get('/boom');

    expect(res.status).toBe(status);
    expect(log.error).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a server error', new InternalServerError()],
    ['an unexpected throw', new Error('kaboom')],
  ])('logs %s at error level and reports it to Sentry', async (_name, err) => {
    const res = await request(appThrowing(err)).get('/boom');

    expect(res.status).toBe(500);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(sentry.captureException).toHaveBeenCalledWith(err, expect.anything());
  });
});
