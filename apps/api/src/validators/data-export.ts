import { z } from 'zod';

import { EXPORT_PASSWORD_MAX_LENGTH, EXPORT_PASSWORD_MIN_LENGTH } from '@service/data-export/export-format';

export const dataExportRequestSchema = z.object({
  params: z.object({ exportId: z.string().min(1).max(255) }),
});

// Characters as Unicode code points: "é" is one, though it is two bytes in UTF-8. Code points
// rather than graphemes on purpose: every code point is at least one byte of key material, and
// web counts the same way.
// eslint-disable-next-line @typescript-eslint/no-misused-spread -- code points are the intended unit
const characters = (value: string) => [...value].length;

/**
 * `POST /v1/user/me/exports`. An optional password protects the archive. The messages never
 * echo the value: they end up in the response and the request log.
 */
export const startDataExportSchema = z.object({
  body: z
    .object({
      password: z
        .string({ error: 'password must be a string' })
        .refine((value) => characters(value) >= EXPORT_PASSWORD_MIN_LENGTH, { error: `password must be at least ${EXPORT_PASSWORD_MIN_LENGTH} characters` })
        .refine((value) => characters(value) <= EXPORT_PASSWORD_MAX_LENGTH, { error: `password must be at most ${EXPORT_PASSWORD_MAX_LENGTH} characters` })
        .optional(),
    })
    .optional(),
});
