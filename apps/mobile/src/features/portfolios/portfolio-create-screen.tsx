import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BackHandler, ScrollView, StyleSheet, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { FormBar } from '@/components/ui/form-bar'
import { FormGroup, FormSelectRow, FormTextRow } from '@/components/ui/form-row'
import { Notice } from '@/components/ui/notice'
import { SafeAreaView } from '@/components/ui/screen-safe-area'
import { Text } from '@/components/ui/text'
import { themeTokens } from '@/theme/tokens'
import { usePalette } from '@/theme/use-palette'

import { PortfolioReviewList, PortfolioReviewRow } from './portfolio-form-parts'
import { portfolioCreateWriteSchema, type PortfolioCreateWrite, type PortfolioCurrencyDto } from './portfolios-contract'
import type { PortfolioCreateFailure } from './use-create-portfolio'

/**
 * Create a portfolio, as a calm-structure flow: the form bar (close, save),
 * then the name and currency as rows. The ✓ reviews first, and the ✓ on the
 * review creates the portfolio.
 */
export function PortfolioCreateScreen({ currencies, defaultCurrencyId, pending, unknownPayload, failure, detailState, confirmedPortfolioId, refreshingList, listRefreshFailed, onBack, onSubmit, onRefreshList, onRetryDetail }: {
  currencies: readonly PortfolioCurrencyDto[]; defaultCurrencyId: number | null; pending: boolean; unknownPayload: Readonly<PortfolioCreateWrite> | null; failure: PortfolioCreateFailure | null; detailState: 'idle' | 'loading' | 'unavailable'; confirmedPortfolioId: number | null; refreshingList: boolean; listRefreshFailed: boolean; onBack: () => void; onSubmit: (value: PortfolioCreateWrite) => Promise<void>; onRefreshList: () => Promise<void>; onRetryDetail: () => Promise<void>
}) {
  const { t } = useTranslation()
  const palette = usePalette()
  const [name, setName] = useState(unknownPayload?.name ?? '')
  const [currencyId, setCurrencyId] = useState<number | null>(unknownPayload?.currencyId ?? defaultCurrencyId)
  const [reviewed, setReviewed] = useState<Readonly<PortfolioCreateWrite> | null>(unknownPayload)
  const unknown = unknownPayload !== null
  const effective = unknownPayload ?? reviewed

  useEffect(() => { if (!pending) return; const listener = BackHandler.addEventListener('hardwareBackPress', () => true); return () => listener.remove() }, [pending])

  const currencyExists = currencyId !== null && currencies.some((currency) => currency.currencyKey === currencyId)
  const parsed = portfolioCreateWriteSchema.safeParse({ name, currencyId })
  const ready = currencyExists && parsed.success
  // A name of only spaces is entered and wrong; an empty one only keeps the ✓ disabled.
  const nameError = name.length > 0 && name.trim().length === 0 ? t('portfolioCreate.validation') : null
  const review = () => { if (ready && parsed.success) setReviewed(Object.freeze(parsed.data)) }
  const selected = currencies.find((currency) => currency.currencyKey === effective?.currencyId)
  const confirming = effective !== null && !unknown && confirmedPortfolioId === null

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <FormBar
        closeDisabled={pending}
        closeLabel={t('common.close')}
        onClose={onBack}
        onSave={!effective ? review : confirming ? () => void onSubmit(effective) : undefined}
        saveDisabled={!effective ? !ready : pending}
        saveLabel={!effective ? t('portfolioCreate.review') : pending ? t('portfolioCreate.creating') : t('portfolioCreate.confirm')}
        saving={confirming && pending}
        title={t('portfolioCreate.title')}
      />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View style={styles.page}>
          {!effective ? (
            <View style={styles.form}>
              <FormGroup>
                <FormTextRow key="name" error={nameError} label={t('portfolioCreate.name')} maxLength={255} onChangeText={setName} value={name} />
                <FormSelectRow
                  key="currency"
                  hint={t('portfolioCreate.currencyHelper')}
                  label={t('portfolioCreate.currency')}
                  onChange={setCurrencyId}
                  options={currencies.map((currency) => ({ value: currency.currencyKey, label: `${currency.code} · ${currency.description}` }))}
                  placeholder={t('transactionCreate.choose')}
                  value={currencyExists ? currencyId : null}
                />
              </FormGroup>
            </View>
          ) : (
            <View style={styles.form}>
              <View style={styles.reviewHead}>
                <Text accessibilityRole="header" variant="heading">{t('portfolioCreate.reviewTitle')}</Text>
                <Text tone="muted" variant="meta">{t('portfolioCreate.reviewHelper')}</Text>
              </View>
              <PortfolioReviewList>
                <PortfolioReviewRow key="name" label={t('portfolioCreate.name')} value={effective.name} />
                <PortfolioReviewRow key="currency" label={t('portfolioCreate.currency')} value={selected ? `${selected.code} · ${selected.description}` : String(effective.currencyId)} />
              </PortfolioReviewList>
              {failure && !unknown ? <Notice message={t(`portfolioCreate.failures.${failure}`)} tone="destructive" /> : null}
              {unknown ? (
                <View style={styles.state}>
                  <Notice message={t('portfolioCreate.unknownMessage')} title={t('portfolioCreate.unknownTitle')} tone="destructive" />
                  <Text tone="muted" variant="meta">{refreshingList ? t('portfolioCreate.reconciling') : listRefreshFailed ? t('portfolioCreate.refreshFailed') : t('portfolioCreate.noInference')}</Text>
                  <View style={styles.actions}>
                    <Button label={t('portfolioCreate.back')} onPress={onBack} variant="secondary" />
                    <Button disabled={refreshingList} label={t('portfolioCreate.refreshList')} loading={refreshingList} onPress={() => void onRefreshList()} />
                  </View>
                </View>
              ) : confirmedPortfolioId !== null ? (
                <View style={styles.state}>
                  {detailState === 'unavailable'
                    ? <Notice message={t('portfolioCreate.detailUnavailableMessage', { id: confirmedPortfolioId })} title={t('portfolioCreate.detailUnavailableTitle')} />
                    : (
                      <View style={styles.reviewHead}>
                        <Text accessibilityRole="header" variant="bodyStrong">{t('portfolioCreate.confirming')}</Text>
                        <Text accessibilityRole="progressbar" tone="muted" variant="meta">{t('portfolioCreate.confirmingMessage', { id: confirmedPortfolioId })}</Text>
                      </View>
                    )}
                  {detailState === 'unavailable' ? (
                    <View style={styles.actions}>
                      <Button label={t('portfolioCreate.back')} onPress={onBack} variant="secondary" />
                      <Button label={t('portfolioCreate.retryDetail')} onPress={() => void onRetryDetail()} />
                    </View>
                  ) : null}
                </View>
              ) : (
                <View style={styles.actions}>
                  <Button disabled={pending} label={t('portfolioCreate.edit')} onPress={() => setReviewed(null)} variant="secondary" />
                </View>
              )}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: themeTokens.layout.screenPadding, paddingBottom: themeTokens.spacing[10] },
  page: { width: '100%', maxWidth: 720, alignSelf: 'center' },
  form: { gap: themeTokens.spacing[4], paddingTop: themeTokens.spacing[4] },
  reviewHead: { gap: themeTokens.spacing[2] },
  state: { gap: themeTokens.spacing[3] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: themeTokens.spacing[2] },
})
