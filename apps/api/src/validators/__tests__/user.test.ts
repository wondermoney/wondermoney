import { describe, expect, it } from 'vitest';

import { getRequisitionRequestSchema, updateUserDataRequestSchema } from '../user';

const parseBody = (body: Record<string, unknown>) => updateUserDataRequestSchema.safeParse({ body });

/**
 * The account email is the verified Supabase identity and the delivery address for every
 * transactional email. Accepting it here let an authenticated user claim any address:
 * squatting a signup, breaking household invites for it, and redirecting its owner's mail.
 */
describe('updateUserDataRequestSchema email address', () => {
  it('drops an emailAddress instead of writing it to the account', () => {
    const result = parseBody({ emailAddress: 'victim@example.com', firstName: 'Ada' });

    expect(result.success).toBe(true);
    expect(result.data?.body).not.toHaveProperty('emailAddress');
    expect(result.data?.body.firstName).toBe('Ada');
  });

  it('still accepts the fields a user genuinely owns', () => {
    const result = parseBody({ firstName: 'Ada', lastName: 'Lovelace', mobileNumber: '911111111', mobileNumberPrefix: '+351' });

    expect(result.success).toBe(true);
    expect(result.data?.body).toEqual({
      currency: undefined,
      firstName: 'Ada',
      lastName: 'Lovelace',
      mobileNumber: '911111111',
      mobileNumberPrefix: '+351',
    });
  });
});

describe('updateUserDataRequestSchema name shape', () => {
  it('rejects markup in a name, which would otherwise reach an invite email body', () => {
    expect(parseBody({ firstName: '<a href="https://evil.tld">Security Alert</a>' }).success).toBe(false);
    expect(parseBody({ lastName: '<img src=x onerror=alert(1)>' }).success).toBe(false);
  });

  it('rejects control characters and ampersands', () => {
    expect(parseBody({ firstName: 'Ada\u0000' }).success).toBe(false);
    expect(parseBody({ firstName: 'Ada & Co' }).success).toBe(false);
  });

  it('accepts real names, including accents, apostrophes, hyphens and titles', () => {
    const names = ['Ada', 'José', 'Ana Sofía', "O'Brien", 'Anne-Marie', 'Martin Jr.', 'Ólafsdóttir', '李雷'];

    expect(names.filter((name) => !parseBody({ firstName: name }).success)).toEqual([]);
  });

  it('trims surrounding whitespace and still accepts a blank field as "no change"', () => {
    expect(parseBody({ firstName: '  Ada  ' }).data?.body.firstName).toBe('Ada');
    expect(parseBody({ firstName: '' }).success).toBe(true);
  });

  it('keeps the 100 character ceiling', () => {
    expect(parseBody({ firstName: 'a'.repeat(101) }).success).toBe(false);
  });
});

describe('getRequisitionRequestSchema', () => {
  it('accepts a provider requisition id', () => {
    const result = getRequisitionRequestSchema.safeParse({ params: { requisitionId: '9f1b6a2c-1111-2222-3333-444455556666' } });

    expect(result.success).toBe(true);
  });

  it('rejects an empty, oversized, or oddly-shaped id rather than passing it to the ORM', () => {
    expect(getRequisitionRequestSchema.safeParse({ params: { requisitionId: '' } }).success).toBe(false);
    expect(getRequisitionRequestSchema.safeParse({ params: { requisitionId: 'a'.repeat(65) } }).success).toBe(false);
    expect(getRequisitionRequestSchema.safeParse({ params: { requisitionId: "req' or 1=1" } }).success).toBe(false);
    expect(getRequisitionRequestSchema.safeParse({ params: {} }).success).toBe(false);
  });
});
