import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Sheet } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { FormNotice, TextField } from '@/features/transactions/form-field'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { TagDot } from './tag-chip'
import { MAX_TAGS_PER_TRANSACTION, sameTagName, TAG_NAME_MAX_LENGTH, type TagDto } from './tags-contract'

export type TagsState =
  | Readonly<{ status: 'loading' | 'error' }>
  | Readonly<{ status: 'loaded'; tags: readonly TagDto[] }>

/** What creating a tag came to: the tag (new, or the one that already had the name) or a failure notice. */
export type CreateTagOutcome = Readonly<{ tag: TagDto }> | Readonly<{ error: string }>

type Props = Readonly<{
  title: string
  tags: TagsState
  initial: readonly number[]
  pending?: boolean
  /** A notice from the last save (an error); shown above the footer. */
  notice?: string | null
  saveLabel: string
  onSave: (tagIds: readonly number[]) => void
  onCreate: (name: string) => Promise<CreateTagOutcome>
  onClose: () => void
}>

/**
 * Pick a transaction's tags (web's `TagPicker` at phone width): a checkbox row
 * per household tag and a field to create one inline. Mount it only while open;
 * the selection is a draft until Save.
 */
export function TagPickerSheet({ title, tags, initial, pending = false, notice = null, saveLabel, onSave, onCreate, onClose }: Props) {
  const { t } = useTranslation()
  const palette = usePalette()
  const [selected, setSelected] = useState<readonly number[]>(initial)
  const [created, setCreated] = useState<readonly TagDto[]>([])
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const loaded = tags.status === 'loaded'
    ? [...tags.tags, ...created.filter((tag) => !tags.tags.some((known) => known.tagKey === tag.tagKey))]
    : created
  const atLimit = selected.length >= MAX_TAGS_PER_TRANSACTION
  const trimmed = name.trim()
  const existing = loaded.find((tag) => sameTagName(tag.name, trimmed))
  const busy = pending || creating

  const toggle = (tagKey: number) => {
    setSelected((current) => current.includes(tagKey)
      ? current.filter((key) => key !== tagKey)
      : current.length >= MAX_TAGS_PER_TRANSACTION ? current : [...current, tagKey])
  }
  const select = (tag: TagDto) => setSelected((current) => current.includes(tag.tagKey) || current.length >= MAX_TAGS_PER_TRANSACTION ? current : [...current, tag.tagKey])

  const create = async () => {
    if (!trimmed || busy) return
    setCreateError(null)
    // A name already on the list selects that tag instead of making a twin.
    if (existing) { select(existing); setName(''); return }
    setCreating(true)
    try {
      const outcome = await onCreate(trimmed)
      if ('tag' in outcome) {
        setCreated((current) => [...current, outcome.tag])
        select(outcome.tag)
        setName('')
      } else {
        setCreateError(outcome.error)
      }
    } finally {
      setCreating(false)
    }
  }

  return (
    <Sheet
      closeLabel={t('tags.close')}
      footer={(
        <View style={styles.footer}>
          {notice ? <FormNotice tone="destructive">{notice}</FormNotice> : null}
          <Button block disabled={busy || tags.status !== 'loaded'} label={pending ? t('tags.saving') : saveLabel} onPress={() => onSave(selected)} />
        </View>
      )}
      onClose={onClose}
      title={title}
      visible
    >
      {tags.status === 'loading' ? <Text accessibilityRole="progressbar" tone="muted" variant="meta">{t('tags.loading')}</Text> : null}
      {tags.status === 'error' ? <Text accessibilityRole="alert" tone="muted" variant="meta">{t('tags.unavailable')}</Text> : null}
      {tags.status === 'loaded' ? (
        <View>
          {loaded.length === 0 ? <Text tone="muted" variant="meta">{t('tags.empty')}</Text> : null}
          {loaded.map((tag, index) => {
            const checked = selected.includes(tag.tagKey)
            const disabled = busy || (!checked && atLimit)
            return (
              <Pressable
                accessibilityLabel={tag.name}
                accessibilityRole="checkbox"
                accessibilityState={{ checked, disabled }}
                disabled={disabled}
                key={tag.tagKey}
                onPress={() => toggle(tag.tagKey)}
                style={({ pressed }) => [styles.option, index > 0 && { borderTopWidth: 1, borderTopColor: palette.border }, pressed && { backgroundColor: palette.muted }, disabled && styles.dimmed]}
              >
                <TagDot color={tag.color} />
                <Text style={styles.flex} variant="body">{tag.name}</Text>
                {checked ? <Icon color={palette.primary} name="check" size={16} /> : null}
              </Pressable>
            )
          })}
          {atLimit ? <Text tone="muted" variant="label">{t('tags.limit', { max: MAX_TAGS_PER_TRANSACTION })}</Text> : null}
          <View style={[styles.create, { borderTopColor: palette.border }]}>
            <TextField
              editable={!busy}
              label={t('tags.newTag')}
              maxLength={TAG_NAME_MAX_LENGTH}
              onChangeText={(value) => { setName(value); setCreateError(null) }}
              onSubmitEditing={() => void create()}
              placeholder={t('tags.newTagPlaceholder')}
              returnKeyType="done"
              value={name}
            />
            {createError ? <FormNotice tone="destructive">{createError}</FormNotice> : null}
            <View style={styles.createAction}>
              <Button
                disabled={busy || !trimmed || atLimit}
                icon="plus"
                label={existing ? t('tags.selectExisting', { name: existing.name }) : t('tags.create', { name: trimmed || '…' })}
                onPress={() => void create()}
                size="sm"
                variant="secondary"
              />
            </View>
          </View>
        </View>
      ) : null}
    </Sheet>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  footer: { gap: themeTokens.spacing[2] },
  option: { minHeight: themeTokens.touchTarget.minimum, flexDirection: 'row', alignItems: 'center', gap: themeTokens.spacing[3], paddingVertical: themeTokens.spacing[2] },
  create: { borderTopWidth: 1, marginTop: themeTokens.spacing[2], paddingTop: themeTokens.spacing[3], gap: themeTokens.spacing[2] },
  createAction: { alignItems: 'flex-start' },
  dimmed: { opacity: 0.5 },
})
