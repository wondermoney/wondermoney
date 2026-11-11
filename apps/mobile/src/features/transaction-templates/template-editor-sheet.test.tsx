import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { TemplateEditorSheet } from './template-editor-sheet'
import type { TransactionTemplateDto } from './templates-contract'

const template: TransactionTemplateDto = {
  transactionTemplateKey: 4,
  name: 'Weekly groceries',
  direction: 'out',
  amount: 42.5,
  description: 'Saturday market',
  notes: null,
  position: 0,
  account: null,
  category: null,
  transactionMerchant: null,
}

const renderSheet = async ({ visible = true, current = null as TransactionTemplateDto | null } = {}) => {
  const i18n = await initMobileI18n('en')
  const onSave = jest.fn()
  const onDelete = jest.fn()
  const onClose = jest.fn()
  const view = await render(
    <I18nextProvider i18n={i18n}>
      <TemplateEditorSheet
        onClose={onClose}
        onDelete={current ? onDelete : undefined}
        onSave={onSave}
        pending={false}
        template={current}
        visible={visible}
      />
    </I18nextProvider>,
  )
  return { view, onSave, onDelete, onClose }
}

describe('template editor sheet', () => {
  it('saves a new template from its fields', async () => {
    const { view, onSave } = await renderSheet()

    await fireEvent.changeText(view.getByLabelText('Name'), 'Bus ticket')
    await fireEvent.changeText(view.getByLabelText('Amount'), '2.50')
    await fireEvent.press(view.getByRole('tab', { name: 'Money in' }))
    await fireEvent.press(view.getByRole('button', { name: 'Save' }))

    expect(onSave).toHaveBeenCalledWith({
      name: 'Bus ticket',
      direction: 'in',
      amount: 2.5,
      description: null,
      notes: null,
    })
  })

  it('shows the saved fields and deletes the template', async () => {
    const { view, onDelete } = await renderSheet({ current: template })

    expect(view.getByLabelText('Name').props.value).toBe('Weekly groceries')
    expect(view.getByLabelText('Amount').props.value).toBe('42.5')

    await fireEvent.press(view.getByRole('button', { name: 'Delete template' }))

    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('refuses a blank name', async () => {
    const { view, onSave } = await renderSheet()

    await fireEvent.press(view.getByRole('button', { name: 'Save' }))

    expect(onSave).not.toHaveBeenCalled()
    expect(view.getByText('Give the template a name.')).toBeTruthy()
  })
})
