import { fireEvent, render } from '@testing-library/react-native'
import { I18nextProvider } from 'react-i18next'

import { initMobileI18n } from '@/lib/i18n'

import { ScanPairingQr } from './scan-pairing-qr'

const mockCameraState = {
  data: 'wondermoney://pair?server=https%3A%2F%2Fapi.example.test&code=abcdefghijklmnop',
  granted: true,
  requestPermission: jest.fn(),
}

jest.mock('expo-camera', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pressable, Text } = require('react-native')
  return {
    useCameraPermissions: () => [{ granted: mockCameraState.granted }, mockCameraState.requestPermission],
    CameraView: ({ onBarcodeScanned }: { onBarcodeScanned: (event: { data: string }) => void }) =>
      React.createElement(
        Pressable,
        {
          accessibilityLabel: 'mock-camera',
          accessibilityRole: 'button',
          onPress: () => onBarcodeScanned({ data: mockCameraState.data }),
        },
        React.createElement(Text, null, 'camera'),
      ),
  }
})

async function renderSheet(onScanned = jest.fn(), visible = true) {
  const i18n = await initMobileI18n('en')
  const view = await render(
    <I18nextProvider i18n={i18n}>
      <ScanPairingQr onClose={jest.fn()} onScanned={onScanned} visible={visible} />
    </I18nextProvider>,
  )
  return { onScanned, view }
}

describe('ScanPairingQr', () => {
  beforeEach(() => {
    mockCameraState.granted = true
    mockCameraState.requestPermission.mockClear()
    mockCameraState.data = 'wondermoney://pair?server=https%3A%2F%2Fapi.example.test&code=abcdefghijklmnop'
  })

  it('hands a scanned pairing code to the caller', async () => {
    const { onScanned, view } = await renderSheet()

    await fireEvent.press(view.getByLabelText('mock-camera'))

    expect(onScanned).toHaveBeenCalledWith({ code: 'abcdefghijklmnop', server: 'https://api.example.test' })
  })

  it('keeps scanning after a code that is not a pairing code', async () => {
    mockCameraState.data = 'https://example.test/not-a-pairing-code'
    const { onScanned, view } = await renderSheet()

    await fireEvent.press(view.getByLabelText('mock-camera'))

    expect(onScanned).not.toHaveBeenCalled()
    expect(view.getByText("That isn't a WonderMoney pairing code.")).toBeOnTheScreen()

    mockCameraState.data = 'wondermoney://pair?server=https%3A%2F%2Fapi.example.test&code=abcdefghijklmnop'
    await fireEvent.press(view.getByLabelText('mock-camera'))
    expect(onScanned).toHaveBeenCalledTimes(1)
  })

  it('accepts only the first code, however often the scanner reports it', async () => {
    const { onScanned, view } = await renderSheet()

    await fireEvent.press(view.getByLabelText('mock-camera'))
    await fireEvent.press(view.getByLabelText('mock-camera'))

    expect(onScanned).toHaveBeenCalledTimes(1)
  })

  it('asks for camera access when it has not been granted', async () => {
    mockCameraState.granted = false
    const { view } = await renderSheet()

    expect(view.queryByLabelText('mock-camera')).not.toBeOnTheScreen()
    await fireEvent.press(view.getByRole('button', { name: 'Allow camera' }))
    expect(mockCameraState.requestPermission).toHaveBeenCalledTimes(1)
  })
})
