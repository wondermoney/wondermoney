import { z } from 'zod';

/**
 * The per-user preferences document stored on `appuser.preferences`.
 *
 * A JSON document rather than one column per setting: a new preference is a
 * schema change here, not a migration. It is validated on every read and write,
 * so a value written by an older release (or a hand-edited row) can never reach
 * a caller with the wrong type, and unknown keys are dropped on write.
 *
 * `previewFeatures` is the first key. It gates features that are shipped but not
 * ready for everyone; see `middleware/preview-features.ts`.
 */
export const userPreferencesSchema = z.object({
  previewFeatures: z.boolean().default(false),
});

export type UserPreferences = z.infer<typeof userPreferencesSchema>;

/**
 * `PATCH /v1/user/me/preferences` takes a partial document. Unknown keys are
 * stripped by the object schema (so a newer client can send a key this server
 * does not know yet without breaking the request), and a patch that leaves no
 * known key is refused rather than silently doing nothing.
 */
export const patchUserPreferencesSchema = z.object({
  body: z
    .object({
      previewFeatures: z.boolean().optional(),
    })
    .refine((value) => Object.keys(value).length > 0, 'At least one preference is required'),
});
