import type { Request, Response } from 'express';

import { zParse } from '@app/validators/parser';
import { sendSupportEmail } from '@service/email/email';
import { supportInbox } from '@service/email/email-transport';
import { BadGatewayError, FeatureDisabledError } from '@utils/errors';
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
 *
 * It answers 200 only once the email provider has accepted the message. A rejected, unknown or
 * intercepted send is a 502, so the form never tells the visitor their message was sent when it
 * went nowhere.
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

  const outcome = await sendSupportEmail({ email, message, name });
  if (outcome.type !== 'accepted') throw new BadGatewayError(`Support message was not delivered (${outcome.type})`);
  return res.sendStatus(200);
}
