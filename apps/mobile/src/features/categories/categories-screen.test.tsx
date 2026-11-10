import { fireEvent, render, within } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { CategoriesScreen } from './categories-screen'
import { touchHeight } from '@/test/touch-target'

describe('CategoriesScreen', () => {
  it('shows text identity with parent/child structure and accessible controls', async () => {
    const i18n = await initMobileI18n('en')
    const edit = jest.fn()
    const create = jest.fn()
    const view = await render(<I18nextProvider i18n={i18n}><CategoriesScreen state={{ status: 'loaded', categories: [{ id: 1, name: 'Housing', system: true, color: null, glyph: '⌂', countsAsSpending: true, lockedByParent: false, children: [{ id: 2, name: 'Rent', system: false, color: '#112233', glyph: '□', countsAsSpending: true, lockedByParent: false, children: [] }] }] }} onBack={jest.fn()} onRetry={jest.fn()} onCreate={create} onEdit={edit} /></I18nextProvider>)
    expect(view.getByText('Housing')).toBeOnTheScreen()
    expect(view.getByText('Rent')).toBeOnTheScreen()
    // A system category is the default and was labelled on ~39 rows of one
    // screen; only a personal category is worth marking.
    expect(view.queryByText('System category')).toBeNull()
    expect(view.getByText('Custom category')).toBeOnTheScreen()
    const back = view.getByRole('button', { name: 'Back to More' })
    expect(touchHeight(back)).toBeGreaterThanOrEqual(44)
    // The visible label names the destination, web's "← More".
    expect(within(back).getByText('More').props.allowFontScaling).not.toBe(false)
    await fireEvent.press(view.getByRole('button', { name: 'Create category' }))
    await fireEvent.press(view.getByRole('button', { name: 'Edit Rent' }))
    expect(create).toHaveBeenCalledTimes(1)
    expect(edit).toHaveBeenCalledWith(2)
    expect(view.queryByRole('button', { name: 'Edit Housing' })).not.toBeOnTheScreen()
  })

  it('switches "counts as spending" on a system category, locked off under a main category that does not count', async () => {
    const i18n = await initMobileI18n('en')
    const toggle = jest.fn()
    const view = await render(<I18nextProvider i18n={i18n}><CategoriesScreen state={{ status: 'loaded', categories: [
      { id: 1, name: 'Groceries', system: true, color: null, glyph: '□', countsAsSpending: true, lockedByParent: false, children: [] },
      { id: 3, name: 'Investments and savings', system: true, color: null, glyph: '□', countsAsSpending: false, lockedByParent: false, children: [
        { id: 4, name: 'Savings', system: true, color: null, glyph: '□', countsAsSpending: false, lockedByParent: true, children: [] },
      ] },
    ] }} onBack={jest.fn()} onRetry={jest.fn()} onToggleCountsAsSpending={toggle} /></I18nextProvider>)

    await fireEvent(view.getByRole('switch', { name: 'Counts as spending: Groceries' }), 'valueChange', false)
    await fireEvent(view.getByRole('switch', { name: 'Counts as spending: Investments and savings' }), 'valueChange', true)

    expect(toggle.mock.calls).toEqual([[1, false], [3, true]])
    expect(view.getByRole('switch', { name: 'Counts as spending: Savings' })).toBeDisabled()
  })

  it('identifies epoch-latched demo read-only separately from unknown reconciliation', async () => {
    const i18n = await initMobileI18n('en')
    const view = await render(<I18nextProvider i18n={i18n}><CategoriesScreen state={{ status: 'loaded', categories: [] }} createBlocked demoLocked onBack={jest.fn()} onRetry={jest.fn()} /></I18nextProvider>)
    expect(view.getByRole('alert')).toHaveTextContent('Demo profiles are read-only. Category changes are unavailable for this sign-in.')
    expect(view.getByRole('button', { name: 'Create category' })).toBeDisabled()
  })
})
