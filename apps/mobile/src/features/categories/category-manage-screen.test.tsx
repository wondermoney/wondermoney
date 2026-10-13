import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'
import { BackHandler } from 'react-native'

import { initMobileI18n } from '@/lib/i18n'

import { CategoryManageScreen } from './category-manage-screen'

async function localized(locale: 'en' | 'pt-PT' | 'es', element: React.ReactElement) {
  const i18n = await initMobileI18n(locale)
  return render(<I18nextProvider i18n={i18n}>{element}</I18nextProvider>)
}

const base = {
  parents: [{ id: 1, name: 'Food' }],
  duplicateName: (name: string) => name.trim().toLowerCase() === 'lunch',
  duplicateColor: (color: string) => color === '#12ABEF',
  pending: false,
  failure: null,
  reconciliation: null,
  onBack: jest.fn(),
  onRefresh: jest.fn(async () => undefined),
}

describe('CategoryManageScreen', () => {
  it('normalizes and reviews a valid create, allows visible root selection, and keeps duplicate warnings nonblocking', async () => {
    const submit = jest.fn(async () => undefined)
    const view = await localized('en', <CategoryManageScreen {...base} mode="create" onSubmit={submit} />)
    await fireEvent.changeText(view.getByLabelText('Name'), '  Lunch  ')
    await fireEvent.changeText(view.getByLabelText('Color'), '#12abef')
    expect(view.getByText('Another visible category has this name. You can still continue.')).toBeOnTheScreen()
    expect(view.getByText('Another visible category uses this color. You can still continue.')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('radio', { name: 'Food' }))
    await fireEvent.press(view.getByRole('radio', { name: 'Choose plane icon' }))
    await fireEvent.press(view.getByRole('button', { name: 'Review category' }))
    expect(view.getByText('Review and confirm')).toBeOnTheScreen()
    expect(view.getByText('#12ABEF')).toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Confirm category' }))
    expect(submit).toHaveBeenCalledWith({ name: 'Lunch', color: '#12ABEF', icon: 'plane', parentCategoryKey: '1' })
  })

  it('explains global edit impact, offers no reparent or delete, and retains frozen review during reconciliation', async () => {
    const view = await localized('en', <CategoryManageScreen {...base} mode="edit" initial={{ name: 'Lunch', color: '#123456', icon: 'coffee' }} initialReview={{ name: 'Dinner', color: '#654321', icon: 'folder' }} reconciliation="edit-not-applied" onSubmit={jest.fn(async () => undefined)} />)
    expect(view.getByText('These changes affect every existing use of this category.')).toBeOnTheScreen()
    expect(view.getByText('Dinner')).toBeOnTheScreen()
    expect(view.queryByText('Main category')).not.toBeOnTheScreen()
    expect(view.queryByRole('button', { name: /delete/i })).not.toBeOnTheScreen()
    expect(view.queryByRole('button', { name: 'Confirm category' })).not.toBeOnTheScreen()
    expect(view.getAllByRole('button', { name: 'Back to Categories' })).toHaveLength(2)
  })

  it.each([
    [[{ id: 7, name: 'Food' }], 'Food'],
    [[], 'Parent unavailable'],
  ] as const)('restores the frozen create parent without consulting local form state', async (parents, expected) => {
    const view = await localized('en', <CategoryManageScreen {...base} mode="create" parents={parents} initialReview={{ name: 'Lunch', color: '#123456', icon: 'coffee', parentCategoryKey: '7' }} onSubmit={jest.fn(async () => undefined)} />)
    expect(view.getByLabelText(`Main category: ${expected}`)).toBeOnTheScreen()
    expect(view.queryByLabelText('Main category: No main category')).not.toBeOnTheScreen()
  })

  it('keeps reviewed demo details visible and disables both write paths', async () => {
    const submit = jest.fn(async () => undefined)
    const view = await localized('en', <CategoryManageScreen {...base} mode="create" demoLocked failure="demo" initialReview={{ name: 'Private', color: '#123456', icon: 'folder' }} onSubmit={submit} />)
    expect(view.getByText('Private')).toBeOnTheScreen()
    expect(view.getByText('Demo profiles are read-only. No category changed.')).toBeOnTheScreen()
    expect(view.getByRole('button', { name: 'Confirm category' })).toBeDisabled()
    expect(view.getByRole('button', { name: 'Edit details' })).toBeDisabled()
  })

  it('disables visible Back and consumes hardware Back while a write is pending', async () => {
    let hardwareHandler: ((event?: unknown) => boolean | null | undefined) | undefined
    const remove = jest.fn()
    const spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => { hardwareHandler = handler as (event?: unknown) => boolean | null | undefined; return { remove } })
    const back = jest.fn()
    const view = await localized('en', <CategoryManageScreen {...base} mode="create" pending initialReview={{ name: 'Private', color: '#123456', icon: 'folder' }} onBack={back} onSubmit={jest.fn(async () => undefined)} />)
    const visibleBack = view.getByRole('button', { name: 'Back to Categories' })
    expect(visibleBack).toBeDisabled()
    await fireEvent.press(visibleBack)
    expect(back).not.toHaveBeenCalled()
    expect(hardwareHandler?.()).toBe(true)
    await view.unmount()
    expect(remove).toHaveBeenCalled()
    spy.mockRestore()
  })

  it.each([
    ['pt-PT' as const, 'Criar uma categoria', 'Rever categoria', 'Escolher o ícone avião'],
    ['es' as const, 'Crear una categoría', 'Revisar categoría', 'Elegir el icono avión'],
  ])('localizes accessible create actions in %s', async (locale, title, review, plane) => {
    const view = await localized(locale, <CategoryManageScreen {...base} mode="create" onSubmit={jest.fn(async () => undefined)} />)
    expect(view.getByRole('header', { name: title })).toBeOnTheScreen()
    expect(view.getByRole('button', { name: review })).toBeOnTheScreen()
    expect(view.getByRole('radio', { name: plane })).toBeOnTheScreen()
  })
})
