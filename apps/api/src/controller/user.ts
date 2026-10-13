import { UniqueConstraintViolationException } from '@mikro-orm/core';
import type { NextFunction, Request, Response } from 'express';
import { pick } from 'lodash-es';

import { zParse } from '@app/validators/parser';
import { completeOnboardingStepSchema, getRequisitionRequestSchema, updateUserDataRequestSchema } from '@app/validators/user';
import { AccountFinancialInstitution, AccountFinancialInstitutionProvider } from '@entity/AccountFinancialInstitution';
import { Appuser } from '@entity/Appuser';
import { EnableBankingConnection } from '@entity/EnableBankingConnection';
import { NordigenRequisition } from '@entity/NordigenRequisition';
import { Onboarding } from '@entity/Onboarding';
import { authedUser } from '@middleware/authed-context';
import { deleteWonderMoneyAccount } from '@service/account/account-deletion.service';
import { ERROR } from '@utils/constants';
import { buildEnableBankingInstitutionRecordId } from '@utils/enable-banking-institution-id';
import { BadRequestError, ConflictError, InternalServerError, NotFoundError } from '@utils/errors';

import { DI } from '../app';

export async function deleteCurrentUserAccount(req: Request, res: Response) {
  const user = authedUser(req);
  await deleteWonderMoneyAccount(user);
  return res.sendStatus(204);
}

/**
 * @description Get user account information
 *
 * @param {Request} req Express request object derived from http.incomingMessage
 * @param {Response} res Express response object
 */
export function getUserAccountInformation(req: Request, res: Response) {
  // Select required data from user enitty
  const userDataToSend = pick(req.user, [
    'emailAddress',
    'firstName',
    'lastName',
    'twofactorEnabled',
    'requiresMfaReenrollment',
  ]);
  return res.json(userDataToSend);
}

/** Return the authenticated user's profile using the mobile profile contract. */
export function getCurrentUserProfile(req: Request, res: Response) {
  const profile = pick(req.user, ['emailAddress', 'firstName', 'lastName']);
  return res.json({
    profile: {
      ...profile,
      // better-auth is the source of truth for MFA state; `getAuthSession` copies
      // `twoFactorEnabled` onto `req.authUser`. The `Appuser` row has no MFA column.
      mfaEnabled: req.authUser?.user.twoFactorEnabled ?? false,
    },
  });
}

/**
 * @description Clear the legacy MFA re-enrollment flag (RAD-294).
 *
 * Plan B: legacy Supabase identities are not being migrated, so no user is flagged
 * `requiresMfaReenrollment` anymore — in practice this endpoint is now a no-op. It is
 * deliberately kept (with its `Appuser` field) as a compatibility endpoint for web;
 * dropping both is a separate schema cleanup.
 */
export async function completeMfaReenrollment(req: Request, res: Response, next: NextFunction) {
  const user = await DI.em.getRepository(Appuser).getUserById(authedUser(req).appuserKey);
  if (!user) {
    next(new BadRequestError(ERROR.AUTH.INVALID_USER));
    return;
  }
  user.requiresMfaReenrollment = false;
  await DI.em.persist(user).flush();
  return res.sendStatus(200);
}

/**
 * @description Update user data. Can update single or multiple properties.
 *
 * @param {Request} req Express request object derived from http.incomingMessage
 * @param {Response} res Express response object
 */
export async function updateData(req: Request, res: Response, next: NextFunction) {
  const authedUser_ = authedUser(req);
  const {
    body: { firstName, lastName, mobileNumber, mobileNumberPrefix },
  } = await zParse(updateUserDataRequestSchema, req);
  const user = await DI.em.getRepository(Appuser).getUserById(authedUser_.appuserKey);
  if (!user) {
    next(new BadRequestError(ERROR.AUTH.INVALID_USER));
    return;
  }
  if (firstName) {
    user.firstName = firstName;
  }
  if (lastName) {
    user.lastName = lastName;
  }
  if (mobileNumber) {
    user.mobileNumber = mobileNumber;
  }
  if (mobileNumberPrefix) {
    user.mobileNumberPrefix = mobileNumberPrefix;
  }
  // The account email is intentionally not updatable here — see `updateUserDataRequestSchema`.
  // It is owned by the verified Supabase identity and reconciled on `/v1/auth/callback`.
  //
  // TODO: Not implemented. This should trigger a recalculation of the user's balances, trxs, etc.
  // if (currency) {
  //   const currencyKey = await DI.em.getRepository(Currency).getById(currency);
  //   if (!currencyKey) {
  //     return next(new BadRequestError('Invalid currency'));
  //   }
  //   user.currencyKey = currencyKey;
  // }
  try {
    await DI.em.persist(user).flush();
  } catch (error) {
    // A unique-index collision is a conflict, not a server fault. Returning 500 here made the
    // endpoint an oracle for "is this value already registered?" via the status differential.
    if (error instanceof UniqueConstraintViolationException) {
      next(new ConflictError('Could not save profile: a conflicting value already exists'));
      return;
    }
    throw error;
  }
  return res.sendStatus(200);
}

/**
 * @description Get user requisitions
 *
 * Widened (Phase 1c gap-close) to also surface the user's `EnableBankingConnection`
 * rows in the same array, alongside the untouched GoCardless `NordigenRequisition`
 * query below — the same "widen, discriminate on property presence, never change
 * GoCardless behavior" pattern used by `account-auto-sync-scheduler.service.ts` and
 * `account-initial-sync-enqueue.service.ts`. The GoCardless query/mapping is
 * byte-for-byte unchanged from before this widening; nothing is removed or renamed
 * from its response items, only new array elements are added for the other provider.
 *
 * Enable Banking's real provider-returned `accessValidUntil` is mapped onto the same
 * `expiresAt` field the GoCardless items already carry (rather than a second,
 * differently-named expiry field) so the frontend can render "expires in N days"
 * uniformly regardless of provider (plan §5).
 *
 * @param {Request} req Express request object derived from http.incomingMessage
 * @param {Response} res Express response object
 */
