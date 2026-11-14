import type { Request, Response } from 'express';
import { z } from 'zod';

import { DI } from '@app/database/di';
import { zParse } from '@app/validators/parser';
import { API_TOKEN_CREATABLE_SCOPES, ApiToken } from '@entity/ApiToken';
import { authedContext } from '@middleware/authed-context';
import { createApiToken, toApiTokenDto } from '@service/api-token/api-token.service';
import { NotFoundError } from '@utils/errors';
import { positiveIntId } from '@validators/shared';

const createApiTokenSchema = z.object({
  body: z.object({
    expiresInDays: z.union([z.literal(30), z.literal(90), z.literal(365)]),
    name: z.string().trim().min(1).max(80),
    scopes: z.array(z.enum(API_TOKEN_CREATABLE_SCOPES)).min(1).max(API_TOKEN_CREATABLE_SCOPES.length),
  }),
});

const apiTokenIdSchema = z.object({
  params: z.object({ id: positiveIntId }),
});

/** `GET /v1/user/api-tokens` — the signed-in member's tokens, newest first. */
export async function listApiTokens(req: Request, res: Response) {
  const { user } = authedContext(req);
  const tokens = await DI.em.find(
    ApiToken,
    { appuserKey: user, deletedAt: null },
    { orderBy: { createdAt: 'desc' } },
  );
  return res.json({ apiTokens: tokens.map(toApiTokenDto) });
}

/**
 * `POST /v1/user/api-tokens` — create a token and return the plain value exactly once.
 * Behind `requireSensitiveSession`: a fresh session, plus TOTP when the user has it enabled.
 */
export async function createApiTokenController(req: Request, res: Response) {
  const { body } = await zParse(createApiTokenSchema, req);
  const { tenant, user } = authedContext(req);
  // De-duplicate: `['read','read']` must not store a scope twice.
  const scopes = [...new Set(body.scopes)];
  const { apiToken, token } = await createApiToken({
    appuser: user,
    expiresInDays: body.expiresInDays,
    name: body.name,
    scopes,
    tenant,
  });
  return res.status(201).json({ apiToken: toApiTokenDto(apiToken), token });
}

/** `DELETE /v1/user/api-tokens/:id` — revoke immediately; the next request with it gets 401. */
export async function revokeApiToken(req: Request, res: Response) {
  const {
    params: { id },
  } = await zParse(apiTokenIdSchema, req);
  const { user } = authedContext(req);
  const apiToken = await DI.em.findOne(ApiToken, {
    apiTokenKey: id,
    appuserKey: user,
    deletedAt: null,
  });
  if (!apiToken) throw new NotFoundError('API token not found');
  if (!apiToken.revokedAt) {
    apiToken.revokedAt = new Date();
    await DI.em.flush();
  }
  return res.sendStatus(204);
}
