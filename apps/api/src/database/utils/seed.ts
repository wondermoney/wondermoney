import { createHash } from 'node:crypto';

import { startOfDay } from 'date-fns';

const DEFAULT_SEED_RANDOM_SEED = 'wondermoney-seed';

function parseSeedReferenceDate(): Date {
  const rawDate = seedEnv('SEED_REFERENCE_DATE');
  const date = rawDate ? new Date(rawDate) : new Date();

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid SEED_REFERENCE_DATE: ${rawDate}`);
  }

  return date;
}

const seedReferenceDate = parseSeedReferenceDate();

export function createSeedRandom(scope: string): () => number {
  let state = hashSeed(`${seedEnv('SEED_RANDOM_SEED') ?? DEFAULT_SEED_RANDOM_SEED}:${scope}`);

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function getSeedNow(): Date {
  return new Date(seedReferenceDate.getTime());
}

export function getSeedToday(): Date {
  return startOfDay(getSeedNow());
}

export function getSeedYear(): number {
  return getSeedNow().getFullYear();
}

export function randomFloat(random: () => number, min: number, max: number): number {
  if (min === max) return min;

  const lower = Math.min(min, max);
  const upper = Math.max(min, max);

  return random() * (upper - lower) + lower;
}

export function randomInt(random: () => number, min: number, max: number): number {
  const lower = Math.ceil(Math.min(min, max));
  const upper = Math.floor(Math.max(min, max));

  return Math.floor(random() * (upper - lower + 1)) + lower;
}

export function requireSeedDependency<T>(value: null | T | undefined, label: string): T {
  if (value === undefined || value === null) {
    throw new Error(`Missing seed dependency: ${label}`);
  }

  return value;
}

const DEFAULT_SEED_PASSWORD = 'Seed-User-Password-1!';

/** Dev password for the better-auth credential user created for a seeded Appuser, so the
 *  seeded account can actually sign in via better-auth email/password. Override per-name via
 *  `SEED_ADMIN_PASSWORD` / `SEED_DEMO_PASSWORD` / `SEED_EMPTY_PASSWORD` if needed. */
export function seedPassword(name: 'ADMIN' | 'DEMO' | 'EMPTY'): string {
  return seedEnv(`SEED_${name}_PASSWORD`) ?? DEFAULT_SEED_PASSWORD;
}

export function seedUuid(scope: string, key: string): string {
  const hash = createHash('sha256')
    .update(`${seedEnv('SEED_RANDOM_SEED') ?? DEFAULT_SEED_RANDOM_SEED}:${scope}:${key}`)
    .digest();

  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x40;
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80;

  const hex = hash.toString('hex', 0, 16);

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function hashSeed(seed: string): number {
  let hash = 2_166_136_261;

  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619);
  }

  return hash >>> 0;
}

function seedEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();

  return value ? value : undefined;
}
