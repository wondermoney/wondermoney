import { z } from 'zod'

import { readEndpoint, tolerantEnum, writeEndpoint } from '@/lib/api/runtime-schema'

/**
 * Full data export (`/v1/user/me/exports`): a zip of everything the signed-in member can see.
 *
 * On a server with file storage a background job prepares the file and, once `status` is
 * `ready`, the export carries a short-lived `downloadUrl` that needs no sign-in. On a server
 * without storage (`delivery: 'stream'`) the zip is built while it downloads from the web app;
 * the app does not start those.
 */
const dataExportSchema = z.object({
  id: z.string(),
  status: tolerantEnum(['queued', 'running', 'ready', 'failed', 'expired'], 'failed'),
  delivery: tolerantEnum(['storage', 'stream'], 'stream'),
  downloadUrl: z.string().nullable(),
  expiresAt: z.string().nullable(),
  fileName: z.string(),
  /** Whether the archive is password protected (a WinZip AES-256 zip). Older servers omit it. */
  encrypted: z.boolean().optional(),
})

export type DataExport = z.infer<typeof dataExportSchema>

/**
 * The password limits the API enforces (`EXPORT_PASSWORD_MIN_LENGTH` / `_MAX_LENGTH`), in
 * characters as it counts them: Unicode code points, so "é" is one.
 */
export const DATA_EXPORT_PASSWORD_MIN_LENGTH = 16
export const DATA_EXPORT_PASSWORD_MAX_LENGTH = 256

export function dataExportPasswordLength(password: string): number {
  return [...password].length
}

export type DataExportPasswordProblem = 'too-short' | 'mismatch'

/** What is wrong with a password and its confirmation before it is sent, or null when nothing is. */
export function dataExportPasswordProblem(password: string, confirmation: string): DataExportPasswordProblem | null {
  if (dataExportPasswordLength(password) < DATA_EXPORT_PASSWORD_MIN_LENGTH) return 'too-short'
  return password === confirmation ? null : 'mismatch'
}

/** The request body: a password only when the member asked for one, never an empty string. */
export function startDataExportBody(password: string | undefined): { password?: string } {
  return password === undefined ? {} : { password }
}

export const startDataExportEndpoint = writeEndpoint({
  method: 'POST',
  path: '/v1/user/me/exports',
  schema: z.object({ export: dataExportSchema }),
  successStatuses: [200, 202],
})

export const listDataExportsEndpoint = readEndpoint({
  method: 'GET',
  path: '/v1/user/me/exports',
  schema: z.object({ exports: z.array(dataExportSchema) }),
})
