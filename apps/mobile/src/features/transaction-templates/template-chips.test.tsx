import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { TemplateChips } from './template-chips'
import type { TransactionTemplateDto } from './templates-contract'

const template = (overrides: Partial<TransactionTemplateDto> = {}): TransactionTemplateDto => ({
  transactionTemplateKey: 4,
  name: 'Weekly groceries',
  direction: 'out',
  amount: 42.5,
  description: null,
  notes: null,
  position: 0,
  account: null,
  category: null,
  transactionMerchant: null,
  ...overrides,
})

const renderChips = async (templates: TransactionTemplateDto[]) => {
  const i18n = await initMobileI18n('en')
  const onUse = jest.fn()
  const onManage = jest.fn()
  const onCreate = jest.fn()
  const view = await render(
    <I18nextProvider i18n={i18n}>
      <TemplateChips templates={templates} onCreate={onCreate} onManage={onManage} onUse={onUse} />
    </I18nextProvider>,
  )
  return { view, onCreate, onManage, onUse }
}

describe('template chips', () => {
  it('fills the form on a tap', async () => {
    const groceries = template()
    const { view, onManage, onUse } = await renderChips([groceries])

    await fireEvent.press(view.getByRole('button', { name: 'Use template Weekly groceries' }))

    expect(onUse).toHaveBeenCalledWith(groceries)
    expect(onManage).not.toHaveBeenCalled()
  })

  it('opens the editor on a long press', async () => {
    const groceries = template()
    const { view, onManage, onUse } = await renderChips([groceries])

    await fireEvent(view.getByRole('button', { name: 'Use template Weekly groceries' }), 'longPress')

    expect(onManage).toHaveBeenCalledWith(groceries)
    expect(onUse).not.toHaveBeenCalled()
  })

  it('offers a new template even before any exists', async () => {
    const { view, onCreate } = await renderChips([])

    await fireEvent.press(view.getByRole('button', { name: 'New template' }))

    expect(onCreate).toHaveBeenCalledTimes(1)
  })
})
