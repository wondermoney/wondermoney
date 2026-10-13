import { File, UploadType } from 'expo-file-system'

/**
 * Puts the raw file bytes to a presigned URL (S3 PUT, matching web's upload mechanics — web sets
 * an explicit `Content-Type: text/csv` header on the PUT). Isolated in its own module, mirroring
 * portfolio-import-upload.ts, so tests can mock it without touching the native File System.
 */
export async function uploadTransactionImportFile(fileUri: string, uploadUrl: string): Promise<void> {
  const result = await new File(fileUri).upload(uploadUrl, {
    httpMethod: 'PUT',
    uploadType: UploadType.BINARY_CONTENT,
    headers: { 'Content-Type': 'text/csv' },
  })
  if (result.status < 200 || result.status >= 300) throw new Error(`Transaction import upload failed with status ${result.status}`)
}
