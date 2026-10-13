import { type ReactNode, useEffect, useLayoutEffect, useRef } from 'react'

import { useProductRuntime } from './product-runtime-provider'

export function AuthenticatedRouteBoundary({ children }: { children: ReactNode }) {
  const {
    routeState,
    registerAuthenticatedBoundary,
    acknowledgeDeactivation,
  } = useProductRuntime()
  const registration = useRef<ReturnType<typeof registerAuthenticatedBoundary> | null>(null)

  useLayoutEffect(() => {
    const current = registerAuthenticatedBoundary()
    registration.current = current
    return () => { current.unregisterLayout() }
  }, [registerAuthenticatedBoundary])
  useEffect(() => {
    const current = registration.current
    return () => {
      // Passive deletion cleanup runs after descendant passive/query cleanup.
      // Defer acknowledgement one microtask so the entire traversal completes.
      queueMicrotask(() => {
        current?.completePassiveUnmount()
        acknowledgeDeactivation()
      })
    }
  }, [acknowledgeDeactivation])
  useEffect(() => {
    if (routeState.status === 'deactivating') acknowledgeDeactivation()
  }, [acknowledgeDeactivation, routeState.status])

  return routeState.status === 'authenticated' ? children : null
}
