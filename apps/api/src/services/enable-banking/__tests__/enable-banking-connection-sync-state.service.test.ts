import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/database/di', () => ({ DI: { em: {} } }));
vi.mock('../enable-banking-credential.service', () => ({ enableBankingCredentialService: {} }));

import { type EnableBankingConnection, EnableBankingConnectionStatus } from '@entity/EnableBankingConnection';

import { EnableBankingConnectionSyncState } from '../enable-banking-connection-sync-state.service';

type Deps = NonNullable<ConstructorParameters<typeof EnableBankingConnectionSyncState>[0]>;

function harness(connection: null | Partial<EnableBankingConnection>, session: (() => Promise<{ status: string }>) = () => Promise.resolve({ status: 'AUTHORIZED' })) {
  const getSession = vi.fn(session);
  const em = { findOne: vi.fn(async () => connection), flush: vi.fn().mockResolvedValue(undefined) };
  const service = new EnableBankingConnectionSyncState({
    clientFor: () => ({ getSession }),
    em: () => em as unknown as ReturnType<NonNullable<Deps['em']>>,
    now: () => new Date('2026-11-06T10:00:00Z'),
  });
  return { em, getSession, service };
}

const linked = (): Partial<EnableBankingConnection> => ({ enableBankingConnectionKey: 20, sessionId: 'session-20', status: EnableBankingConnectionStatus.LINKED });

describe('Enable Banking connection sync state', () => {
  it('expires a linked connection whose session the bank no longer authorizes', async () => {
    const connection = linked();
    const h = harness(connection, () => Promise.resolve({ status: 'REVOKED' }));
    await expect(h.service.checkConsent(20)).resolves.toBe('ended');
    expect(h.getSession).toHaveBeenCalledWith('session-20');
    expect(connection.status).toBe(EnableBankingConnectionStatus.EXPIRED);
    expect(h.em.flush).toHaveBeenCalled();
  });

  it('leaves the connection linked while the session is still authorized', async () => {
    const connection = linked();
    const h = harness(connection);
    await expect(h.service.checkConsent(20)).resolves.toBe('active');
    expect(connection.status).toBe(EnableBankingConnectionStatus.LINKED);
  });

  it('changes nothing when the session lookup itself fails', async () => {
    const connection = linked();
    const h = harness(connection, () => Promise.reject(Object.assign(new Error('unauthorized'), { status: 401 })));
    await expect(h.service.checkConsent(20)).resolves.toBe('unknown');
    expect(connection.status).toBe(EnableBankingConnectionStatus.LINKED);
    expect(h.em.flush).not.toHaveBeenCalled();
  });

  it('cannot judge a connection without a session', async () => {
    const h = harness({ ...linked(), sessionId: undefined });
    await expect(h.service.checkConsent(20)).resolves.toBe('unknown');
    expect(h.getSession).not.toHaveBeenCalled();
  });

  it('defers the next sync by the provider Retry-After', async () => {
    const connection = linked();
    const h = harness(connection);
    await expect(h.service.deferNextSync(20, 3600)).resolves.toEqual(new Date('2026-11-06T11:00:00Z'));
    expect(connection.nextEligibleSyncAt).toEqual(new Date('2026-11-06T11:00:00Z'));
  });

  it('defers by the default sync interval without a Retry-After, and never past a week', async () => {
    const connection = linked();
    const h = harness(connection);
    await h.service.deferNextSync(20);
    expect(connection.nextEligibleSyncAt).toEqual(new Date('2026-11-07T06:00:00Z'));
    await h.service.deferNextSync(20, 90 * 24 * 60 * 60);
    expect(connection.nextEligibleSyncAt).toEqual(new Date('2026-11-13T10:00:00Z'));
  });
});
