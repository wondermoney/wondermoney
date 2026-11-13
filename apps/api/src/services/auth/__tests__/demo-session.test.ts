import { describe, expect, it } from 'vitest';

import { demoPersona } from '@app/database/seeders/demo/demo-fixtures';
import { capDemoSessionRefresh, DEMO_SESSION_TTL_MS, isExpiredDemoSession } from '@service/auth/demo-session';

const CREATED = new Date('2026-11-12T10:00:00.000Z');
const DEADLINE = new Date(CREATED.getTime() + DEMO_SESSION_TTL_MS);
const SEVEN_DAYS = new Date(CREATED.getTime() + 7 * 24 * 60 * 60 * 1000);

/** What better-auth's `get-session` hands the update hook while it refreshes a session. */
const refreshing = (email: string) => ({ context: { session: { session: { createdAt: CREATED }, user: { email } } } });

describe('demo session lifetime', () => {
  it('ends a demo session two hours after it started, and no other session', () => {
    const justBefore = new Date(DEADLINE.getTime() - 1000);

    expect(isExpiredDemoSession({ createdAt: CREATED, email: demoPersona.email }, justBefore)).toBe(false);
    expect(isExpiredDemoSession({ createdAt: CREATED, email: demoPersona.email }, DEADLINE)).toBe(true);
    expect(isExpiredDemoSession({ createdAt: CREATED, email: 'DEMO@wonder.money ' }, DEADLINE)).toBe(true);
    expect(isExpiredDemoSession({ createdAt: CREATED, email: 'owner@example.test' }, SEVEN_DAYS)).toBe(false);
  });

  it('keeps a refresh from moving a demo session past its deadline', () => {
    const update = { expiresAt: SEVEN_DAYS, updatedAt: new Date() };

    expect(capDemoSessionRefresh(update, refreshing(demoPersona.email))).toEqual({ data: { ...update, expiresAt: DEADLINE } });
  });

  it('leaves the refresh of any other account alone', () => {
    expect(capDemoSessionRefresh({ expiresAt: SEVEN_DAYS }, refreshing('owner@example.test'))).toBeUndefined();
  });

  it('leaves an update alone when it cannot tell whose session it is, or the expiry stays inside the deadline', () => {
    expect(capDemoSessionRefresh({ expiresAt: SEVEN_DAYS }, null)).toBeUndefined();
    expect(capDemoSessionRefresh({ expiresAt: SEVEN_DAYS }, { context: {} })).toBeUndefined();
    expect(capDemoSessionRefresh({ updatedAt: new Date() }, refreshing(demoPersona.email))).toBeUndefined();
    expect(capDemoSessionRefresh({ expiresAt: new Date(DEADLINE.getTime() - 1) }, refreshing(demoPersona.email))).toBeUndefined();
  });
});
