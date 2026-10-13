import { render } from '@testing-library/react-native'
import { Text } from 'react-native'

import { AppErrorBoundary } from './app-error-boundary'

const mockCaptureError = jest.fn()
jest.mock('@/lib/telemetry/error-reporting', () => ({
  captureError: (error: unknown) => mockCaptureError(error),
}))

jest.mock('expo-splash-screen', () => ({ hideAsync: jest.fn(() => Promise.resolve()) }))

function Bomb(): never {
  throw new Error('boom')
}

describe('AppErrorBoundary', () => {
  beforeEach(() => mockCaptureError.mockReset())

  it('renders children when nothing throws', async () => {
    const view = await render(
      <AppErrorBoundary>
        <Text>hello</Text>
      </AppErrorBoundary>,
    )
    expect(view.getByText('hello')).toBeOnTheScreen()
    await view.unmount()
  })

  it('renders a fallback and reports the error instead of unmounting everything', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const view = await render(
      <AppErrorBoundary>
        <Bomb />
      </AppErrorBoundary>,
    )
    expect(view.getByText('Something went wrong')).toBeOnTheScreen()
    expect(view.getByText('boom')).toBeOnTheScreen()
    expect(mockCaptureError).toHaveBeenCalledWith(expect.objectContaining({ message: 'boom' }))
    consoleError.mockRestore()
    await view.unmount()
  })
})
