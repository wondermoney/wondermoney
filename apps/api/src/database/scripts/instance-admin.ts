/**
 * Grant or revoke instance admin by hand, for a server without single sign-on:
 *
 *   node dist/database/scripts/instance-admin.js grant someone@example.com
 *   node dist/database/scripts/instance-admin.js revoke someone@example.com
 *   node dist/database/scripts/instance-admin.js list
 *
 * Run it inside the api container (`docker compose exec api ...`). The person needs an account
 * first. With `OIDC_ADMIN_GROUPS` set, their next OIDC sign-in sets the flag from their groups.
 */
import { pathToFileURL } from 'node:url';

import { RequestContext } from '@mikro-orm/core';

import { closeDatabase, connectDatabase, DI } from '@app/database/di';

export type InstanceAdminCommand = { command: 'grant' | 'revoke'; email: string } | { command: 'list' };

const USAGE = 'Usage: instance-admin grant <email> | revoke <email> | list';


export async function main(argv = process.argv.slice(2)): Promise<number> {
  let parsed: InstanceAdminCommand;
  try {
    parsed = parseInstanceAdminArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : USAGE);
    return 2;
  }
  const { listInstanceAdminEmails, setInstanceAdminByEmail } = await import('@service/auth/instance-admin.service');
  await connectDatabase();
  try {
    return await RequestContext.create(DI.em, async () => {
      if (parsed.command === 'list') {
        const emails = await listInstanceAdminEmails(DI.em);
        console.log(emails.length === 0 ? 'No instance admins.' : emails.join('\n'));
        return 0;
      }
      const admin = parsed.command === 'grant';
      const change = await setInstanceAdminByEmail(DI.em, parsed.email, admin);
      if (change === 'not_found') {
        console.error(`No account with the email ${parsed.email}. Sign up first, then run this again.`);
        return 1;
      }
      if (change === 'demo') {
        console.error('The demo account cannot be an instance admin.');
        return 1;
      }
      const state = admin ? 'an instance admin' : 'not an instance admin';
      console.log(change === 'updated' ? `${parsed.email} is now ${state}.` : `${parsed.email} was already ${state}.`);
      return 0;
    });
  } finally {
    await closeDatabase();
  }
}

export function parseInstanceAdminArgs(args: string[]): InstanceAdminCommand {
  const [command, email, ...rest] = args;
  if (command === 'list' && email === undefined) return { command };
  if ((command === 'grant' || command === 'revoke') && email?.includes('@') && rest.length === 0) return { command, email };
  throw new Error(USAGE);
}

const executedAsScript = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (executedAsScript) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
