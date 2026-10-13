export type FoundationTelemetryEvent =
  | 'foundation_started'
  | 'foundation_ready'

export type FoundationTelemetryScreen = 'foundation_bootstrap'

export type Telemetry = Readonly<{
  capture: (event: FoundationTelemetryEvent) => void
  screen: (screen: FoundationTelemetryScreen) => void
}>

const capture = (_event: FoundationTelemetryEvent): void => undefined
const screen = (_screen: FoundationTelemetryScreen): void => undefined

export function createDisabledTelemetry(
  _options: Readonly<{ transport?: () => void }> = {},
): Telemetry {
  return Object.freeze({ capture, screen })
}

export const telemetry: Telemetry = createDisabledTelemetry()
