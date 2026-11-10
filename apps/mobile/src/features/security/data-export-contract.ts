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
})

export type DataExport = z.infer<typeof dataExportSchema>

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
