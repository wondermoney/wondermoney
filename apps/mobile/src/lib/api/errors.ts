export type ApiErrorCode =
  | 'demo-forbidden'
  | 'email-verification-required'
  | 'ai-allowance-exhausted'
  | 'portfolio-link-held'
  | 'auth-session'
  | 'mfa-required'
  | 'cancelled'
  | 'invalid-response'
  | 'network'
  | 'http'

export type WriteDispatchState = 'pre-dispatch' | 'post-dispatch'

export type ApiErrorOptions = Readonly<{
  writeDispatchState?: WriteDispatchState
  /** `portfolio-link-held` only: the display name of the member who holds the link. */
  linkedBy?: string
}>

const diagnosticMessages: Record<ApiErrorCode, string> = {
  'demo-forbidden': 'This action is unavailable in demo mode.',
  'email-verification-required': 'This action requires a verified email address.',
  'ai-allowance-exhausted': "Today's allowance for this AI feature is used up.",
  'portfolio-link-held': 'The portfolio is linked to an account only the other household member can see.',
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
  /**
   * `portfolio-link-held` only: who holds the link, for "Already linked by {name}". The one value
   * from a response body this boundary keeps. It is non-enumerable and never in the message, so
   * an error report that serializes the error's own fields does not carry a member's name.
   */
  readonly linkedBy?: string

  constructor(code: ApiErrorCode, status?: number, options?: ApiErrorOptions) {
    super(diagnosticMessages[code])
    this.name = 'ApiError'
    this.code = code
    if (status !== undefined) this.status = status
    if (options?.writeDispatchState !== undefined) this.writeDispatchState = options.writeDispatchState
    if (options?.linkedBy !== undefined) Object.defineProperty(this, 'linkedBy', { value: options.linkedBy, enumerable: false, configurable: true })
  }
}

export const isPostDispatchCancellation = (error: unknown): error is ApiError & { writeDispatchState: 'post-dispatch' } => (
  error instanceof ApiError
  && error.code === 'cancelled'
  && error.writeDispatchState === 'post-dispatch'
)
