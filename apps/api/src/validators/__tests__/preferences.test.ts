import { describe, expect, it } from 'vitest';

import { patchUserPreferencesSchema, userPreferencesSchema } from '../preferences';

describe('userPreferencesSchema', () => {
  it('defaults preview features off for an empty document', () => {
    expect(userPreferencesSchema.parse({})).toEqual({ previewFeatures: false });
  });

  it('keeps a stored boolean', () => {
    expect(userPreferencesSchema.parse({ previewFeatures: true })).toEqual({ previewFeatures: true });
  });

  it('drops keys this release does not know', () => {
    expect(userPreferencesSchema.parse({ futureToggle: 'on', previewFeatures: true })).toEqual({ previewFeatures: true });
  });

  it('rejects a wrong type rather than coercing it', () => {
    expect(userPreferencesSchema.safeParse({ previewFeatures: 'yes' }).success).toBe(false);
    expect(userPreferencesSchema.safeParse({ previewFeatures: 1 }).success).toBe(false);
    expect(userPreferencesSchema.safeParse({ previewFeatures: null }).success).toBe(false);
  });
});

describe('patchUserPreferencesSchema', () => {
  const parseBody = (body: Record<string, unknown>) => patchUserPreferencesSchema.safeParse({ body });

  it.each([true, false])('accepts previewFeatures: %s', (previewFeatures) => {
    const result = parseBody({ previewFeatures });

    expect(result.success).toBe(true);
    expect(result.data?.body).toEqual({ previewFeatures });
  });

  it('drops unknown keys from a patch instead of storing them', () => {
    const result = parseBody({ futureToggle: 'on', previewFeatures: true });

    expect(result.success).toBe(true);
    expect(result.data?.body).toEqual({ previewFeatures: true });
  });

  it('rejects a patch with no known preference', () => {
    expect(parseBody({}).success).toBe(false);
    expect(parseBody({ futureToggle: true }).success).toBe(false);
  });

  it('rejects a wrong type', () => {
    expect(parseBody({ previewFeatures: 'yes' }).success).toBe(false);
    expect(parseBody({ previewFeatures: 1 }).success).toBe(false);
  });
});
