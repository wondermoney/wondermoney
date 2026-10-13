import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { GoalCreateScreen, type GoalCreateScreenProps } from './goal-create-screen'
import type { GoalCreateWrite } from './goals-contract'

const baseProps: GoalCreateScreenProps = {
  pending: false,
  failure: null,
  unknownPayload: null,
  refreshingGoals: false,
  goalsRefreshFailed: false,
  confirmedGoalId: null,
  detailState: 'idle',
  onBack: jest.fn(),
  onSubmit: jest.fn(async () => undefined),
  onRefreshGoals: jest.fn(async () => undefined),
  onRetryDetails: jest.fn(async () => undefined),
}

async function renderScreen(props: Partial<GoalCreateScreenProps> = {}, locale = 'en') {
  const i18n = await initMobileI18n(locale)
  return render(<I18nextProvider i18n={i18n}><GoalCreateScreen {...baseProps} {...props} /></I18nextProvider>)
}

describe('GoalCreateScreen', () => {
  beforeEach(() => jest.clearAllMocks())

  it('shows a per-field error under each missing required field and clears them as fixed', async () => {
    const submit = jest.fn<Promise<void>, [GoalCreateWrite]>(async () => undefined)
    const view = await renderScreen({ onSubmit: submit })
    await fireEvent.press(view.getByRole('button', { name: 'Review goal' }))
    expect(await view.findByText('Enter a name up to 100 characters.')).toBeOnTheScreen()
    expect(view.getByText('Enter a positive amount with up to 4 decimal places.')).toBeOnTheScreen()
    expect(view.queryByText('Review and confirm')).not.toBeOnTheScreen()
    await fireEvent.changeText(view.getByLabelText('Goal name'), 'Home reserve')
    expect(view.queryByText('Enter a name up to 100 characters.')).not.toBeOnTheScreen()
    expect(submit).not.toHaveBeenCalled()
  })

  it('flags an unparsable optional monthly amount even though it would otherwise be omitted', async () => {
    const view = await renderScreen()
    await fireEvent.changeText(view.getByLabelText('Goal name'), 'Home reserve')
    await fireEvent.changeText(view.getByLabelText('Target amount'), '1000')
    await fireEvent.changeText(view.getByLabelText('Monthly contribution target'), 'not a number')
    await fireEvent.press(view.getByRole('button', { name: 'Review goal' }))
    expect(await view.findByText('Enter a positive amount with up to 4 decimal places.')).toBeOnTheScreen()
    expect(view.queryByText('Review and confirm')).not.toBeOnTheScreen()
  })

  it('validates the form, omits empty optional values, and submits the frozen reviewed payload', async () => {
    const submit = jest.fn<Promise<void>, [GoalCreateWrite]>(async () => undefined)
    const view = await renderScreen({ onSubmit: submit })
    await fireEvent.changeText(view.getByLabelText('Goal name'), '  Home reserve  ')
    await fireEvent.changeText(view.getByLabelText('Target amount'), '1,234.5678')
    await fireEvent.changeText(view.getByLabelText('Target date'), '2099-02-28')
    await fireEvent.press(view.getByRole('button', { name: 'Review goal' }))
    expect(view.getByText('Review and confirm')).toBeOnTheScreen()
    expect(view.getByLabelText('Goal name: Home reserve')).toBeOnTheScreen()
    expect(view.getByText('Authenticated profile currency')).toBeOnTheScreen()
    expect(view.queryByLabelText('Goal name')).not.toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Confirm and create' }))
    expect(submit).toHaveBeenCalledTimes(1)
    const payload = submit.mock.calls[0][0]
    expect(payload).toEqual({ name: 'Home reserve', targetAmount: 1234.5678, targetDate: '2099-02-28T00:00:00.000Z' })
    expect(Object.isFrozen(payload)).toBe(true)
    expect(payload).not.toHaveProperty('currencyId')
    expect(payload).not.toHaveProperty('description')
    expect(payload).not.toHaveProperty('monthlyContributionTarget')
  })

  it('keeps an unknown reviewed attempt locked with only Goals review actions', async () => {
    const refresh = jest.fn(async () => undefined)
    const view = await renderScreen({
      failure: 'unknown',
      unknownPayload: { name: 'Reserve', targetAmount: 100 },
      onRefreshGoals: refresh,
    })
    expect(view.getByText('Creation outcome unknown')).toBeOnTheScreen()
    expect(view.getByText(/Do not infer success from names, amounts, dates, or newly visible goal IDs/)).toBeOnTheScreen()
    expect(view.queryByRole('button', { name: 'Confirm and create' })).not.toBeOnTheScreen()
    expect(view.queryByRole('button', { name: /Create another/i })).not.toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Refresh Goals' }))
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(view.getByRole('button', { name: 'Return to Goals' })).toBeOnTheScreen()
  })

  it('shows confirmed identity recovery without any create action', async () => {
    const retry = jest.fn(async () => undefined)
    const view = await renderScreen({ confirmedGoalId: 42, detailState: 'unavailable', onRetryDetails: retry })
    await fireEvent.changeText(view.getByLabelText('Goal name'), 'Reserve')
    await fireEvent.changeText(view.getByLabelText('Target amount'), '100')
    await fireEvent.press(view.getByRole('button', { name: 'Review goal' }))
    expect(view.getByText('Goal created, details unavailable')).toBeOnTheScreen()
    expect(view.getByText(/Goal ID 42 was created/)).toBeOnTheScreen()
    expect(view.queryByRole('button', { name: 'Confirm and create' })).not.toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Retry details' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['pt-PT', 'Criar um objetivo', 'Rever objetivo'],
    ['es', 'Crear un objetivo', 'Revisar objetivo'],
  ])('exposes translated headings, fields, and accessible actions in %s', async (locale, title, review) => {
    const view = await renderScreen({}, locale)
    expect(view.getByText(title)).toBeOnTheScreen()
    expect(view.getByRole('button', { name: review })).toBeOnTheScreen()
    expect(view.getByLabelText(locale === 'es' ? 'Nombre del objetivo' : 'Nome do objetivo')).toBeOnTheScreen()
  })
})
