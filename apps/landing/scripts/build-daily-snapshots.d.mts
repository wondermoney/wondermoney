export interface DailyJob {
  name: string;
  refresh: (fetchImpl: typeof fetch, env: Record<string, string | undefined>) => Promise<unknown>;
  describe: (output: never) => string;
}
export interface DailyResult {
  name: string;
  ok: boolean;
  error?: string;
}
export const JOBS: readonly DailyJob[];
export function keepStationNames(env: Record<string, string | undefined>): boolean;
export function shouldFetch(env: Record<string, string | undefined>, options?: { force?: boolean }): boolean;
export function runDailySnapshots(options?: {
  env?: Record<string, string | undefined>;
  force?: boolean;
  fetchImpl?: typeof fetch;
  jobs?: readonly DailyJob[];
  log?: Pick<Console, "log" | "warn">;
}): Promise<DailyResult[]>;
