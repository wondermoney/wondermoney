import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { mockRes } from '../../__tests__/__helpers__/mock-request';
import { requirePreviewFeatures } from '../preview-features';

function requestWith(preferences: Record<string, unknown> | undefined): Request {
  return { user: { appuserKey: 1, preferences } } as unknown as Request;
}

function thrownBy(req: Request): unknown {
  try {
    requirePreviewFeatures(req, mockRes(), vi.fn());
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('requirePreviewFeatures', () => {
  it('lets a user with the flag through', () => {
    const next = vi.fn();

    requirePreviewFeatures(requestWith({ previewFeatures: true }), mockRes(), next);

    expect(next).toHaveBeenCalledWith();
  });

  it('hides the route from a user without the flag', () => {
    expect(thrownBy(requestWith({ previewFeatures: false }))).toMatchObject({ status: 404 });
    expect(thrownBy(requestWith({}))).toMatchObject({ status: 404 });
    expect(thrownBy(requestWith(undefined))).toMatchObject({ status: 404 });
  });

  it('fails closed on a malformed stored document', () => {
    expect(thrownBy(requestWith({ previewFeatures: 'yes' }))).toMatchObject({ status: 404 });
  });

  it('does not run the route handler when the flag is off', () => {
    const next = vi.fn();

    expect(() => {
      requirePreviewFeatures(requestWith({ previewFeatures: false }), mockRes(), next);
    }).toThrow();    expect(next).not.toHaveBeenCalled();
  });

  it('is an authentication error, not a 404, when no user is attached', () => {
    expect(thrownBy({} as Request)).toMatchObject({ status: 401 });
  });
});
