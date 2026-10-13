import { captureError } from '@/lib/telemetry/error-reporting'

import type {
  TokenSnapshot,
  TokenSnapshotResult,
  TrustedUnauthorizedRecoveryResult,
} from '../auth/auth-recovery'
import {
  executeGuardedWrite,
  SessionOperationCancelledError,
  type SessionOperationLease,
  type SessionOperationScope,
} from '../auth/session-operation-scope'
import { ApiError } from './errors'
import type { WriteDispatchState } from './errors'
import {
  parseCommonErrorEnvelope,
  type ReadEndpoint,
  type ReadMethod,
  type WriteEndpoint,
  type WriteMethod,
} from './runtime-schema'

export type HttpRequest = Readonly<{
  method: ReadMethod | WriteMethod
  path: string
  headers: Readonly<Record<string, string>>
  body?: unknown
  signal: AbortSignal
  tokenGeneration: number
  authAttempt: 0 | 1
  /** Defaults to 'json' (the entire read/write contract) when omitted. 'text' opts a single
   * request out of JSON parsing — used only by readRaw, for endpoints like CSV export that don't
   * return JSON at all. */
  responseType?: 'json' | 'text'
}>

/** A read endpoint with no response schema — the caller gets the raw response text back
 * unparsed. For non-JSON endpoints (CSV export) that don't fit the schema-validated read/write
 * contract every other endpoint uses. */
export type RawReadEndpoint = Readonly<{
  method: ReadMethod
  path: string
}>

export type HttpResponse = Readonly<{
  status: number
  body: unknown
}>

export type HttpTransport = Readonly<{
  request: (request: HttpRequest) => Promise<HttpResponse>
}>

export type AuthRecoveryCoordinatorPort = Readonly<{
  getTokenSnapshot: () => Promise<TokenSnapshotResult>
  refreshAfterUnauthorized: (failedSnapshot: TokenSnapshot) => Promise<TokenSnapshotResult>
  recoverTrustedUnauthorized: () => Promise<TrustedUnauthorizedRecoveryResult>
}>

export type ApiClientDependencies = Readonly<{
  transport: HttpTransport
  authRecovery: AuthRecoveryCoordinatorPort
  operationScope: SessionOperationScope
}>

export type WriteOptions<Value> = Readonly<{
  body?: unknown
  commit: (value: Value) => void
}>

export type ApiClient = Readonly<{
  read: <Value>(endpoint: ReadEndpoint<Value>) => Promise<Value>
  write: <Value>(endpoint: WriteEndpoint<Value>, options: WriteOptions<Value>) => Promise<Value>
  readRaw: (endpoint: RawReadEndpoint) => Promise<string>
}>

const isCurrent = (scope: SessionOperationScope, lease: SessionOperationLease) => (
  !lease.signal.aborted && scope.isCurrent(lease)
)

const assertCurrent = (scope: SessionOperationScope, lease: SessionOperationLease) => {
  if (!isCurrent(scope, lease)) throw new ApiError('cancelled')
}


const throwTrustedAuthError = async (
  authRecovery: AuthRecoveryCoordinatorPort,
): Promise<never> => {
  let result: TrustedUnauthorizedRecoveryResult
  try {
    result = await authRecovery.recoverTrustedUnauthorized()
  } catch {
    throw new ApiError('auth-session', 401)
  }
  throw new ApiError(result.status === 'mfa-required' ? 'mfa-required' : 'auth-session', 401)
}

const responseBodyForSchema = (
  method: ReadMethod | WriteMethod,
  response: HttpResponse,
): unknown => method === 'HEAD' || response.status === 204 ? undefined : response.body

/**
 * RAD-517 — the app's only genuinely unexpected failure: the server answered
 * 2xx with a body the endpoint's own schema rejects, i.e. the API contract
 * drifted. Today that is invisible — it becomes the same generic failure state
 * as a dropped connection — which is exactly what crash/error reporting is for.
 *
 * What is reported is this app's own `ApiError`, whose message is a fixed string
 * per code with nothing interpolated into it. The Zod failure is deliberately
 * *not* reported: `ZodError.message` is a serialized dump of every issue,
 * including the received values, so on a drifting `/v1/accounts` it would carry
 * account names and balances into Sentry. Per the ADR that is a source-level
 * problem, not something `beforeSend` should be asked to rescue — so the unsafe
 * error simply never becomes the captured one.
 */
const parseSuccess = <Value>(
  endpoint: ReadEndpoint<Value> | WriteEndpoint<Value>,
  response: HttpResponse,
): Value => {
  try {
    const parsed = endpoint.schema.safeParse(responseBodyForSchema(endpoint.method, response))
    if (!parsed.success) throw new ApiError('invalid-response')
    return parsed.data
  } catch {
    const contractDrift = new ApiError('invalid-response')
    captureError(contractDrift)
    throw contractDrift
  }
}

const mapHttpFailure = (response: HttpResponse): never => {
  if (response.status === 403) {
    const envelope = parseCommonErrorEnvelope(response.body)
    if (envelope?.code === 'demo_read_only') throw new ApiError('demo-forbidden', 403)
  }
  throw new ApiError('http', response.status)
}

