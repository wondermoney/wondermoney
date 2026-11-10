import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env['CREDENTIAL_ENCRYPTION_KEY_V1'] = Buffer.alloc(32, 7).toString('base64');
});

import { useTestDatabase } from '@app/__tests__/__helpers__/pg-test-db';

import { OperationSecretService } from '../operation-secret.service';

/*
 * A one-time secret handed from the request that starts an operation to the process that runs
 * it: stored encrypted, readable once, and gone once read or expired.
 */
describe('operation secrets', () => {
  const db = useTestDatabase();

  const NOW = new Date('2026-11-08T10:00:00Z');
  const MINUTE = 60 * 1000;
  const SECRET = 'correct horse battery staple';

  const service = (now = NOW) => new OperationSecretService(db.em(), { now: () => now });
  const rows = async () => db.em().getConnection().execute<Record<string, unknown>[]>('select * from operation_secret');

  it('hands the secret back once, then forgets it', async () => {
    await service().put('op:1', SECRET, new Date(NOW.getTime() + 30 * MINUTE));

    await expect(service().take('op:1')).resolves.toBe(SECRET);
    await expect(service().take('op:1')).resolves.toBeNull();
    await expect(rows()).resolves.toEqual([]);
  });

  it('never stores the secret in clear', async () => {
    await service().put('op:1', SECRET, new Date(NOW.getTime() + 30 * MINUTE));

    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toContain(SECRET);
    expect(JSON.stringify(stored)).not.toContain(Buffer.from(SECRET).toString('base64'));
  });

  it('does not hand back an expired secret, and deletes it', async () => {
    await service().put('op:1', SECRET, new Date(NOW.getTime() + 30 * MINUTE));

    await expect(service(new Date(NOW.getTime() + 31 * MINUTE)).take('op:1')).resolves.toBeNull();
    await expect(rows()).resolves.toEqual([]);
  });

  it("keeps each operation's secret to itself", async () => {
    await service().put('op:1', SECRET, new Date(NOW.getTime() + 30 * MINUTE));
    await service().put('op:2', 'another long password', new Date(NOW.getTime() + 30 * MINUTE));

    await expect(service().take('op:2')).resolves.toBe('another long password');
    await expect(service().take('op:1')).resolves.toBe(SECRET);
  });

  it('can be read without being used up, for an operation that needs it twice, until it expires', async () => {
    await service().put('op:1', SECRET, new Date(NOW.getTime() + 30 * MINUTE));

    await expect(service().read('op:1')).resolves.toBe(SECRET);
    await expect(service().read('op:1')).resolves.toBe(SECRET);
    await expect(service(new Date(NOW.getTime() + 31 * MINUTE)).read('op:1')).resolves.toBeNull();
    await expect(service().read('op:missing')).resolves.toBeNull();
    await expect(service().take('op:1')).resolves.toBe(SECRET);
  });

  it('discards a secret nobody will read', async () => {
    await service().put('op:1', SECRET, new Date(NOW.getTime() + 30 * MINUTE));

    await service().discard(['op:1']);

    await expect(service().take('op:1')).resolves.toBeNull();
  });

  it('purges expired secrets and keeps live ones', async () => {
    await service().put('op:old', SECRET, new Date(NOW.getTime() + 5 * MINUTE));
    await service().put('op:live', SECRET, new Date(NOW.getTime() + 60 * MINUTE));

    await expect(service(new Date(NOW.getTime() + 10 * MINUTE)).purgeExpired()).resolves.toBe(1);

    await expect(rows()).resolves.toEqual([expect.objectContaining({ correlation_id: 'op:live' })]);
  });

  it('refuses a secret already stored for the operation rather than replacing it', async () => {
    await service().put('op:1', SECRET, new Date(NOW.getTime() + 30 * MINUTE));

    await expect(service().put('op:1', 'a different password', new Date(NOW.getTime() + 30 * MINUTE))).rejects.toThrow();
    await expect(service().take('op:1')).resolves.toBe(SECRET);
  });
});