export async function getRequisitions(req: Request, res: Response) {
  const [nordigenRequisitions, enableBankingConnections] = await Promise.all([
    DI.em.find(
      NordigenRequisition,
      {
        appuserKey: req.user,
      },
      { populate: ['accounts'] },
    ),
    // Deliberately scoped to `deletedAt: undefined` (unlike the GoCardless query above,
    // which has no such filter — a pre-existing GoCardless behavior left untouched, see
    // docblock). `unlinkRequisition` soft-deletes `EnableBankingConnection` rows, and
    // showing an unlinked connection back in this list would be a real, avoidable
    // regression for the feature this widening exists to ship.
    DI.em.find(
      EnableBankingConnection,
      {
        appuserKey: req.user,
        deletedAt: undefined,
      },
      { populate: ['accounts'] },
    ),
  ]);

  // Best-effort logo lookup: `AccountFinancialInstitution.id` for an Enable Banking
  // institution is deterministically derived from {country, name} by the same helper
  // used when the row is first created during account sync (see
  // `account-initial-sync-account.service.ts`), so this look-up needs no extra
  // population of `accounts.accountFinancialInstitutionKey` (which would change the
  // serialized shape of nested `accounts` on both provider paths).
  const institutionRecordIds = [
    ...new Set(enableBankingConnections.map((connection) => buildEnableBankingInstitutionRecordId({ country: connection.aspspCountry, name: connection.aspspName }))),
  ];
  const enableBankingInstitutions = institutionRecordIds.length > 0
    ? await DI.em.find(AccountFinancialInstitution, {
      id: { $in: institutionRecordIds },
      provider: AccountFinancialInstitutionProvider.ENABLE_BANKING,
    })
    : [];
  const institutionByRecordId = new Map(enableBankingInstitutions.map((institution) => [institution.id, institution]));

  // eslint-disable-next-line @typescript-eslint/no-misused-spread
  const nordigenItems = nordigenRequisitions.map((r) => ({ ...r, provider: 'GoCardless' as const }));
  const enableBankingItems = enableBankingConnections.map((connection) => {
    const institution = institutionByRecordId.get(buildEnableBankingInstitutionRecordId({ country: connection.aspspCountry, name: connection.aspspName }));
    return {
      // eslint-disable-next-line @typescript-eslint/no-misused-spread
      ...connection,
      expiresAt: connection.accessValidUntil,
      institution: {
        country: connection.aspspCountry,
        logoUrl: institution?.logoUrl ?? null,
        name: connection.aspspName,
      },
      provider: 'EnableBanking' as const,
    };
  });

  return res.json({ requisitions: [...nordigenItems, ...enableBankingItems] });
}

/**
 * @description Get requisition by id
 *
 * @param {Request} req Express request object derived from http.incomingMessage
 * @param {Response} res Express response object
 */
export async function completeOnboardingStep(req: Request, res: Response, next: NextFunction) {
  try {
    const {
      params: { step },
    } = await zParse(completeOnboardingStepSchema, req);

    // Find the onboarding step
    const onboardingStep = await DI.em.findOne(Onboarding, { active: true, step });
    if (!onboardingStep) {
      next(new NotFoundError('Onboarding step not found'));
      return;
    }

    // Get user with onboarding collection loaded
    const appuser = await DI.em.findOne(Appuser, { appuserKey: req.user?.appuserKey }, { populate: ['onboarding'] });
    if (!appuser) {
      next(new NotFoundError('User not found'));
      return;
    }

    // Add the onboarding step
    await DI.em.getRepository(Appuser).addOnboardingStep(appuser, onboardingStep);

    return res.sendStatus(200);
  } catch (error) {
    next(new InternalServerError(`Failed to complete onboarding step: ${error}`));
    return;
  }
}

export async function getOnboarding(req: Request, res: Response) {
  const user = authedUser(req);
  const knex = DI.em.getConnection().getKnex();
  const onboarding = (await knex
    .select([
      'onboarding.step',
      'onboarding.description',
      knex.raw('case when appuser_onboarding.onboarding_key is null then false else true end as "done"'),
    ])
    .from('onboarding')
    .leftJoin('appuser_onboarding', (joinBuilder) => {
      return joinBuilder
        .on('appuser_onboarding.onboarding_key', '=', 'onboarding.onboarding_key')
        .andOn('appuser_onboarding.appuser_key', '=', knex.raw('?', [user.appuserKey]));
    })
    .orderBy('onboarding.step', 'asc')) as {
    done: boolean;
    step: number;
  }[];

  return res.json({ onboarding });
}

export async function getRequisition(req: Request, res: Response) {
  // Identity comes from `req.user`, never from `:userId`; `:requisitionId` is validated rather
  // than read raw off `req.params` so the only caller-controlled value on this route is bounded.
  const {
    params: { requisitionId },
  } = await zParse(getRequisitionRequestSchema, req);
  const requisition = await DI.em.findOne(
    NordigenRequisition,
    {
      appuserKey: req.user,
      requisitionId,
    },
    { populate: ['accounts'] },
  );
  // eslint-disable-next-line @typescript-eslint/no-misused-spread
  return res.json({ requisition: { ...requisition, provider: 'GoCardless' } });
}
