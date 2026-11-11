import type { Request, Response } from 'express';
import { z } from 'zod';

import { zParse } from '@app/validators/parser';
import { authedUser } from '@middleware/authed-context';
import {
  claimPairingCode,
  createPairingCode,
  listMobileDevices,
  revokeMobileDevice,
} from '@service/auth/mobile-pairing.service';
import { BACKEND_URL } from '@utils/constants';
import { ERROR_CODE, NotFoundError } from '@utils/errors';

const pairSchema = z.object({
  body: z.object({
    // 43 base64url characters for a real code; the bounds only stop oversized junk.
    code: z.string().trim().min(16).max(128),
  }),
});

const deviceParamsSchema = z.object({
  params: z.object({ sessionId: z.string().trim().min(1).max(64) }),
});

/**
 * `POST /v1/user/pairing-codes` — mint a single-use code for the QR.
 *
 * Behind `requireSensitiveSession`: a fresh web session, plus TOTP when the account has it.
 * That is what lets the phone skip the second factor — the person proved it here, on a
 * keyboard, before the QR existed.
 */
export async function createPairingCodeController(req: Request, res: Response) {
  const user = authedUser(req);
  const pairingCode = await createPairingCode({ appuser: user, serverUrl: BACKEND_URL });
  return res.status(201).json({
    pairingCode: {
      code: pairingCode.code,
      expiresAt: pairingCode.expiresAt,
      url: pairingCode.url,
    },
  });
}

/** `POST /v1/auth/pair` — public. Exchange a code for a new mobile session. */
export async function pairDevice(req: Request, res: Response) {
  const { body } = await zParse(pairSchema, req);
  const result = await claimPairingCode({
    code: body.code,
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  });
  if (result.status === 'invalid') {
    throw new NotFoundError('That pairing code is not valid. Show a new QR code and try again.', ERROR_CODE.PAIRING_CODE_INVALID);
  }

  return res.status(201).json({
    device: result.device,
    session: {
      cookieName: result.session.cookieName,
      cookieValue: result.session.cookieValue,
      expiresAt: result.session.expiresAt,
    },
  });
}

/** `GET /v1/user/devices` — the person's paired phones, newest first. */
export async function listDevices(req: Request, res: Response) {
  const user = authedUser(req);
  const devices = await listMobileDevices(user);
  return res.json({ devices });
}

/** `DELETE /v1/user/devices/:sessionId` — revoke one; its session stops working immediately. */
export async function revokeDevice(req: Request, res: Response) {
  const {
    params: { sessionId },
  } = await zParse(deviceParamsSchema, req);
  const user = authedUser(req);
  await revokeMobileDevice(user, sessionId);
  return res.sendStatus(204);
}
