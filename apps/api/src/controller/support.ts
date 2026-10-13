import type { Request, Response } from 'express';

import { zParse } from '@app/validators/parser';
import { sendSupportEmail } from '@service/email/email';
import { supportInbox } from '@service/email/email-transport';
import { FeatureDisabledError } from '@utils/errors';
import { sendSupportEmailRequestSchema } from '@validators/support';

interface CaptchaData {
  challenge_ts: string;
  'error-codes': number;
  hostname: string;
  success: boolean;
}

/**
 * The public contact form. Delivers to `SUPPORT_EMAIL`, so without one it is disabled. With a
 * `RECAPTCHA_SECRET_KEY` the reCAPTCHA v3 token is required and verified; without one the form
 * relies on the route's rate limit alone.
 */
export async function processSupportEmail(req: Request, res: Response) {
  const {
    body: { captcha, email, message, name },
  } = await zParse(sendSupportEmailRequestSchema, req);

  if (!supportInbox()) throw new FeatureDisabledError('The contact form');

  const recaptchaSecret = process.env['RECAPTCHA_SECRET_KEY']?.trim();
  if (recaptchaSecret) {
    if (!captcha) return res.sendStatus(400);
    // Verify captcha v3 token using form-urlencoded format (required by Google)
    const params = new URLSearchParams();
    params.append('secret', recaptchaSecret);
    params.append('response', captcha);

    const data = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      body: params.toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      method: 'POST',
    }).then((res) => res.json() as Promise<CaptchaData>);

    if (!data.success) {
      return res.sendStatus(400);
    }
  }

  try {
    await sendSupportEmail({ email, message, name });
  } catch {
    return res.sendStatus(500);
  }
  return res.sendStatus(200);
}
