import bcrypt from 'bcryptjs';
import { describe, expect, it, vi } from 'vitest';

// This is the one file that needs the REAL better-auth module — the global test double
// (src/test/setup.ts) replaces it everywhere else. Opt back in, and give the module the
// dummy DB env its import-time pool constructor requires. The pool is never queried here,
// so fake credentials are fine; the shims under test use bcryptjs / better-auth crypto only.
vi.hoisted(() => {
  process.env['DB_HOST'] ??= 'localhost';
  process.env['DB_PORT'] ??= '5432';
  process.env['DB_DATABASE'] ??= 'test';
  process.env['DB_USERNAME'] ??= 'test';
  process.env['DB_PASSWORD'] ??= 'test';
});
vi.unmock('./better-auth');

import { hashPasswordShim, isLegacyBcryptHash, verifyPasswordShim } from './better-auth';

describe('isLegacyBcryptHash', () => {
  it.each(['$2a$10$abcdefghijklmnopqrstuv', '$2b$12$abcdefghijklmnopqrstuv', '$2y$10$abcdefghijklmnopqrstuv'])(
    'recognizes bcrypt hash prefix %s',
    (hash) => {
      expect(isLegacyBcryptHash(hash)).toBe(true);
    },
  );

  it('rejects a better-auth scrypt-format hash', () => {
    expect(isLegacyBcryptHash('abcdef:0123456789abcdef')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isLegacyBcryptHash('')).toBe(false);
  });
});

describe('hashPasswordShim + verifyPasswordShim (non-legacy branch)', () => {
  it('round-trips a freshly hashed password', async () => {
    const hash = await hashPasswordShim('correct horse battery staple');

    await expect(verifyPasswordShim({ hash, password: 'correct horse battery staple' })).resolves.toBe(true);
  });

  it('rejects the wrong password against a freshly hashed password', async () => {
    const hash = await hashPasswordShim('correct horse battery staple');

    await expect(verifyPasswordShim({ hash, password: 'wrong password' })).resolves.toBe(false);
  });

  it('produces a hash that is not mistaken for a legacy bcrypt hash', async () => {
    const hash = await hashPasswordShim('correct horse battery staple');

    expect(isLegacyBcryptHash(hash)).toBe(false);
  });
});

describe('verifyPasswordShim (legacy bcrypt branch)', () => {
  it('accepts the correct password against a legacy bcrypt hash', async () => {
    const legacyHash = bcrypt.hashSync('legacy-password', 10);

    await expect(verifyPasswordShim({ hash: legacyHash, password: 'legacy-password' })).resolves.toBe(true);
  });

  it('rejects the wrong password against a legacy bcrypt hash', async () => {
    const legacyHash = bcrypt.hashSync('legacy-password', 10);

    await expect(verifyPasswordShim({ hash: legacyHash, password: 'wrong-password' })).resolves.toBe(false);
  });
});
