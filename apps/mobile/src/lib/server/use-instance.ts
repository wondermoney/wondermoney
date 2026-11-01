import { useQuery } from '@tanstack/react-query'

import { useServerSwitch } from '@/components/providers/server-switch-provider'

import { fetchInstance, type InstanceDescription } from './server-connection'

type Features = InstanceDescription['features']

/**
 * What the server the app currently talks to offers (`GET /v1/instance`). Public and stable for
 * the life of a deploy, so it is fetched once per server; the query key carries the server, so
 * switching servers asks the new one.
 */
function useInstance() {
  const apiBaseUrl = useServerSwitch()?.apiBaseUrl ?? null
  return useQuery({
    enabled: apiBaseUrl !== null,
    queryFn: async () => {
      const fetched = await fetchInstance(apiBaseUrl as string)
      if (fetched.status !== 'ok') throw new Error(`GET /v1/instance: ${fetched.status}`)
      return fetched.instance
    },
    queryKey: ['instance', apiBaseUrl],
    retry: 1,
    staleTime: Infinity,
  })
}

/**
 * True only once the server has said the feature is on, the same rule as the web app's
 * `useConfirmedFeature`. For controls that fail when used on a server without the feature (a
 * sign-in button that would error): while the description loads, when it can't be fetched, and
 * when a server predates the field, the control stays hidden. Briefly hiding it on a server that
 * has it is the lesser harm.
 */
export function useConfirmedFeature(select: (features: Features) => boolean | undefined): boolean {
  const { data } = useInstance()
  return data ? select(data.features) === true : false
}
