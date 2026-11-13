import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { FORM_ROW_HEIGHT, FormGroup, FormRowNote, FormSelectRow, FormSwitchRow } from '@/components/ui/form-row'
import { Notice } from '@/components/ui/notice'
import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'

import {
  buildAccountSharesWrite,
  shareableMembers,
  shareChoicesFor,
  type AccountShareMemberDto,
  type AccountSharesDto,
  type ShareChoice,
  type ShareChoices,
} from './account-sharing-contract'

/** The sharing the edit screen shows. `unsupported`: an older API, where the private switch stays. */
export type AccountSharingViewState =
  | { status: 'loading' | 'error' | 'unsupported' }
  | { status: 'loaded'; shares: AccountSharesDto }

type Props = Readonly<{
  shares: AccountSharesDto
  choices: ShareChoices
  /** The plain private toggle, for a household with nobody else in it. */
  privateToggle: boolean
  onChange: (appuserKey: number, choice: ShareChoice) => void
  onPrivateToggle: (value: boolean) => void
  disabled: boolean
}>

export const memberName = (member: Pick<AccountShareMemberDto, 'firstName' | 'lastName'>): string | null => (
  [member.firstName?.trim(), member.lastName?.trim()].filter(Boolean).join(' ') || null
)

/**
 * Who sees the account, per household member: the account owner as "Owner", everyone else
 * Hidden, Can view or Can edit (a household viewer only Hidden or Can view). Only the account
 * owner or the household owner can change it (`canManage`); anyone else reads the same list. A
 * household with nobody else keeps the plain private switch.
 */
export function AccountSharingSection({ shares, choices, privateToggle, onChange, onPrivateToggle, disabled }: Props) {
  const { t } = useTranslation()
  const others = shareableMembers(shares)
  const owner = shares.members.find((member) => member.isAccountOwner) ?? null
  const choiceLabel = (choice: ShareChoice) => t(`accountEdit.sharing.choices.${choice}`)
  const nameOf = (member: AccountShareMemberDto) => memberName(member) ?? t('accountEdit.sharing.unnamedMember')
  const sharedWithHousehold = !buildAccountSharesWrite(shares, choices, privateToggle).isPrivate

  return (
    <View style={styles.section} testID="account-sharing">
      <Text accessibilityRole="header" variant="heading">{t('accountEdit.sharing.title')}</Text>
      <Text tone="muted" variant="meta">{shares.canManage ? t('accountEdit.sharing.helper') : t('accountEdit.sharing.readOnlyHelper')}</Text>
      {others.length === 0 ? (
        <>
          <FormGroup>
            {owner ? <StaticRow key="owner" label={nameOf(owner)} value={t('accountEdit.sharing.owner')} /> : null}
            <FormSwitchRow
              key="private"
              accessibilityLabel={t('accountEdit.privacySwitch')}
              disabled={disabled || !shares.canManage}
              hint={t('accountEdit.privacyHelper')}
              label={t('accountEdit.privacyTitle')}
              onValueChange={onPrivateToggle}
              value={privateToggle}
            />
          </FormGroup>
          <Text tone="muted" variant="label">{t('accountEdit.sharing.alone')}</Text>
        </>
      ) : (
        <>
          <FormGroup>
            {owner ? <StaticRow key={`owner-${owner.appuserKey}`} label={nameOf(owner)} value={t('accountEdit.sharing.owner')} /> : null}
            {others.map((member) => {
              const choice = choices[member.appuserKey] ?? 'hidden'
              const hint = member.role === 'viewer' ? t('accountEdit.sharing.viewerHint') : null
              return shares.canManage ? (
                <FormSelectRow
                  key={`member-${member.appuserKey}`}
                  accessibilityLabel={t('accountEdit.sharing.memberAccess', { name: nameOf(member) })}
                  disabled={disabled}
                  hint={hint}
                  label={nameOf(member)}
                  onChange={(next) => onChange(member.appuserKey, next)}
                  options={shareChoicesFor(member).map((value) => ({ value, label: choiceLabel(value) }))}
                  placeholder={choiceLabel('hidden')}
                  testID={`account-sharing-member-${member.appuserKey}`}
                  value={choice}
                />
              ) : (
                <StaticRow key={`member-${member.appuserKey}`} hint={hint} label={nameOf(member)} value={choiceLabel(choice)} />
              )
            })}
          </FormGroup>
          <Text tone="muted" testID="account-sharing-later" variant="label">
            {sharedWithHousehold ? t('accountEdit.sharing.laterShared') : t('accountEdit.sharing.laterPrivate')}
          </Text>
        </>
      )}
    </View>
  )
}

/** The section while the sharing loads or failed; the rest of the form stays usable. */
export function AccountSharingPlaceholder({ status, onRetry }: { status: 'loading' | 'error'; onRetry?: () => void }) {
  const { t } = useTranslation()
  return (
    <View style={styles.section} testID="account-sharing">
      <Text accessibilityRole="header" variant="heading">{t('accountEdit.sharing.title')}</Text>
      {status === 'loading'
        ? <Text tone="muted" variant="meta">{t('accountEdit.sharing.loading')}</Text>
        : <Notice action={onRetry ? <Button label={t('common.retry')} onPress={onRetry} size="sm" variant="outline" /> : undefined} message={t('accountEdit.sharing.error')} />}
    </View>
  )
}

/** A form row that only reads: the member on the left, their access on the right. */
function StaticRow({ label, value, hint }: { label: string; value: string; hint?: string | null }) {
  return (
    <View accessibilityLabel={`${label}, ${value}`} accessible>
      <View style={styles.row}>
        <Text style={styles.label} variant="body">{label}</Text>
        <Text numberOfLines={1} style={styles.value} tone="muted" variant="body">{value}</Text>
      </View>
      {hint ? <FormRowNote>{hint}</FormRowNote> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { gap: themeTokens.spacing[2] },
  row: {
    minHeight: FORM_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: themeTokens.spacing[4],
    paddingHorizontal: themeTokens.spacing[4],
    paddingVertical: themeTokens.spacing[2],
  },
  label: { flexShrink: 0, maxWidth: '66%' },
  value: { flex: 1, minWidth: 0, textAlign: 'right' },
})
