export interface DiagnosticCaptureClient {
  capture: (event: string, properties?: Record<string, unknown>) => void;
}

/** Diagnostic reporting is always best-effort and may not interrupt a user flow. */
export function safelyRunDiagnostic(diagnostic: () => void): void {
  try {
    diagnostic();
  } catch {
    // Diagnostics are deliberately fail-open.
  }
}

export function safePostHogCapture(
  client: DiagnosticCaptureClient | null | undefined,
  event: string,
  properties?: Record<string, unknown>,
): void {
  safelyRunDiagnostic(() => client?.capture(event, properties));
}

export function safeDiagnosticCaptureException(
  captureException: ((error: unknown) => unknown) | null | undefined,
  error: unknown,
): void {
  safelyRunDiagnostic(() => {
    captureException?.(error);
  });
}
