import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScrollView, StyleSheet, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { FormBar } from '@/components/ui/form-bar'
import { FormGroup, FormSelectRow, FormSwitchRow, FormTextRow } from '@/components/ui/form-row'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { type CreateGroupDraft, GROUP_NAME_MAX, MAX_GROUP_PEOPLE, MEMBER_NAME_MAX } from './expense-groups-contract'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type PersonLine = Readonly<{ id: number; name: string; email: string }>

export type ExpenseGroupCreateScreenProps = Readonly<{
  /** Currency codes to choose from (the API's currency list). */
  currencies: readonly string[]
  defaultCurrency: string | null
  /** The household's other members, who join as themselves. */
  candidates: readonly Readonly<{ appuserKey: number; name: string }>[]
  pending: boolean
  error: string | null
  onSubmit: (draft: CreateGroupDraft) => void
  onClose: () => void
}>

/**
 * "New group": a name, the currency settlements default to, and the people. The reader joins on
 * their own; other household members join as themselves, and anyone else by name, with an email
 * kept only for reference (nothing is ever sent to it).
 */
export function ExpenseGroupCreateScreen({ currencies, defaultCurrency, candidates, pending, error, onSubmit, onClose }: ExpenseGroupCreateScreenProps) {
  const { t } = useTranslation()
  const palette = usePalette()
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState<string | null>(defaultCurrency)
  const [household, setHousehold] = useState<readonly number[]>([])
  const [people, setPeople] = useState<readonly PersonLine[]>([])
  const [nextId, setNextId] = useState(1)
  const [touched, setTouched] = useState(false)

  const nameMissing = name.trim() === ''
  const personErrors = people.map((person) => ({
    name: person.name.trim() === '' ? t('expenseGroups.create.personNameRequired') : null,
    email: person.email.trim() !== '' && !EMAIL.test(person.email.trim()) ? t('expenseGroups.create.emailInvalid') : null,
  }))
  const tooMany = household.length + people.length > MAX_GROUP_PEOPLE
  const valid = !nameMissing && currency !== null && !tooMany && personErrors.every((errors) => !errors.name && !errors.email)
  const currencyOptions = [...new Set([...(defaultCurrency ? [defaultCurrency] : []), ...currencies])].map((code) => ({ value: code, label: code }))

  const submit = () => {
    setTouched(true)
    if (!valid || currency === null || pending) return
    onSubmit({
      name,
      currencyCode: currency,
      householdMemberIds: household,
      people: people.map((person) => ({ name: person.name, email: person.email })),
    })
  }
  const updatePerson = (id: number, change: Partial<Omit<PersonLine, 'id'>>) => setPeople((current) => current.map((person) => (person.id === id ? { ...person, ...change } : person)))

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <FormBar
        closeDisabled={pending}
        closeLabel={t('expenseGroups.create.close')}
        onClose={onClose}
        onSave={submit}
        saveDisabled={!valid || pending}
        saveLabel={t('expenseGroups.create.save')}
        saving={pending}
        testID="expense-group-create"
        title={t('expenseGroups.create.title')}
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <FormGroup>
          <FormTextRow
            editable={!pending}
            error={touched && nameMissing ? t('expenseGroups.create.nameRequired') : null}
            label={t('expenseGroups.create.name')}
            maxLength={GROUP_NAME_MAX}
            onChangeText={setName}
            placeholder={t('expenseGroups.create.namePlaceholder')}
            value={name}
          />
          <FormSelectRow
            disabled={pending}
            hint={t('expenseGroups.create.currencyHint')}
            label={t('expenseGroups.create.currency')}
            onChange={setCurrency}
            options={currencyOptions}
            placeholder={t('expenseGroups.create.choose')}
            value={currency}
          />
        </FormGroup>

        {candidates.length > 0 ? (
          <View style={styles.section}>
            <Text accessibilityRole="header" variant="metaStrong">{t('expenseGroups.create.household')}</Text>
            <FormGroup>
              {candidates.map((candidate) => (
                <FormSwitchRow
                  disabled={pending}
                  key={candidate.appuserKey}
                  label={candidate.name}
                  onValueChange={(on) => setHousehold((current) => (on ? [...current, candidate.appuserKey] : current.filter((key) => key !== candidate.appuserKey)))}
                  value={household.includes(candidate.appuserKey)}
                />
              ))}
            </FormGroup>
            <Text tone="muted" variant="label">{t('expenseGroups.create.householdHint')}</Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text accessibilityRole="header" variant="metaStrong">{t('expenseGroups.create.people')}</Text>
          <Text tone="muted" variant="meta">{t('expenseGroups.create.peopleHint')}</Text>
          {people.map((person, index) => (
            <View key={person.id} style={styles.person}>
              <FormGroup>
                <FormTextRow
                  accessibilityLabel={t('expenseGroups.create.personNameNumbered', { number: index + 1 })}
                  editable={!pending}
                  error={touched ? personErrors[index]?.name : null}
                  label={t('expenseGroups.create.personName')}
                  maxLength={MEMBER_NAME_MAX}
                  onChangeText={(value) => updatePerson(person.id, { name: value })}
                  value={person.name}
                />
                <FormTextRow
                  accessibilityLabel={t('expenseGroups.create.personEmailNumbered', { number: index + 1 })}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!pending}
                  error={personErrors[index]?.email}
                  keyboardType="email-address"
                  label={t('expenseGroups.create.personEmail')}
                  onChangeText={(value) => updatePerson(person.id, { email: value })}
                  value={person.email}
                />
              </FormGroup>
              <Button
                accessibilityLabel={t('expenseGroups.create.removePerson', { name: person.name.trim() || String(index + 1) })}
                disabled={pending}
                icon="trash"
                label={t('expenseGroups.create.remove')}
                onPress={() => setPeople((current) => current.filter((line) => line.id !== person.id))}
                size="sm"
                variant="ghost"
              />
            </View>
          ))}
          <Button
            disabled={pending || tooMany}
            icon="plus"
            label={t('expenseGroups.addPerson')}
            onPress={() => { setPeople((current) => [...current, { id: nextId, name: '', email: '' }]); setNextId((id) => id + 1) }}
            size="sm"
            style={styles.hug}
            variant="secondary"
          />
        </View>

        {error ? <Text accessibilityRole="alert" tone="destructive" variant="meta">{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[12], gap: themeTokens.spacing[6], width: '100%', maxWidth: 760, alignSelf: 'center' },
  section: { gap: themeTokens.spacing[3] },
  person: { gap: themeTokens.spacing[1], alignItems: 'stretch' },
  hug: { alignSelf: 'flex-start' },
})