export const createApiClient = ({
  transport,
  authRecovery,
  operationScope,
}: ApiClientDependencies): ApiClient => {
  const dispatch = async (
    endpoint: ReadEndpoint<unknown> | WriteEndpoint<unknown> | RawReadEndpoint,
    snapshot: TokenSnapshot,
    signal: AbortSignal,
    authAttempt: 0 | 1,
    body?: unknown,
    responseType?: 'json' | 'text',
  ): Promise<HttpResponse> => {
    const request: HttpRequest = {
      method: endpoint.method,
      path: endpoint.path,
      headers: { Authorization: `Bearer ${snapshot.accessToken}` },
      ...(body === undefined ? {} : { body }),
      signal,
      tokenGeneration: snapshot.tokenGeneration,
      authAttempt,
      ...(responseType === undefined ? {} : { responseType }),
    }
    return transport.request(request)
  }

  const read = async <Value>(endpoint: ReadEndpoint<Value>): Promise<Value> => {
    const lease = operationScope.capture()
    assertCurrent(operationScope, lease)

    let initial: TokenSnapshotResult
    try {
      initial = await authRecovery.getTokenSnapshot()
    } catch {
      assertCurrent(operationScope, lease)
      throw new ApiError('auth-session')
    }
    assertCurrent(operationScope, lease)
    if (initial.status === 'unavailable') return throwTrustedAuthError(authRecovery)

    let response: HttpResponse
    try {
      response = await dispatch(endpoint, initial.snapshot, lease.signal, 0)
    } catch {
      assertCurrent(operationScope, lease)
      throw new ApiError('network')
    }
    assertCurrent(operationScope, lease)

    if (response.status === 401) {
      let refreshed: TokenSnapshotResult
      try {
        refreshed = await authRecovery.refreshAfterUnauthorized(initial.snapshot)
      } catch {
        assertCurrent(operationScope, lease)
        return throwTrustedAuthError(authRecovery)
      }
      assertCurrent(operationScope, lease)
      if (refreshed.status === 'unavailable') return throwTrustedAuthError(authRecovery)

      try {
        response = await dispatch(endpoint, refreshed.snapshot, lease.signal, 1)
      } catch {
        assertCurrent(operationScope, lease)
        throw new ApiError('network')
      }
      assertCurrent(operationScope, lease)
      if (response.status === 401) return throwTrustedAuthError(authRecovery)
    }

    if (response.status >= 200 && response.status < 300) return parseSuccess(endpoint, response)
    return mapHttpFailure(response)
  }

  const readRaw = async (endpoint: RawReadEndpoint): Promise<string> => {
    const lease = operationScope.capture()
    assertCurrent(operationScope, lease)

    let initial: TokenSnapshotResult
    try {
      initial = await authRecovery.getTokenSnapshot()
    } catch {
      assertCurrent(operationScope, lease)
      throw new ApiError('auth-session')
    }
    assertCurrent(operationScope, lease)
    if (initial.status === 'unavailable') return throwTrustedAuthError(authRecovery)

    let response: HttpResponse
    try {
      response = await dispatch(endpoint, initial.snapshot, lease.signal, 0, undefined, 'text')
    } catch {
      assertCurrent(operationScope, lease)
      throw new ApiError('network')
    }
    assertCurrent(operationScope, lease)

    if (response.status === 401) {
      let refreshed: TokenSnapshotResult
      try {
        refreshed = await authRecovery.refreshAfterUnauthorized(initial.snapshot)
      } catch {
        assertCurrent(operationScope, lease)
        return throwTrustedAuthError(authRecovery)
      }
      assertCurrent(operationScope, lease)
      if (refreshed.status === 'unavailable') return throwTrustedAuthError(authRecovery)

      try {
        response = await dispatch(endpoint, refreshed.snapshot, lease.signal, 1, undefined, 'text')
      } catch {
        assertCurrent(operationScope, lease)
        throw new ApiError('network')
      }
      assertCurrent(operationScope, lease)
      if (response.status === 401) return throwTrustedAuthError(authRecovery)
    }

    if (response.status >= 200 && response.status < 300) {
      return typeof response.body === 'string' ? response.body : ''
    }
    return mapHttpFailure(response)
  }

  const write = async <Value>(
    endpoint: WriteEndpoint<Value>,
    { body, commit }: WriteOptions<Value>,
  ): Promise<Value> => {
    let dispatchState: WriteDispatchState = 'pre-dispatch'
    try {
      return await executeGuardedWrite(
        operationScope,
        async (signal) => {
          if (signal.aborted) throw new SessionOperationCancelledError()
          let initial: TokenSnapshotResult
          try {
            initial = await authRecovery.getTokenSnapshot()
          } catch {
            throw new ApiError('auth-session')
          }
          if (signal.aborted) throw new SessionOperationCancelledError()
          if (initial.status === 'unavailable') return throwTrustedAuthError(authRecovery)

          let response: HttpResponse
          try {
            // From this point the transport may have delivered the unsafe write.
            dispatchState = 'post-dispatch'
            response = await dispatch(endpoint, initial.snapshot, signal, 0, body)
          } catch {
            if (signal.aborted) throw new SessionOperationCancelledError()
            throw new ApiError('network')
          }
          if (signal.aborted) throw new SessionOperationCancelledError()

          if (response.status === 401) {
            try {
              await authRecovery.refreshAfterUnauthorized(initial.snapshot)
            } catch {
              // Trusted recovery below remains the sole classifier for this 401.
            }
            if (signal.aborted) throw new SessionOperationCancelledError()
            return throwTrustedAuthError(authRecovery)
          }
          const accepted = endpoint.successStatuses
            ? endpoint.successStatuses.includes(response.status)
            : response.status >= 200 && response.status < 300
          if (accepted) return parseSuccess(endpoint, response)
          return mapHttpFailure(response)
        },
        commit,
      )
    } catch (error: unknown) {
      if (error instanceof SessionOperationCancelledError) {
        throw new ApiError('cancelled', undefined, { writeDispatchState: dispatchState })
      }
      throw error
    }
  }

  return { read, write, readRaw }
}
