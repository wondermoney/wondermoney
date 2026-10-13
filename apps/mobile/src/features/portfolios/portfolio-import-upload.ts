import { File, UploadType } from 'expo-file-system'

/**
 * Puts the raw file bytes to a presigned URL (S3 PUT, matching web's upload mechanics —
 * core/api never returns `uploadFields`, only a `uploadHeaders`/`uploadMethod: 'PUT'` pair).
 * Isolated in its own module so tests can mock it without touching the native File System.
 */
export async function uploadPortfolioImportFile(fileUri: string, uploadUrl: string, uploadHeaders: Readonly<Record<string, string>>): Promise<void> {
  const result = await new File(fileUri).upload(uploadUrl, {
    httpMethod: 'PUT',
    uploadType: UploadType.BINARY_CONTENT,
    headers: uploadHeaders,
  })
  if (result.status < 200 || result.status >= 300) throw new Error(`Portfolio import upload failed with status ${result.status}`)
}
