import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'
import { themeTokens } from '@/theme/tokens'

import { ReportExportButton } from './report-screen-parts'

const palette = themeTokens.colors.light

const renderWithI18n = async (node: React.ReactElement) => {
  const i18n = await initMobileI18n('en')
  return render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>)
}

describe('ReportExportButton', () => {
  it('shows the idle label and triggers export on press', async () => {
    const onExport = jest.fn()
    const view = await renderWithI18n(<ReportExportButton status="idle" onExport={onExport} palette={palette} />)
    const button = view.getByRole('button', { name: 'Export CSV' })
    expect(button.props.accessibilityState).toMatchObject({ disabled: false })
    await fireEvent.press(button)
    expect(onExport).toHaveBeenCalledTimes(1)
  })

  it('shows a disabled state while exporting', async () => {
    const view = await renderWithI18n(<ReportExportButton status="exporting" onExport={jest.fn()} palette={palette} />)
    const button = view.getByRole('button', { name: 'Exporting…' })
    expect(button.props.accessibilityState).toMatchObject({ disabled: true })
  })

  it('shows an alert with the export error message on failure', async () => {
    const view = await renderWithI18n(<ReportExportButton status="error" onExport={jest.fn()} palette={palette} />)
    expect(view.getByRole('alert')).toHaveTextContent('Could not export this report. Check your connection and try again.')
  })
})
