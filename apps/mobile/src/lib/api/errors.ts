export type ApiErrorCode =
  | 'demo-forbidden'
  | 'auth-session'
  | 'mfa-required'
  | 'cancelled'
  | 'invalid-response'
  | 'network'
  | 'http'

export type WriteDispatchState = 'pre-dispatch' | 'post-dispatch'

export type ApiErrorOptions = Readonly<{
  writeDispatchState?: WriteDispatchState
}>

const diagnosticMessages: Record<ApiErrorCode, string> = {
  'demo-forbidden': 'This action is unavailable in demo mode.',
  'auth-session': 'The authenticated session could not be used.',
  'mfa-required': 'Multi-factor authentication is required.',
  cancelled: 'The operation was cancelled.',
  'invalid-response': 'The server response was invalid.',
  network: 'The network request failed.',
  http: 'The server request failed.',
}

/** A deliberately lossy error boundary: only classification and HTTP status survive. */
export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly status?: number
  readonly writeDispatchState?: WriteDispatchState

  constructor(code: ApiErrorCode, status?: number, options?: ApiErrorOptions) {
    super(diagnosticMessages[code])
    this.name = 'ApiError'
    this.code = code
    if (status !== undefined) this.status = status
    if (options?.writeDispatchState !== undefined) this.writeDispatchState = options.writeDispatchState
  }
}

export const isPostDispatchCancellation = (error: unknown): error is ApiError & { writeDispatchState: 'post-dispatch' } => (
  error instanceof ApiError
  && error.code === 'cancelled'
  && error.writeDispatchState === 'post-dispatch'
)
