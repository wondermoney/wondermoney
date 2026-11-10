import type { NextFunction, Request, Response } from 'express';

import { authedUser } from '@middleware/authed-context';
import { NotFoundError } from '@utils/errors';
import { userPreferencesSchema } from '@validators/preferences';

/**
 * Gate a route on the caller's `previewFeatures` preference.
 *
 * Mount it after `getUser` (inside `authedTenant`), on the route that serves the
 * preview feature. A user without the flag gets the same 404 as a route that
 * does not exist, so a preview feature is not discoverable from the API surface.
 * The web and mobile clients hide their entry points with `usePreviewFeatures`
 * / `<PreviewGate>`; this is the server-side half of the same gate.
 *
 * A malformed stored document fails closed (404) rather than 500: the feature is
 * simply not available to that user.
 */
export function requirePreviewFeatures(req: Request, _res: Response, next: NextFunction): void {
  const preferences = userPreferencesSchema.safeParse(authedUser(req).preferences);
  if (!preferences.success || !preferences.data.previewFeatures) {
    throw new NotFoundError('Not found');
  }
  next();
}
