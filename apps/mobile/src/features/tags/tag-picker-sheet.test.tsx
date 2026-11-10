import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { TagPickerSheet, type CreateTagOutcome } from './tag-picker-sheet'
import type { TagDto } from './tags-contract'

const trip: TagDto = { tagKey: 1, name: 'Trip', color: '#ef4444' }
const work: TagDto = { tagKey: 2, name: 'Work', color: '#94a3b8' }

async function renderSheet({ initial = [] as number[], onCreate = jest.fn<Promise<CreateTagOutcome>, [string]>(), language = 'en' } = {}) {
  const i18n = await initMobileI18n(language)
  const onSave = jest.fn()
  const view = await render(
    <I18nextProvider i18n={i18n}>
      <TagPickerSheet initial={initial} onClose={jest.fn()} onCreate={onCreate} onSave={onSave} saveLabel="Save tags" tags={{ status: 'loaded', tags: [trip, work] }} title="Tags" />
    </I18nextProvider>,
  )
  return { view, onSave, onCreate }
}

describe('TagPickerSheet', () => {
  it('toggles tags as checkboxes and saves the draft', async () => {
    const { view, onSave } = await renderSheet({ initial: [2] })
    expect(view.getByRole('checkbox', { name: 'Work' })).toBeChecked()
    await fireEvent.press(view.getByRole('checkbox', { name: 'Trip' }))
    await fireEvent.press(view.getByRole('checkbox', { name: 'Work' }))
    await fireEvent.press(view.getByRole('button', { name: 'Save tags' }))
    expect(onSave).toHaveBeenCalledWith([1])
  })

  it('creates a tag inline and selects it', async () => {
    const onCreate = jest.fn<Promise<CreateTagOutcome>, [string]>().mockResolvedValue({ tag: { tagKey: 9, name: 'Holiday', color: '#94a3b8' } })
    const { view, onSave } = await renderSheet({ onCreate })
    await fireEvent.changeText(view.getByLabelText('New tag'), '  Holiday ')
    await fireEvent.press(view.getByRole('button', { name: 'Create “Holiday”' }))
    expect(onCreate).toHaveBeenCalledWith('Holiday')
    expect(await view.findByRole('checkbox', { name: 'Holiday' })).toBeChecked()
    await fireEvent.press(view.getByRole('button', { name: 'Save tags' }))
    expect(onSave).toHaveBeenCalledWith([9])
  })

  it('selects the existing tag for a name that differs only in case, without creating one', async () => {
    const { view, onCreate } = await renderSheet()
    await fireEvent.changeText(view.getByLabelText('New tag'), 'trip')
    await fireEvent.press(view.getByRole('button', { name: 'Select “Trip”' }))
    expect(onCreate).not.toHaveBeenCalled()
    expect(view.getByRole('checkbox', { name: 'Trip' })).toBeChecked()
  })

  it('shows why a tag could not be created', async () => {
    const onCreate = jest.fn<Promise<CreateTagOutcome>, [string]>().mockResolvedValue({ error: 'The tag could not be created. Try again.' })
    const { view } = await renderSheet({ onCreate, language: 'pt-PT' })
    await fireEvent.changeText(view.getByLabelText('Nova etiqueta'), 'Casa')
    await fireEvent.press(view.getByRole('button', { name: 'Criar “Casa”' }))
    expect(await view.findByText('The tag could not be created. Try again.')).toBeOnTheScreen()
  })
})
