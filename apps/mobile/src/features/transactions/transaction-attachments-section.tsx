import * as WebBrowser from 'expo-web-browser'
import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { Button as UiButton } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Text } from '@/components/ui/text'
import { useConfirmedFeature } from '@/lib/server/use-instance'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { pickAttachmentFromCamera, pickAttachmentsFromFiles } from './attachment-picker'
import { FormNotice } from './form-field'
import { TRANSACTION_ATTACHMENT_MAX_FILES, type PickedAttachment, type TransactionAttachmentDto } from './transaction-attachments-contract'
import {
  type AttachmentFailure,
  classifyAttachmentFailure,
  useDeleteTransactionAttachment,
  useTransactionAttachments,
  useUploadTransactionAttachment,
} from './use-transaction-attachments'

type Props = Readonly<{
  transactionId: number
  /** On an account the caller can only view (#95): the files open, nothing is added or deleted. */
  readOnly?: boolean
}>

function failureMessageKey(reason: AttachmentFailure): string {
  switch (reason) {
    case 'limit': return 'transactions.attachments.limit'
    case 'size': return 'transactions.attachments.size'
    case 'type': return 'transactions.attachments.type'
    case 'access': return 'transactions.attachments.access'
    case 'network': return 'transactions.attachments.network'
    default: return 'transactions.attachments.general'
  }
}

/**
 * The files kept with a transaction, inside its expanded row: take a photo, choose files, tap to
 * open, delete. Hidden on a server without file storage (`GET /v1/instance`).
 */
export function TransactionAttachmentsSection({ transactionId, readOnly = false }: Props) {
  const { t } = useTranslation()
  const palette = usePalette()
  const storageAvailable = useConfirmedFeature((features) => features.fileStorage)
  const attachments = useTransactionAttachments(transactionId, storageAvailable)
  const upload = useUploadTransactionAttachment(transactionId, attachments.data?.attachments.length ?? 0)
  const remove = useDeleteTransactionAttachment(transactionId)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<AttachmentFailure | null>(null)

  const add = useCallback(async (picked: PickedAttachment[]) => {
    if (picked.length === 0) return
    setFailure(null)
    setBusy(true)
    try {
      for (const file of picked) await upload.mutateAsync(file)
    } catch (error) {
      setFailure(classifyAttachmentFailure(error))
    } finally {
      setBusy(false)
    }
  }, [upload])

  const addFromCamera = useCallback(async () => {
    const picked = await pickAttachmentFromCamera()
    if (picked) await add([picked])
  }, [add])

  const addFromFiles = useCallback(async () => {
    await add(await pickAttachmentsFromFiles())
  }, [add])

  const removeAttachment = useCallback(async (attachment: TransactionAttachmentDto) => {
    setFailure(null)
    try {
      await remove.mutateAsync(attachment.transactionAttachmentKey)
    } catch (error) {
      setFailure(classifyAttachmentFailure(error))
    }
  }, [remove])

  if (!storageAvailable) return null
  // Nothing to show and nothing to add: a view-only row carries no empty section.
  if (readOnly && (attachments.data?.attachments.length ?? 0) === 0) return null

  const list = attachments.data?.attachments ?? []
  const atLimit = list.length >= TRANSACTION_ATTACHMENT_MAX_FILES

  return (
    <View style={styles.section}>
      <Text tone="muted" variant="label">{t('transactions.attachments.title')}</Text>
      {list.length === 0 ? (
        <Text tone="muted" variant="meta">{t('transactions.attachments.empty')}</Text>
      ) : (
        <View style={styles.list}>
          {list.map((attachment) => (
            <View key={attachment.transactionAttachmentKey} style={[styles.row, { borderTopColor: palette.border }]}>
              <Pressable
                accessibilityLabel={t('transactions.attachments.open', { name: attachment.fileName })}
                accessibilityRole="link"
                hitSlop={8}
                onPress={() => { void WebBrowser.openBrowserAsync(attachment.url) }}
                style={styles.open}
              >
                <Icon color={palette.mutedForeground} name={attachment.contentType === 'application/pdf' ? 'file-text' : 'paperclip'} size={16} />
                <Text numberOfLines={1} style={styles.name} variant="meta">{attachment.fileName}</Text>
              </Pressable>
              {readOnly ? null : (
                <Pressable
                  accessibilityLabel={t('transactions.attachments.delete', { name: attachment.fileName })}
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => { void removeAttachment(attachment) }}
                >
                  <Icon color={palette.mutedForeground} name="trash" size={16} />
                </Pressable>
              )}
            </View>
          ))}
        </View>
      )}
      {readOnly ? null : <View style={styles.actions}>
        <UiButton
          disabled={busy || atLimit}
          icon="camera"
          label={busy ? t('transactions.attachments.uploading') : t('transactions.attachments.addPhoto')}
          onPress={addFromCamera}
          size="sm"
          variant="secondary"
        />
        <UiButton
          disabled={busy || atLimit}
          icon="paperclip"
          label={t('transactions.attachments.chooseFiles')}
          onPress={addFromFiles}
          size="sm"
          variant="secondary"
        />
      </View>}
      {atLimit && !readOnly ? <Text tone="muted" variant="meta">{t('transactions.attachments.limit')}</Text> : null}
      {failure ? <FormNotice tone="destructive">{t(failureMessageKey(failure))}</FormNotice> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
  list: { gap: 0 },
  name: { flexShrink: 1 },
  open: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: themeTokens.spacing[2] },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: themeTokens.spacing[2],
    justifyContent: 'space-between',
    paddingVertical: themeTokens.spacing[2],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  section: { gap: themeTokens.spacing[2] },
})
