import { renderHook } from '@testing-library/react-native'
import type { AppStateStatus } from 'react-native'

import { useReturnFromBrowser } from '../use-return-from-browser'

function fakeSubscribe() {
  let handler: ((state: AppStateStatus) => void) | null = null
  const remove = jest.fn()
  const subscribe = (onChange: (state: AppStateStatus) => void) => {
    handler = onChange
    return { remove }
  }
  return { emit: (state: AppStateStatus) => handler?.(state), remove, subscribe }
}

describe('useReturnFromBrowser', () => {
  it('fires onReturn when the app becomes active while armed', async () => {
    const onReturn = jest.fn()
    const { emit, subscribe } = fakeSubscribe()
    const hook = await renderHook(() => useReturnFromBrowser(true, onReturn, subscribe))
    emit('active')
    expect(onReturn).toHaveBeenCalledTimes(1)
    await hook.unmount()
  })

  it('does not subscribe while disarmed', async () => {
    const onReturn = jest.fn()
    const { emit, subscribe } = fakeSubscribe()
    const hook = await renderHook(() => useReturnFromBrowser(false, onReturn, subscribe))
    emit('active')
    expect(onReturn).not.toHaveBeenCalled()
    await hook.unmount()
  })

  it('ignores background/inactive transitions', async () => {
    const onReturn = jest.fn()
    const { emit, subscribe } = fakeSubscribe()
    const hook = await renderHook(() => useReturnFromBrowser(true, onReturn, subscribe))
    emit('background')
    emit('inactive')
    expect(onReturn).not.toHaveBeenCalled()
    await hook.unmount()
  })

  it('removes the subscription when disarmed or unmounted', async () => {
    const onReturn = jest.fn()
    const { remove, subscribe } = fakeSubscribe()
    const hook = await renderHook((props: { armed: boolean }) => useReturnFromBrowser(props.armed, onReturn, subscribe), { initialProps: { armed: true } })
    await hook.rerender({ armed: false })
    expect(remove).toHaveBeenCalledTimes(1)
    await hook.unmount()
  })
})
