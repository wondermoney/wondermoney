import { demoCompanion } from '@app/database/seeders/demo/demo-fixtures';
import { type Appuser, AppuserAccountType } from '@entity/Appuser';

/** Exact seeder-owned identity. It has no better-auth user and cannot sign in. */
export function isDemoCompanionProfile(
  user: Pick<Appuser, 'accountType' | 'emailAddress' | 'externalUserId'>,
): boolean {
  return (
    user.accountType === AppuserAccountType.DEMO &&
    user.emailAddress === demoCompanion.email &&
    user.externalUserId === demoCompanion.externalUserId
  );
}
