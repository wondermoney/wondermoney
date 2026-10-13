import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'

/**
 * Writes already-fetched CSV text to a cache file and hands it to the OS share sheet. Isolated in
 * its own module (mirroring portfolio-import-upload.ts's isolation of raw native-module mechanics)
 * so tests can mock it without touching the real filesystem or share sheet.
 */
export async function shareReportCsv(csv: string, filename: string): Promise<void> {
  const available = await Sharing.isAvailableAsync()
  if (!available) throw new Error('Sharing is not available on this device.')

  const file = new File(Paths.cache, filename)
  if (file.exists) file.delete()
  file.create()
  file.write(csv)

  await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' })
}
