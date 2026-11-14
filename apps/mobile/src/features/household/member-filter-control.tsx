import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { OptionSheet } from '@/components/ui/sheet'
import { SelectField } from '@/features/transactions/select-field'

import {
  memberFilterLabel,
  memberFilterOptions,
  memberFilterToken,
  parseMemberFilterToken,
  type HouseholdMembersModel,
  type MemberFilter,
} from './member-attribution'

type Props = Readonly<{
  model: HouseholdMembersModel
  value: MemberFilter
  onChange: (value: MemberFilter) => void
  disabled?: boolean
}>

/**
 * The member filter as a compact button beside a screen's other controls ("Everyone ▾"): one
 * choice of everyone, a member, or Shared. Draws nothing in a household of one.
 */
export function MemberFilterButton({ model, value, onChange, disabled = false }: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  if (!model.multiMember) return null
  const label = memberFilterLabel(value, model, t)
  return (
    <>
      <Button
        accessibilityLabel={t('memberAttribution.filterNamed', { name: label })}
        disabled={disabled}
        icon="users"
        label={label}
        onPress={() => setOpen(true)}
        size="sm"
        testID="member-filter"
        variant="secondary"
      />
      <OptionSheet
        onClose={() => setOpen(false)}
        onSelect={(token: string) => { if (!disabled) onChange(parseMemberFilterToken(token)) }}
        options={memberFilterOptions(model, t)}
        testID="member-filter-sheet"
        title={t('memberAttribution.filterTitle')}
        value={memberFilterToken(value)}
        visible={open}
      />
    </>
  )
}

/** The same choice as a labelled field, for a filter sheet. Draws nothing in a household of one. */
export function MemberFilterField({ model, value, onChange, disabled = false }: Props) {
  const { t } = useTranslation()
  if (!model.multiMember) return null
  return (
    <SelectField<string>
      disabled={disabled}
      label={t('memberAttribution.filterTitle')}
      onChange={(token) => onChange(parseMemberFilterToken(token))}
      options={memberFilterOptions(model, t)}
      placeholder={t('memberAttribution.everyone')}
      testID="member-filter"
      value={memberFilterToken(value)}
    />
  )
}
