import { z } from 'zod';

import { EXPORT_PASSWORD_MAX_LENGTH } from '@service/data-export/export-format';
import { RESTORE_LIMITS } from '@service/data-restore/restore-format';

export const dataRestoreRequestSchema = z.object({
  params: z.object({ restoreId: z.string().min(1).max(255) }),
});

/** `POST /v1/user/me/restores`: the size of the file to upload, which the upload link is signed for. */
export const startDataRestoreSchema = z.object({
  body: z.object({
    size: z.number({ error: 'size must be the file size in bytes' }).int().min(1).max(RESTORE_LIMITS.maxArchiveBytes, { error: `The file must be at most ${RESTORE_LIMITS.maxArchiveBytes} bytes` }),
  }),
});

/**
 * `POST /v1/user/me/restores/:restoreId/validate`. The password of a protected export: any length
 * an export ever accepted, so no minimum. The messages never echo the value.
 */
export const validateDataRestoreSchema = z.object({
  body: z
    .object({
      password: z
        .string({ error: 'password must be a string' })
        .min(1, { error: 'password must not be empty' })
        .max(EXPORT_PASSWORD_MAX_LENGTH * 4, { error: 'password is too long' })
        .optional(),
    })
    .optional(),
  params: z.object({ restoreId: z.string().min(1).max(255) }),
});
