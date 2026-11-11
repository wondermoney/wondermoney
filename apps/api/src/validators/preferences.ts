import { z } from 'zod';

/**
 * One home section in the stored `dashboardLayout`: its id and whether the
 * person hid it. Ids are validated as strings rather than against this
 * release's section list, so a layout written by a newer client survives an
 * older server; `mergeDashboardLayout` in `@wondermoney/shared/dashboard-layout`
 * drops ids it cannot render and appends sections the saved layout predates.
 */
export const dashboardLayoutEntrySchema = z.object({
  hidden: z.boolean(),
  id: z.string().trim().min(1).max(64),
});

/**
 * The stored layout is a list, not a map, because order is the point. Duplicate
 * ids are deduplicated deterministically (the first entry wins) instead of
 * rejected: a client that sends the same section twice still gets a usable
 * document, and the stored order stays the one the person saw.
 */
export const dashboardLayoutSchema = z
  .array(dashboardLayoutEntrySchema)
  .max(64)
  .transform((entries) => {
    const seen = new Set<string>();
    return entries.filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    });
  });

/**
 * The per-user preferences document stored on `appuser.preferences`.
 *
 * A JSON document rather than one column per setting: a new preference is a
 * schema change here, not a migration. It is validated on every read and write,
 * so a value written by an older release (or a hand-edited row) can never reach
 * a caller with the wrong type, and unknown keys are dropped on write.
 *
 * `previewFeatures` gates features that are shipped but not ready for everyone;
 * see `middleware/preview-features.ts`. `dashboardLayout` is the home sections'
 * order and visibility, shared by web and mobile. An empty layout means the
 * default order, so sections added later reach everyone without a migration.
 * `aiHidden` turns every AI feature off for this person, whatever the instance
 * has configured; see `services/ai/ai-availability.ts`.
 */
export const userPreferencesSchema = z.object({
  aiHidden: z.boolean().default(false),
  dashboardLayout: dashboardLayoutSchema.default([]),
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
      aiHidden: z.boolean().optional(),
      dashboardLayout: dashboardLayoutSchema.optional(),
      previewFeatures: z.boolean().optional(),
    })
    .refine((value) => Object.keys(value).length > 0, 'At least one preference is required'),
});
