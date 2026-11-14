import * as DocumentPicker from 'expo-document-picker'
import { File } from 'expo-file-system'
import * as ImagePicker from 'expo-image-picker'

import {
  ATTACHMENT_MIME_TYPES,
  attachmentFileName,
  type PickedAttachment,
} from './transaction-attachments-contract'

/** The size of a picked file, from the filesystem when the picker did not report one. */
function sizeOf(uri: string, reported: number | undefined): number {
  if (typeof reported === 'number' && reported > 0) return reported
  try {
    return new File(uri).size ?? 0
  } catch {
    return 0
  }
}

/** A photo taken now, as an attachment. Null when the person cancels or denies the camera. */
export async function pickAttachmentFromCamera(): Promise<PickedAttachment | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync()
  if (!permission.granted) return null

  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 })
  const asset = result.canceled ? undefined : result.assets[0]
  if (!asset) return null

  const mimeType = asset.mimeType ?? 'image/jpeg'
  return {
    uri: asset.uri,
    name: attachmentFileName(asset.fileName ?? 'photo', mimeType, 'photo'),
    mimeType,
    sizeBytes: sizeOf(asset.uri, asset.fileSize),
  }
}

/** Files chosen from the device (a PDF invoice, an image already on the phone). */
export async function pickAttachmentsFromFiles(): Promise<PickedAttachment[]> {
  const result = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: true,
    type: [...ATTACHMENT_MIME_TYPES],
  })
  if (result.canceled) return []

  return result.assets.map((asset) => {
    const mimeType = asset.mimeType ?? 'application/octet-stream'
    return {
      uri: asset.uri,
      name: attachmentFileName(asset.name, mimeType),
      mimeType,
      sizeBytes: sizeOf(asset.uri, asset.size ?? undefined),
    }
  })
}
