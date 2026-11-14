import type { TFunction } from 'i18next'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AccessibilityInfo, StyleSheet, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { FormGroup, FormSelectRow } from '@/components/ui/form-row'
import { Notice } from '@/components/ui/notice'
import { Sheet } from '@/components/ui/sheet'
import { linkRefusalMessage, PortfolioAccountLinkFields } from '@/features/portfolios/portfolio-account-link-fields'
import {
  linkInputFromDraft,
  NOT_LINKED_DRAFT,
  type LinkableAccount,
  type PortfolioAccountLinkDraft,
  type PortfolioAccountLinkInput,
} from '@/features/portfolios/portfolio-account-link'
import type { PortfolioLinkFailure } from '@/features/portfolios/use-portfolio-account-link'
import { themeTokens } from '@/theme/tokens'

/** What the "Is this the same money?" suggestion offers to link. */
export type PortfolioLinkSuggestionModel = Readonly<{
  /** The portfolios with no link this member can see. */
  portfolios: readonly Readonly<{ portfolioKey: number; name: string }>[]
  /** The accounts this member can see. */
  accounts: readonly LinkableAccount[]
}>

export type PortfolioLinkSaveResult =
  | Readonly<{ status: 'saved' }>
  | Readonly<{ status: 'failed'; failure: PortfolioLinkFailure; holder: string | null }>

/**
 * The suggestion is the API's call (`suggestPortfolioLink`): an investment account this member
 * can see that no portfolio is linked to, by either member, and a portfolio with no link. Amounts
 * are not compared. It shows only once the dismissal has been read, and never once dismissed.
 */
export function showsPortfolioLinkSuggestion(input: Readonly<{ suggested: boolean | undefined; dismissalLoaded: boolean; dismissed: boolean }>): boolean {
  return input.suggested === true && input.dismissalLoaded && !input.dismissed
}

function failureMessage(t: TFunction, failure: PortfolioLinkFailure, holder: string | null): string {
  return linkRefusalMessage(t, failure, holder) ?? t(`portfolioAccountLink.failures.${failure}`)
}

/**
 * Web's `PortfolioLinkSuggestion` at phone width: "Is this the same money?" at the top of the
 * balance sheet, with "Link a portfolio" (a sheet: the portfolio, the account that holds it, and
 * whether its balance includes the investments) and "Dismiss" (a year, on this device).
 */
export function PortfolioLinkSuggestion({ model, onDismiss, onSave }: {
  model: PortfolioLinkSuggestionModel
  onDismiss: () => void
  onSave: (portfolioId: number, accountLink: PortfolioAccountLinkInput) => Promise<PortfolioLinkSaveResult>
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [portfolioId, setPortfolioId] = useState<number | null>(null)
  const [link, setLink] = useState<PortfolioAccountLinkDraft>(NOT_LINKED_DRAFT)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<Extract<PortfolioLinkSaveResult, { status: 'failed' }> | null>(null)
  const accountLink = linkInputFromDraft(link)
  // A portfolio linked meanwhile leaves the list; the choice goes with it.
  const chosen = model.portfolios.some((portfolio) => portfolio.portfolioKey === portfolioId) ? portfolioId : null

  const close = () => {
    if (pending) return
    setOpen(false)
    setFailure(null)
  }

  const save = async () => {
    if (chosen === null || !accountLink || pending) return
    setPending(true)
    setFailure(null)
    try {
      const result = await onSave(chosen, accountLink)
      if (result.status === 'saved') {
        setOpen(false)
        setPortfolioId(null)
        setLink(NOT_LINKED_DRAFT)
        AccessibilityInfo.announceForAccessibility(t('portfolioAccountLink.saved'))
      } else setFailure(result)
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <Notice
        action={(
          <View style={styles.actions}>
            <Button label={t('portfolioAccountLink.suggestionLink')} onPress={() => setOpen(true)} size="sm" variant="outline" />
            <Button label={t('portfolioAccountLink.dismiss')} onPress={onDismiss} size="sm" variant="ghost" />
          </View>
        )}
        message={t('portfolioAccountLink.suggestionBody')}
        testID="home-portfolio-link-suggestion"
        title={t('portfolioAccountLink.suggestionTitle')}
      />
      <Sheet
        closeLabel={t('common.close')}
        footer={(
          <Button
            disabled={chosen === null || !accountLink || pending}
            label={pending ? t('portfolioAccountLink.saving') : t('portfolioAccountLink.save')}
            loading={pending}
            onPress={() => void save()}
          />
        )}
        onClose={close}
        testID="home-portfolio-link-sheet"
        title={t('portfolioAccountLink.dialogTitle')}
        visible={open}
      >
        <FormGroup>
          <FormSelectRow
            disabled={pending}
            label={t('portfolioAccountLink.portfolioLabel')}
            onChange={(next) => { setPortfolioId(next); setFailure(null) }}
            options={model.portfolios.map((portfolio) => ({ value: portfolio.portfolioKey, label: portfolio.name }))}
            placeholder={t('portfolioAccountLink.selectPortfolio')}
            value={chosen}
          />
        </FormGroup>
        <PortfolioAccountLinkFields accounts={model.accounts} disabled={pending} onChange={(next) => { setLink(next); setFailure(null) }} value={link} />
        {failure ? <Notice message={failureMessage(t, failure.failure, failure.holder)} testID="home-portfolio-link-failure" tone="destructive" /> : null}
      </Sheet>
    </>
  )
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
})
