import { describe, expect, it } from 'vitest';

import { AssistantRedactionService } from '../assistant-redaction.service';

describe('AssistantRedactionService', () => {
  it('removes unsafe keys recursively and preserves safe nested data', () => {
    const input = {
      keepTop: 'top',
      metadataRaw: { shouldDisappear: true },
      safe: {
        appuserKey: 2,
        nested: {
          externalUserId: 'abc',
          keep: 'yes',
          list: [{ iban: 'PT500', keep: true }, { accountNumber: '123', safe: 'ok' }],
        },
      },
      tenantKey: 1,
    };

    expect(AssistantRedactionService.redact(input)).toEqual({
      keepTop: 'top',
      safe: {
        nested: {
          keep: 'yes',
          list: [{ keep: true }, { safe: 'ok' }],
        },
      },
    });
  });

  it('preserves dates and handles null values', () => {
    const date = new Date('2026-05-31T00:00:00Z');

    expect(AssistantRedactionService.redact({ date, value: null })).toEqual({ date, value: null });
  });

  it('handles circular plain objects without overflowing', () => {
    const input: Record<string, unknown> = { keep: true };
    input['self'] = input;

    expect(AssistantRedactionService.redact(input)).toEqual({ keep: true, self: '[Circular]' });
  });

  it('handles null-prototype objects and drops prototype pollution keys', () => {
    const input = Object.create(null) as Record<string, unknown>;
    input['keep'] = 'yes';
    input['__proto__'] = { polluted: true };

    expect(AssistantRedactionService.redact(input)).toEqual({ keep: 'yes' });
  });
});
