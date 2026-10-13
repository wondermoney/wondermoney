import { fireEvent, render, within } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { StyleSheet } from 'react-native'

import { initMobileI18n } from '@/lib/i18n'

import { CategoriesScreen } from './categories-screen'

describe('CategoriesScreen', () => {
  it('shows text identity with parent/child structure and accessible controls', async () => {
    const i18n = await initMobileI18n('en')
    const edit = jest.fn()
    const create = jest.fn()
    const view = await render(<I18nextProvider i18n={i18n}><CategoriesScreen state={{ status: 'loaded', categories: [{ id: 1, name: 'Housing', system: true, color: null, glyph: '⌂', children: [{ id: 2, name: 'Rent', system: false, color: '#112233', glyph: '□', children: [] }] }] }} onBack={jest.fn()} onRetry={jest.fn()} onCreate={create} onEdit={edit} /></I18nextProvider>)
    expect(view.getByText('Housing')).toBeOnTheScreen()
    expect(view.getByText('Rent')).toBeOnTheScreen()
    // A system category is the default and was labelled on ~39 rows of one
    // screen; only a personal category is worth marking.
    expect(view.queryByText('System category')).toBeNull()
    expect(view.getByText('Custom category')).toBeOnTheScreen()
    const back = view.getByRole('button', { name: 'Back to More' })
    expect(StyleSheet.flatten(back.props.style).minHeight).toBeGreaterThanOrEqual(44)
    expect(within(back).getByText('Back to More').props.allowFontScaling).not.toBe(false)
    await fireEvent.press(view.getByRole('button', { name: 'Create category' }))
    await fireEvent.press(view.getByRole('button', { name: 'Edit Rent' }))
    expect(create).toHaveBeenCalledTimes(1)
    expect(edit).toHaveBeenCalledWith(2)
    expect(view.queryByRole('button', { name: 'Edit Housing' })).not.toBeOnTheScreen()
  })

  it('identifies epoch-latched demo read-only separately from unknown reconciliation', async () => {
    const i18n = await initMobileI18n('en')
    const view = await render(<I18nextProvider i18n={i18n}><CategoriesScreen state={{ status: 'loaded', categories: [] }} createBlocked demoLocked onBack={jest.fn()} onRetry={jest.fn()} /></I18nextProvider>)
    expect(view.getByRole('alert')).toHaveTextContent('Demo profiles are read-only. Category changes are unavailable for this sign-in.')
    expect(view.getByRole('button', { name: 'Create category' })).toBeDisabled()
  })
})
