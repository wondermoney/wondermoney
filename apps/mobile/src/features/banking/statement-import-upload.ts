import { File, UploadType } from 'expo-file-system'

/**
 * Puts the raw file bytes to a presigned URL (S3 PUT), the same upload
 * mechanics as portfolio-import-upload.ts's uploadPortfolioImportFile —
 * duplicated rather than imported cross-feature so `banking` stays
 * self-contained (matching how this codebase keeps each feature folder's
 * contract/hook/upload trio independent). Isolated in its own module so
 * tests can mock it without touching the native File System.
 */
export async function uploadStatementImportFile(fileUri: string, uploadUrl: string, uploadHeaders: Readonly<Record<string, string>>): Promise<void> {
  const result = await new File(fileUri).upload(uploadUrl, {
    httpMethod: 'PUT',
    uploadType: UploadType.BINARY_CONTENT,
    headers: uploadHeaders,
  })
  if (result.status < 200 || result.status >= 300) throw new Error(`Statement import upload failed with status ${result.status}`)
}
