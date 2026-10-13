import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'
import { themeTokens } from '@/theme/tokens'

import { CanonicalValuePicker } from './canonical-value-picker'

const palette = themeTokens.colors.light
const options = ['Technology', 'Healthcare', 'Energy', 'Utilities', 'Financial']

async function renderPicker(overrides: Partial<React.ComponentProps<typeof CanonicalValuePicker>> = {}) {
  const i18n = await initMobileI18n('en')
  const props: React.ComponentProps<typeof CanonicalValuePicker> = {
    label: 'Sector', options, selected: null, onSelect: jest.fn(), palette, ...overrides,
  }
  const view = await render(<I18nextProvider i18n={i18n}><CanonicalValuePicker {...props} /></I18nextProvider>)
  return { view, props }
}

describe('CanonicalValuePicker', () => {
  it('shows "Any" when nothing is selected, and stays collapsed until tapped', async () => {
    const { view } = await renderPicker()
    expect(view.getByText('Any')).toBeOnTheScreen()
    expect(view.queryByRole('button', { name: 'Clear' })).not.toBeOnTheScreen()
  })

  it('shows the selected value in the summary', async () => {
    const { view } = await renderPicker({ selected: 'Technology' })
    expect(view.getByLabelText('Sector')).toHaveTextContent(/Technology/)
  })

  it('expands to a searchable list and selects an option', async () => {
    const onSelect = jest.fn()
    const { view } = await renderPicker({ onSelect })
    await fireEvent.press(view.getByRole('button', { name: 'Sector' }))
    expect(view.getByText('Technology')).toBeOnTheScreen()
    expect(view.getByText('Energy')).toBeOnTheScreen()
    await fireEvent.press(view.getByText('Energy'))
    expect(onSelect).toHaveBeenCalledWith('Energy')
  })

  it('filters options by a case-insensitive substring match', async () => {
    const { view } = await renderPicker()
    await fireEvent.press(view.getByRole('button', { name: 'Sector' }))
    await fireEvent.changeText(view.getByPlaceholderText('Search Sector'), 'ENERG')
    expect(view.getByText('Energy')).toBeOnTheScreen()
    expect(view.queryByText('Technology')).not.toBeOnTheScreen()
  })

  it('shows a no-matches message when nothing filters in', async () => {
    const { view } = await renderPicker()
    await fireEvent.press(view.getByRole('button', { name: 'Sector' }))
    await fireEvent.changeText(view.getByPlaceholderText('Search Sector'), 'zzzznomatch')
    expect(view.getByText('No matches')).toBeOnTheScreen()
  })

  it('offers to clear an existing selection', async () => {
    const onSelect = jest.fn()
    const { view } = await renderPicker({ selected: 'Technology', onSelect })
    await fireEvent.press(view.getByRole('button', { name: 'Sector' }))
    await fireEvent.press(view.getByRole('button', { name: 'Clear' }))
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('caps the rendered results for very large lists', async () => {
    const manyOptions = Array.from({ length: 200 }, (_, index) => `Option ${index}`)
    const { view } = await renderPicker({ options: manyOptions })
    await fireEvent.press(view.getByRole('button', { name: 'Sector' }))
    expect(view.getAllByText(/^Option \d+$/).length).toBeLessThanOrEqual(50)
  })
})
