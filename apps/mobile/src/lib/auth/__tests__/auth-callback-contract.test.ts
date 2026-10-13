import {
  createApiClient,
  type ApiClient,
  type AuthRecoveryCoordinatorPort,
  type HttpRequest,
  type HttpTransport,
} from '@/lib/api/client'

import { provisionAppUser } from '../provision-app-user'
import { createSessionOperationScope } from '../session-operation-scope'

const stubAuthRecovery: AuthRecoveryCoordinatorPort = {
  getTokenSnapshot: async () => ({
    status: 'available',
    snapshot: { accessToken: 'contract-test-access-token', tokenGeneration: 0 },
  }),
  refreshAfterUnauthorized: async () => ({ status: 'unavailable' }),
  recoverTrustedUnauthorized: async () => ({ status: 'auth-session' }),
}

describe('POST /v1/auth/callback contract', () => {
  it('sends POST /v1/auth/callback with Bearer auth and { locale }', async () => {
    const requests: HttpRequest[] = []
    const transport: HttpTransport = {
      request: async (request) => {
        requests.push(request)
        return { status: 200, body: { appuserKey: 1 } }
      },
    }
    const apiClient: ApiClient = createApiClient({
      transport,
      authRecovery: stubAuthRecovery,
      operationScope: createSessionOperationScope(),
    })

    const result = await provisionAppUser(apiClient, 'en')

    expect(result).toBe('provisioned')
    expect(requests).toHaveLength(1)
    expect(requests[0].method).toBe('POST')
    expect(requests[0].path).toBe('/v1/auth/callback')
    expect(requests[0].headers.Authorization).toMatch(/^Bearer /)
    expect(requests[0].body).toEqual({ locale: 'en' })
  })
})
