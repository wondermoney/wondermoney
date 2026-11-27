import { pathToFileURL } from 'node:url';

import { RequestContext } from '@mikro-orm/core';

import { closeDatabase, connectDatabase, DI } from '@app/database/di';
import type { ReviewSeedResult } from '@service/review-account/review-account-seed.service';

/**
 * `pnpm review:seed` (built `dist`, `NODE_ENV=production`) or `pnpm review:seed:dev` (source): create
 * or refresh the store-review account and its household on the database `DB_*` points at (see
 * `review-account-seed.service.ts`). Safe to run again; it writes that account and household only.
 *
 * The address is required: `--email <address>`, or the `REVIEW_ACCOUNT_EMAIL` setting.
 * `--reset-password` replaces the password and locks the previous holder out (two-factor off too);
 * `--disable-2fa` turns two-factor sign-in off and nothing else; `--as-of-date YYYY-MM-DD` dates the
 * sample data up to that day instead of today.
 *
 * A password set by the run is printed once, on standard output, and nowhere else.
 */

export interface ReviewSeedArgs {
  asOfDate: Date;
  disableTwoFactor: boolean;
  email: string;
  resetPassword: boolean;
}

const USAGE =
  'Usage: review:seed --email <address> [--reset-password] [--disable-2fa] [--as-of-date YYYY-MM-DD] (or set REVIEW_ACCOUNT_EMAIL)';

export async function main(
  argv = process.argv.slice(2),
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): Promise<void> {
  // Before connecting, so a missing address refuses with nothing opened.
  const args = parseReviewSeedArgs(argv);
  const { seedReviewAccount } = await import('@service/review-account/review-account-seed.service');
  const { closeBetterAuthPool } = await import('@service/auth/better-auth');
  await connectDatabase();

  try {
    const result = await RequestContext.create(DI.em, () =>
      seedReviewAccount({
        asOfDate: args.asOfDate,
        disableTwoFactor: args.disableTwoFactor,
        em: DI.em,
        email: args.email,
        resetPassword: args.resetPassword,
      }),
    );
    for (const line of reviewSeedReport(args.email, result)) write(line);
  } finally {
    await closeDatabase();
    await closeBetterAuthPool();
  }
}

export function parseReviewSeedArgs(args: string[], env: NodeJS.ProcessEnv = process.env): ReviewSeedArgs {
  let email: string | undefined;
  let asOfDate = new Date();
  let resetPassword = false;
  let disableTwoFactor = false;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    // `pnpm review:seed -- --email <address>`: pnpm passes the separator on.
    if (flag === '--') continue;
    if (flag === '--reset-password') {
      resetPassword = true;
      continue;
    }
    if (flag === '--disable-2fa') {
      disableTwoFactor = true;
      continue;
    }
    const value = args[index + 1];
    if ((flag !== '--email' && flag !== '--as-of-date') || value === undefined || value.startsWith('--')) {
      throw new Error(`${USAGE}; got ${args.join(' ')}`);
    }
    index += 1;
    if (flag === '--email') email = value;
    else asOfDate = parseDay(value);
  }
  email = (email ?? env['REVIEW_ACCOUNT_EMAIL'] ?? '').trim();
  if (!email) throw new Error(`The review account's address is required. ${USAGE}`);
  return { asOfDate, disableTwoFactor, email, resetPassword };
}

function parseDay(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  const parsed = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
  if (parsed?.toISOString().slice(0, 10) !== value) throw new Error(`Invalid --as-of-date value: ${value}`);
  return parsed;
}

/** What the run prints: a summary without the password, then the password alone when one was set. */
export function reviewSeedReport(email: string, result: ReviewSeedResult): string[] {
  const { password, ...summary } = result;
  const lines = [`Review account ${email} is ready ${JSON.stringify(summary)}`];
  if (result.twoFactorDisabled) lines.push('Two-factor sign-in was on; it is now off.');
  if (password) {
    lines.push(
      `Its password, shown this once (store it in the password manager; rerun with --reset-password to replace it):`,
      password,
    );
  } else {
    lines.push('Its password was kept.');
  }
  return lines;
}

const executedAsScript = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (executedAsScript) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
