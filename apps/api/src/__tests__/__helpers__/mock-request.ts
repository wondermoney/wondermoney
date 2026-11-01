/**
 * Typed Express request/response doubles for controller tests.
 *
 * Replaces the `req as never` / `{ json } as never` pattern with a factory that
 * returns objects the controller types actually accept. Defaults match the
 * `Request`/`Response` shapes the controllers consume (json + status + sendStatus).
 */
import type { NextFunction, Request, Response } from 'express';

export interface MockRequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  params?: Record<string, string>;
  query?: Record<string, unknown>;
}

export interface MockResponseOptions {
  json?: ReturnType<typeof vi.fn>;
  sendStatus?: ReturnType<typeof vi.fn>;
  status?: ReturnType<typeof vi.fn>;
}

import { vi } from 'vitest';

export function mockNext(): NextFunction {
  return vi.fn();
}

export function mockReq(opts: MockRequestOptions = {}): Request {
  return {
    body: opts.body ?? {},
    headers: opts.headers ?? {},
    params: opts.params ?? {},
    query: opts.query ?? {},
  } as unknown as Request;
}

export function mockRes(opts: MockResponseOptions = {}): Response {
  const status = opts.status ?? vi.fn().mockReturnThis();
  const json = opts.json ?? vi.fn().mockReturnThis();
  const sendStatus = opts.sendStatus ?? vi.fn().mockReturnThis();
  return { json, sendStatus, status } as unknown as Response;
}
