import { type Request, type Response } from 'express';

import { DI } from '@app/app';
import { Appuser, AppuserAccountType } from '@entity/Appuser';
import { recordAnalyticsOutboxEvent } from '@service/analytics/analytics-outbox.service';
import { ensureAppuserTenantLink, getOrCreateTenant, isAppError } from '@service/auth/auth-callback.service';
import { getAuthUserFullName } from '@service/auth/auth-callback.utils';
import { type AuthContext, betterAuthUserExists, getPrimaryAuthProvider, sendReconnectVerificationEmail } from '@service/auth/better-auth';
import { reconnectLegacyAppuser } from '@service/auth/legacy-account-reconnect.service';
import { recordSignup } from '@service/auth/signup-record.service';
import { sendSignupEmail } from '@service/email/email';
import { consumeInvite, notifyExistingUserInviteAttempt, validateInviteForSignup } from '@service/household/household-invite.service';
import { ERROR } from '@utils/constants';
import { BadRequestError, ERROR_CODE, InternalServerError } from '@utils/errors';
import { fireAndForget } from '@utils/fire-and-forget';
import logger from '@utils/logger';
import { authCallbackRequestSchema, mapRouteLocaleToEmailLanguage } from '@validators/auth';
import { zParse } from '@validators/parser';

export async function authCallback(req: Request, res: Response) {
  const { body } = await zParse(authCallbackRequestSchema, req);

  const authUser = req.authUser;
  const externalUserId = authUser?.user.id;
  const email = authUser?.user.email;
  const fullName = getAuthUserFullName(authUser?.user);

  if (!externalUserId || !email) {
    throw new BadRequestError('Auth user identity is required');
  }

  const method = await getAuthMethod(externalUserId);
  let committedSignupAppuserKey: number | undefined;
  let provisioningStage = 'tenant';

  try {
    const existingUserByExternalId = await DI.em.getRepository(Appuser).getUserByExternalId(externalUserId);
    if (existingUserByExternalId) {
      logger.info({ appuserKey: existingUserByExternalId.appuserKey }, 'Existing user logging in');
      if (body.inviteToken) {
        // Existing accounts can't accept household invites yet — flag for demand.
        notifyExistingUserInviteAttempt(email, existingUserByExternalId.appuserKey);
      }
      const sessionId = getAuthSessionId(authUser);
      if (sessionId) {
        await recordAnalyticsOutboxEvent(DI.em, {
          distinctId: externalUserId,
          eventId: `login.v1:${sessionId}`,
          eventName: 'login',
          properties: getBaseAnalyticsProperties(existingUserByExternalId, method),
        });
      } else {
        logger.warn({ appuserKey: existingUserByExternalId.appuserKey }, 'Skipping login analytics because the auth session id is missing');
      }

      if (isDemoAccount(existingUserByExternalId)) {
        return sendAuthCallbackSuccess(res, existingUserByExternalId.appuserKey, method, 'demo');
      }

      committedSignupAppuserKey = existingUserByExternalId.appuserKey;
      provisioningStage = 'tenant';
      const tenant = await getOrCreateTenant(DI.em, existingUserByExternalId);
      provisioningStage = 'tenant-link';
      await ensureAppuserTenantLink(DI.em, existingUserByExternalId, tenant);
      return sendAuthCallbackSuccess(res, existingUserByExternalId.appuserKey, method, 'login');
    }

    const existingUserByEmail = await DI.em.getRepository(Appuser).getUserByEmail(email);
    if (existingUserByEmail) {
      if (isDemoAccount(existingUserByEmail)) {
        logger.info({ appuserKey: existingUserByEmail.appuserKey }, 'Demo user logging in via alternate provider');
        return sendAuthCallbackSuccess(res, existingUserByEmail.appuserKey, method, 'demo');
      }

      const reconnect = await reconnectLegacyAppuser(
        DI.em,
        { appuser: existingUserByEmail, emailVerified: authUser.user.emailVerified, externalUserId },
        { authUserExists: betterAuthUserExists },
      );
      if (reconnect === 'reconnected') {
        logger.info({ appuserKey: existingUserByEmail.appuserKey }, 'Reconnected an account from before better-auth to a new login');
        const reconnected = await DI.em.getRepository(Appuser).getUserByExternalId(externalUserId);
        if (!reconnected) throw new InternalServerError('Reconnected account not found');
        committedSignupAppuserKey = reconnected.appuserKey;
        provisioningStage = 'tenant';
        const tenant = await getOrCreateTenant(DI.em, reconnected);
        provisioningStage = 'tenant-link';
        await ensureAppuserTenantLink(DI.em, reconnected, tenant);
        return sendAuthCallbackSuccess(res, reconnected.appuserKey, method, 'login');
      }
      if (reconnect === 'email-unverified') {
        await sendReconnectVerificationEmail(email, body.locale);
        throw new BadRequestError(
          'This email has an account from before the sign-in change. We emailed you a link: follow it, then sign in again to reconnect it.',
          ERROR_CODE.ACCOUNT_RECONNECT_EMAIL_UNVERIFIED,
        );
      }

      logger.warn(
        {
          email,
          existingExternalUserId: existingUserByEmail.externalUserId,
          newExternalUserId: externalUserId,
        },
        'User attempted to register with different provider for existing email',
      );
      throw new BadRequestError(
        'An account with this email already exists. Please use your original sign-in method or contact support.',
      );
    }

    // Validate the invite before creating anything, so an invalid/expired
    // token or an email mismatch aborts the signup cleanly.
    const validatedInvite = body.inviteToken ? await validateInviteForSignup(DI.em, body.inviteToken, email) : null;

    const [firstName, lastName] = fullName ? fullName.split(' ') : [undefined, undefined];
    const { appuser: appUser, created: signupCreated } = await recordSignup({
      email,
      externalUserId,
      firstName: firstName ?? email.split('@')[0],
      language: mapRouteLocaleToEmailLanguage(body.locale),
      lastName,
      method,
    });
    committedSignupAppuserKey = appUser.appuserKey;

    if (validatedInvite) {
      // Household member: join the owner's tenant as a member, so skip creating a
      // tenant of their own.
      provisioningStage = 'household-join';
      await consumeInvite(DI.em, validatedInvite, appUser);
      if (signupCreated) {
        fireAndForget(sendSignupEmail({ userEmail: appUser.emailAddress }, appUser.language), {
          appuserKey: appUser.appuserKey,
          task: 'sendSignupEmail',
        });
      }
      return sendAuthCallbackSuccess(res, appUser.appuserKey, method, signupCreated ? 'signup' : 'login');
    }

    provisioningStage = 'tenant';
    const tenant = await getOrCreateTenant(DI.em, appUser);
    provisioningStage = 'tenant-link';
    await ensureAppuserTenantLink(DI.em, appUser, tenant);
    if (signupCreated) {
      fireAndForget(sendSignupEmail({ userEmail: appUser.emailAddress }, appUser.language), {
        appuserKey: appUser.appuserKey,
        task: 'sendSignupEmail',
      });
    }
    return sendAuthCallbackSuccess(res, appUser.appuserKey, method, signupCreated ? 'signup' : 'login');
  } catch (error) {
    if (committedSignupAppuserKey !== undefined) {
      logger.error(
        {
          appuserKey: committedSignupAppuserKey,
          errorType: error instanceof Error ? error.constructor.name : typeof error,
          stage: provisioningStage,
        },
        'Auth callback provisioning failed after canonical signup',
      );
      if (isAppError(error)) throw error;
      throw new InternalServerError('Post-signup provisioning failed');
    }

    const duplicateRecord = error !== null
      && typeof error === 'object'
      && 'code' in error
      && error.code === ERROR.DB.DUPLICATE_RECORD_CODE;
    if (duplicateRecord) {
      logger.warn({ email, error }, 'Existing user tried to register again');
      throw new BadRequestError('Existing user tried to register again');
    } else if (isAppError(error)) {
      throw error;
    } else {
      logger.error(
        {
          email,
          error,
          externalUserId,
          fullName,
        },
        'Error creating user during auth callback',
      );
      throw new InternalServerError(
        error instanceof Error ? error.message : 'Unknown error occurred during user creation',
      );
    }
  }
}

async function getAuthMethod(userId: string): Promise<string> {
  return getPrimaryAuthProvider(userId);
}

function getAuthSessionId(authUser: AuthContext | undefined): string | undefined {
  return authUser?.session.id;
}

function getBaseAnalyticsProperties(appUser: Appuser, method: string, extraProperties: Record<string, boolean | number | string> = {}) {
  return {
    appuser_key: appUser.appuserKey.toString(),
    locale: appUser.language,
    method,
    ...extraProperties,
  };
}

function isDemoAccount(appuser: Appuser) {
  return appuser.accountType === AppuserAccountType.DEMO;
}

function sendAuthCallbackSuccess(res: Response, appuserKey: number, method: string, outcome: 'demo' | 'login' | 'signup') {
  return res.status(200).json({ appuserKey, method, outcome });
}
