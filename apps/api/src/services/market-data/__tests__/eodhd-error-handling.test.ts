import { EodhdError } from '@wondermoney/shared';
import { describe, expect, it } from 'vitest';

import { BadGatewayError, BadRequestError, GatewayTimeoutError, InternalServerError, NotFoundError, TooManyRequestsError } from '@utils/errors';

import { handleEodhdError } from '../eodhd.service';

function caught(input: unknown): { message: string; name: string; retryAfter?: number; status?: number } {
  try {
    handleEodhdError(input);
  } catch (error) {
    return error as { message: string; name: string; retryAfter?: number; status?: number };
  }
}

describe('handleEodhdError (RAD-449)', () => {
  it('maps a 404-status EodhdError to NotFoundError, regardless of code', () => {
    const thrown = caught(new EodhdError('not found', 'client_error', 404));
    expect(thrown).toBeInstanceOf(NotFoundError);
    expect(thrown.status).toBe(404);
  });

  it('maps code=rate_limit to TooManyRequestsError with the carried retryAfter', () => {
    const thrown = caught(new EodhdError('slow down', 'rate_limit', 429, undefined, 42));
    expect(thrown).toBeInstanceOf(TooManyRequestsError);
    expect(thrown.status).toBe(429);
    expect(thrown.retryAfter).toBe(42);
  });

  it('falls back to a fixed retryAfter when the provider gave none', () => {
    const thrown = caught(new EodhdError('slow down', 'rate_limit', 429));
    expect(thrown.retryAfter).toBe(60);
  });

  it('maps code=auth_error to InternalServerError (our credential problem, not the caller\'s)', () => {
    const thrown = caught(new EodhdError('bad token', 'auth_error', 401));
    expect(thrown).toBeInstanceOf(InternalServerError);
    expect(thrown.status).toBe(500);
  });

  it('maps code=timeout to GatewayTimeoutError', () => {
    const thrown = caught(new EodhdError('timed out', 'timeout'));
    expect(thrown).toBeInstanceOf(GatewayTimeoutError);
    expect(thrown.status).toBe(504);
  });

  it('maps code=network_error to BadGatewayError', () => {
    const thrown = caught(new EodhdError('unreachable', 'network_error'));
    expect(thrown).toBeInstanceOf(BadGatewayError);
    expect(thrown.status).toBe(502);
  });

  it('maps code=server_error to BadGatewayError', () => {
    const thrown = caught(new EodhdError('upstream boom', 'server_error', 503));
    expect(thrown).toBeInstanceOf(BadGatewayError);
    expect(thrown.status).toBe(502);
  });

  it('maps code=parse_error to BadGatewayError', () => {
    const thrown = caught(new EodhdError('bad body', 'parse_error'));
    expect(thrown).toBeInstanceOf(BadGatewayError);
    expect(thrown.status).toBe(502);
  });

  it('maps code=client_error (non-404) to BadRequestError', () => {
    const thrown = caught(new EodhdError('bad params', 'client_error', 422));
    expect(thrown).toBeInstanceOf(BadRequestError);
    expect(thrown.status).toBe(400);
  });

  it('maps code=unknown to InternalServerError', () => {
    const thrown = caught(new EodhdError('???', 'unknown'));
    expect(thrown).toBeInstanceOf(InternalServerError);
    expect(thrown.status).toBe(500);
  });

  it('rethrows an unrelated Error unchanged', () => {
    const bug = new TypeError("Cannot read properties of undefined (reading 'x')");
    const thrown = caught(bug);
    expect(thrown).toBe(bug);
  });

  it('wraps a non-Error throwable in InternalServerError', () => {
    const thrown = caught('a bare string');
    expect(thrown).toBeInstanceOf(InternalServerError);
    expect(thrown.status).toBe(500);
  });
});
