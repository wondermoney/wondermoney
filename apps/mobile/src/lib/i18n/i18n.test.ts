import { foundationResources, initMobileI18n, validateFoundationResources } from './index'
import en from './resources/en.json'
import es from './resources/es.json'
import ptPT from './resources/pt-PT.json'

const resources = { en, 'pt-PT': ptPT, es } as const

type LocaleResource = Record<string, unknown>

const leafValues = (value: unknown, prefix = ''): [string, string][] => {
  if (typeof value === 'string') return [[prefix, value]]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.entries(value as LocaleResource).flatMap(([key, child]) =>
    leafValues(child, prefix ? `${prefix}.${key}` : key),
  )
}

/*
 * i18next interpolates `{{name}}` (and `{{count, number}}`). A translation that
 * drops or renames one renders a literal `{{name}}` to that locale's reader, so
 * every locale must keep the English message's placeholders.
 */
const placeholders = (message: string): string[] => [
  ...new Set(
    [...message.matchAll(/\{\{\s*([\w.-]+)(?:\s*,\s*[\w]+)?\s*\}\}/g)].map((match) => match[1]),
  ),
].sort()

describe('mobile product i18n', () => {
  it('keeps exact locale and key parity', () => {
    expect(Object.keys(foundationResources).sort()).toEqual(['en', 'es', 'pt-PT'])
    expect(validateFoundationResources(resources)).toBe(true)
  })

  it('keeps every locale’s interpolation placeholders in step with English', () => {
    const reference = new Map(leafValues(en))

    for (const [locale, resource] of [
      ['pt-PT', ptPT],
      ['es', es],
    ] as const) {
      const translated = new Map(leafValues(resource))

      for (const [key, source] of reference) {
        const target = translated.get(key)
        // Key parity above reports a missing key; there is nothing to compare.
        if (target === undefined) continue

        const expected = placeholders(source)
        const actual = placeholders(target)
        const missing = expected.filter((name) => !actual.includes(name))
        const extra = actual.filter((name) => !expected.includes(name))
        const file = `resources/${locale}.json`

        expect({ file, locale, key, missing, extra }).toEqual({
          file,
          locale,
          key,
          missing: [],
          extra: [],
        })
      }
    }
  })

  it('provides exact estimated net worth semantics in every locale', async () => {
    await expect(initMobileI18n('en')).resolves.toMatchObject({ language: 'en' })
    const enI18n = await initMobileI18n('en')
    const pt = await initMobileI18n('pt-PT')
    const esI18n = await initMobileI18n('es')
    expect(enI18n.t('netWorth.title')).toBe('At a glance')
    expect(pt.t('netWorth.title')).toBe('À primeira vista')
    expect(esI18n.t('netWorth.title')).toBe('De un vistazo')
  })

  it('provides the primary navigation destinations and account semantics', async () => {
    const enI18n = await initMobileI18n('en')
    const pt = await initMobileI18n('pt-PT')
    const esI18n = await initMobileI18n('es')
    expect([enI18n.t('navigation.home'), enI18n.t('navigation.accounts'), enI18n.t('navigation.budgets'), enI18n.t('navigation.more')]).toEqual(['Home', 'Accounts', 'Budgets', 'More'])
    expect([pt.t('navigation.home'), pt.t('navigation.accounts'), pt.t('navigation.budgets'), pt.t('navigation.more')]).toEqual(['Início', 'Contas', 'Orçamentos', 'Mais'])
    expect([esI18n.t('navigation.home'), esI18n.t('navigation.accounts'), esI18n.t('navigation.budgets'), esI18n.t('navigation.more')]).toEqual(['Inicio', 'Cuentas', 'Presupuestos', 'Más'])
    expect(pt.t('accounts.unnamed')).toBe('Conta sem nome')
    expect(pt.t('accounts.balanceUnavailable')).toBe('Saldo indisponível')
    expect(esI18n.t('accounts.source.openBanking')).toBe('Open Banking')
    expect(esI18n.t('accounts.empty')).toBe('Aún sin cuentas')
    expect(enI18n.t('accountDetail.back')).toBe('Back')
    expect(pt.t('accountDetail.updateUnavailable')).toBe('Data e hora da atualização indisponíveis')
    expect(esI18n.t('accountDetail.convertedUnavailable')).toBe('Saldo convertido no disponible')
  })

  it('keeps manual-account review and unknown-outcome safety localized', async () => {
    const enI18n = await initMobileI18n('en')
    const pt = await initMobileI18n('pt-PT')
    const esI18n = await initMobileI18n('es')
    expect(enI18n.t('offlineAccount.manualContext')).toContain('not a real transaction')
    expect(enI18n.t('offlineAccount.unknownMessage')).toContain('matching fields do not prove')
    expect(enI18n.t('offlineAccount.errors.cancelled')).toContain('before it was sent')
    expect(pt.t('offlineAccount.checkAccounts')).toBe('Consultar contas')
    expect(pt.t('offlineAccount.errors.cancelled')).toContain('antes do envio')
    expect(esI18n.t('offlineAccount.errors.demo')).toContain('solo lectura')
    expect(esI18n.t('offlineAccount.errors.cancelled')).toContain('antes del envío')
  })

  it('provides localized access, goal disclosure, stale recovery, and not-found copy', async () => {
    const enI18n = await initMobileI18n('en')
    const pt = await initMobileI18n('pt-PT')
    const esI18n = await initMobileI18n('es')
    expect(enI18n.t('access.availableActions')).toBe('Available actions')
    expect(pt.t('access.opensHere')).toBe('mostra neste ecrã')
    expect(esI18n.t('access.actionFailed')).toBe('No se pudo completar esa acción. Inténtalo de nuevo')
    expect(enI18n.t('goals.assignedThisMonth')).toBe('Assigned this month')
    expect(pt.t('goals.linkedAccounts')).toBe('Contexto das contas associadas')
    expect(esI18n.t('goals.hideDetails', { name: 'Viaje' })).toBe('Ocultar detalles de Viaje')
    expect(pt.t('goals.empty')).toBe('Cria um objetivo para reservar dinheiro orçamentado para algo específico, como um fundo de emergência, férias, impostos ou a entrada de uma casa.')
    expect(esI18n.t('goals.empty')).toBe('Crea un objetivo para reservar dinero presupuestado para algo específico, como un fondo de emergencia, vacaciones, impuestos o la entrada de una vivienda.')
    expect(enI18n.t('profile.notFoundTitle')).toBe('Profile not available')
  })

  it('keeps grounded transaction retrieval and review copy in every locale', async () => {
    const enI18n = await initMobileI18n('en')
    const pt = await initMobileI18n('pt-PT')
    const esI18n = await initMobileI18n('es')
    expect(enI18n.t('transactions.loadedScope', { limit: 100 })).toContain('up to 100 requested')
    expect(enI18n.t('transactions.loadedScope', { limit: 500 })).toContain('up to 500 requested')
    expect(pt.t('transactions.loadedScope', { limit: 500 })).toContain('até 500 resultados')
    expect(esI18n.t('transactions.loadedScope', { limit: 500 })).toContain('hasta 500 resultados')
    expect(pt.t('transactions.markReviewed')).toBe('Marcar como revista')
    expect(esI18n.t('transactions.reviewResult.demo')).toContain('solo lectura')
    expect(enI18n.t('transactions.confirmCategoryMessage', { count: 12, category: 'Food' })).toContain('12 selected transactions')
    expect(enI18n.t('transactions.confirmReviewMessage', { count: 12 })).toBe('Mark 12 selected transactions as reviewed?')
    expect(pt.t('transactions.selectionScope')).toContain('saldos iniciais')
    expect(pt.t('transactions.confirmReviewTitle')).toBe('Confirmar revisão em lote')
    expect(esI18n.t('transactions.reviewResult.network')).toContain('resultado de la solicitud de red es incierto')
    expect(esI18n.t('transactions.confirmReview')).toBe('Marcar como revisadas')
    expect(enI18n.t('transactions.reviewResult.mfa')).toContain('Multi-factor authentication')
  })

  it('keeps recurring summary and mutation copy in every locale', async () => {
    const enI18n = await initMobileI18n('en')
    const pt = await initMobileI18n('pt-PT')
    const esI18n = await initMobileI18n('es')
    expect(enI18n.t('recurring.monthlyTotal')).toBe('Monthly total')
    expect(pt.t('recurring.needsReview')).toContain('inferior a 90%')
    expect(esI18n.t('recurring.noItems.message')).toContain('no ha identificado')
    expect(enI18n.t('recurring.dismissConfirm.message', { name: 'Rent' })).toContain('review and detection')
    expect(pt.t('recurring.editor.save')).toBe('Guardar alterações')
    expect(esI18n.t('recurring.actionResult.network')).toContain('resultado es incierto')
    expect(enI18n.t('recurring.scan.confirmMessage')).toContain('create new recurring candidates or update existing candidates')
    expect(pt.t('recurring.scan.action')).toBe('Procurar novamente')
    expect(esI18n.t('recurring.scan.unknown')).toContain('antes de hacer cambios o volver a escanear')
  })

  it('keeps insight periods and loaded-window boundaries in every locale', async () => {
    const enI18n = await initMobileI18n('en')
    const pt = await initMobileI18n('pt-PT')
    const esI18n = await initMobileI18n('es')
    expect(enI18n.t('insights.periods.90-days')).toBe('Last 90 days')
    expect(pt.t('transactions.loadedFiltersNote')).toContain('já carregadas')
    expect(esI18n.t('insights.accountMetricsRange', { date: '1 jul' })).toContain('servidor')
  })

  it('keeps portfolio activity, bounded results, 429, and analytics caveats translated', async () => {
    const enI18n = await initMobileI18n('en')
    const pt = await initMobileI18n('pt-PT')
    const esI18n = await initMobileI18n('es')
    expect(enI18n.t('portfolioActivity.bounded')).toContain('up to 50')
    expect(enI18n.t('portfolioActivity.splitRatioUnavailable')).toBe('Ratio details unavailable')
    expect(pt.t('portfolioActivity.splitReadOnly')).toContain('leitura apenas')
    expect(pt.t('portfolioActivity.splitRatioUnavailable')).toContain('indisponíveis')
    expect(esI18n.t('portfolioActivity.rateLimitMessage')).toContain('demasiadas solicitudes')
    expect(esI18n.t('portfolioActivity.splitRatioUnavailable')).toContain('no disponibles')
    expect(enI18n.t('portfolioAnalytics.dividendCurrencyUnavailable')).toContain('does not supply a currency')
    expect(pt.t('portfolioAnalytics.riskNotReady')).toContain('histórico insuficiente')
    expect(esI18n.t('portfolioAnalytics.load')).toBe('Cargar análisis')
  })

  it('keeps portfolio create review and settings reconciliation safety translated', async () => {
    const enI18n = await initMobileI18n('en')
    const pt = await initMobileI18n('pt-PT')
    const esI18n = await initMobileI18n('es')
    expect(enI18n.t('portfolioCreate.noInference')).toContain('will not infer success')
    expect(enI18n.t('portfolioSettings.descriptionCleared')).toBe('Remove the current description')
    expect(enI18n.t('portfolioSettings.notAppliedMessage')).toContain('Acknowledge')
    expect(pt.t('portfolioSettings.confirm')).toBe('Confirmar alterações')
    expect(pt.t('portfolioSettings.reconciliationFailed')).toContain('resultado seguro')
    expect(esI18n.t('portfolioSettings.review')).toBe('Revisar cambios')
    expect(esI18n.t('portfolioSettings.acknowledge')).toContain('no se aplicaron')
  })

  it('keeps external-link and long More labels translated in every locale', async () => {
    const enI18n = await initMobileI18n('en')
    const pt = await initMobileI18n('pt-PT')
    const esI18n = await initMobileI18n('es')
    expect(enI18n.t('more.opensOutside')).toBe('opens outside the app')
    expect(pt.t('more.helper')).toBe('Documentos legais, apoio e informação da aplicação')
    expect(esI18n.t('more.opensMail')).toBe('abre tu aplicación de correo')
    expect(enI18n.t('more.profile')).toBe('Profile')
    expect(esI18n.t('more.opensInside')).toBe('se abre en la aplicación')
    expect(enI18n.t('more.loans')).toBe('Loans')
    expect(pt.t('loans.outstanding')).toBe('Capital em dívida')
    expect(esI18n.t('loanDetail.totalNote')).toContain('Solo el principal reduce')
    expect(enI18n.t('loanEdit.netWorthHelper')).toContain('does not change the debt itself')
    expect(pt.t('loanEdit.netWorthSwitch')).toContain('património líquido estimado')
    expect(esI18n.t('loanEdit.netWorthConfirmExclude')).toContain('no la deuda en sí')
    expect(enI18n.t('more.budgets')).toBe('Budgets')
    expect(pt.t('budgets.remaining')).toBe('Restante')
    expect(esI18n.t('budgetMonth.accountsNote')).toContain('solo lectura')
    expect(esI18n.t('budgetMonth.accountsNote')).toContain('no se puede cambiar aquí')
  })

  it('keeps duplicate category reconciliation neutral and requires another refresh in every locale', async () => {
    const enI18n = await initMobileI18n('en')
    const pt = await initMobileI18n('pt-PT')
    const esI18n = await initMobileI18n('es')
    expect(enI18n.t('budgetAddCategory.reconciliation.duplicate-unknown')).toBe('The category state could not be confirmed. Refresh the current month again before starting any new attempt')
    expect(pt.t('budgetAddCategory.reconciliation.duplicate-unknown')).toContain('Atualiza novamente o mês atual')
    expect(esI18n.t('budgetAddCategory.reconciliation.duplicate-unknown')).toContain('Actualiza de nuevo el mes actual')
  })

  it.each([
    ['en', '1 loan balance is not included', '2 loan balances are not included'],
    ['pt-PT', '1 saldo de empréstimo não está incluído', '2 saldos de empréstimos não estão incluídos'],
    ['es', 'No se incluye 1 saldo de préstamo', 'No se incluyen 2 saldos de préstamos'],
  ])('resolves singular and plural warnings for %s', async (locale, singular, plural) => {
    const i18n = await initMobileI18n(locale)
    expect(i18n.t('netWorth.unsupportedLoan', { count: 1 })).toBe(singular)
    expect(i18n.t('netWorth.unsupportedLoan', { count: 2 })).toBe(plural)
  })

  it('keeps split copy in every locale', async () => {
    const enI18n = await initMobileI18n('en')
    const pt = await initMobileI18n('pt-PT')
    const esI18n = await initMobileI18n('es')
    expect(enI18n.t('transactions.split.summary', { count: 1 })).toBe('Split · 1 category')
    expect(enI18n.t('transactions.split.summary', { count: 2 })).toBe('Split · 2 categories')
    expect(pt.t('transactions.split.remaining')).toBe('Falta atribuir')
    expect(pt.t('transactions.split.summary', { count: 3 })).toBe('Dividida · 3 categorias')
    expect(esI18n.t('transactions.split.saveBlocked')).toContain('antes de guardar')
    expect(esI18n.t('transactions.split.remaining')).toBe('Falta asignar')
  })

  it('normalizes supported variants and falls back safely', async () => {
    await expect(initMobileI18n('pt-BR')).resolves.toMatchObject({ language: 'pt-PT' })
    await expect(initMobileI18n('es-MX')).resolves.toMatchObject({ language: 'es' })
    const fallback = await initMobileI18n('xx')
    expect(fallback.language).toBe('en')
    expect(fallback.t('auth.submit')).toBe('Sign in')
  })

  it('has screener filter and entry-point keys in every locale', async () => {
    const enI18n = await initMobileI18n('en')
    const pt = await initMobileI18n('pt-PT')
    const esI18n = await initMobileI18n('es')
    expect(enI18n.t('marketsSearch.screenerLink')).toBe('Screener')
    expect(enI18n.t('screener.apply')).toBe('Apply filters')
    expect(pt.t('screener.title')).not.toBe('screener.title')
    expect(esI18n.t('screener.empty')).not.toBe('screener.empty')
  })

  it('has signup keys in every locale', async () => {
    for (const locale of ['en', 'pt-PT', 'es'] as const) {
      const i18n = await initMobileI18n(locale)
      expect(i18n.t('auth.signup.title')).not.toBe('auth.signup.title')
      expect(i18n.t('auth.errors.emailTaken')).not.toBe('auth.errors.emailTaken')
      expect(i18n.t('auth.validation.confirmMismatch')).not.toBe('auth.validation.confirmMismatch')
    }
  })

  it('fails parity when a product key is missing', () => {
    const { refresh: _refresh, ...commonWithoutRefresh } = ptPT.common
    expect(() => validateFoundationResources({
      en,
      'pt-PT': { ...ptPT, common: commonWithoutRefresh as typeof ptPT.common },
      es,
    })).toThrow(/missing/i)
  })
})
