#!/usr/bin/env node
// The landing build's daily data step: refreshes the two daily snapshots before `astro build`.
//
//   fuel stations  scripts/build-fuel-stations.mjs  (DGEG station prices)
//   gold price     scripts/build-gold-price.mjs     (NBP gold price, ECB euro rate)
//
// The production site is rebuilt once a day by .github/workflows/landing-daily-deploy.yml, which
// calls a Vercel deploy hook, so each production build carries that day's prices. Each refresh
// fetches its source once, validates the whole response and writes only after it passed. When a
// fetch or a check fails, this step logs a warning and leaves that snapshot's committed files as
// they are: the build goes on and the page shows the older snapshot with its own (older) date.
// This step never fails the build.
//
// It fetches only for production builds (VERCEL_ENV=production) or when asked, so preview, CI and
// local builds use the committed snapshots and do not call the sources:
//
//   LANDING_DAILY_SNAPSHOTS=1   fetch in any build          LANDING_DAILY_SNAPSHOTS=0   never fetch
//   LANDING_SNAPSHOT_FETCH_FAIL=1   make every fetch fail, to check the fallback
//
// Station names and streets are written only inside a Vercel build (VERCEL=1), never into files
// that could be committed (scripts/build-fuel-stations.mjs explains why).
//
//   node scripts/build-daily-snapshots.mjs [--force]   (--force fetches whatever the environment)

import { fileURLToPath } from "node:url";
import * as fuelStations from "./build-fuel-stations.mjs";
import * as goldPrice from "./build-gold-price.mjs";

/**
 * Whether station names and streets may be written: only inside a Vercel build (VERCEL=1), whose
 * checkout is thrown away. Anywhere else the files may be committed, so they are redacted.
 */
export function keepStationNames(env) {
  return env.VERCEL === "1";
}

export const JOBS = [
  {
    name: "fuel stations (DGEG)",
    refresh: (fetchImpl, env) => fuelStations.refresh({ fetchImpl, redact: !keepStationNames(env) }),
    describe: (snapshot) => `prices to ${snapshot.newestUpdate}`,
  },
  {
    name: "gold price (NBP, ECB)",
    refresh: (fetchImpl) => goldPrice.refresh({ fetchImpl }),
    describe: (rows) => `price of ${rows.at(-1).date}`,
  },
];

/** Whether this build fetches: production, or LANDING_DAILY_SNAPSHOTS=1; never with =0. */
export function shouldFetch(env, { force = false } = {}) {
  if (force) return true;
  if (env.LANDING_DAILY_SNAPSHOTS === "0") return false;
  return env.LANDING_DAILY_SNAPSHOTS === "1" || env.VERCEL_ENV === "production";
}

const failingFetch = async () => {
  throw new Error("LANDING_SNAPSHOT_FETCH_FAIL is set: fetch disabled to check the fallback");
};

/**
 * Runs every job; a failed job keeps its committed snapshot. Returns one result per job and never
 * throws.
 */
export async function runDailySnapshots({ env = process.env, force = false, fetchImpl = fetch, jobs = JOBS, log = console } = {}) {
  if (!shouldFetch(env, { force })) {
    log.log("Daily snapshots: not a production build, using the committed fuel station and gold snapshots.");
    return [];
  }
  const fetcher = env.LANDING_SNAPSHOT_FETCH_FAIL === "1" ? failingFetch : fetchImpl;
  const results = [];
  for (const job of jobs) {
    try {
      const output = await job.refresh(fetcher, env);
      log.log(`Daily snapshots: refreshed ${job.name}, ${job.describe(output)}.`);
      results.push({ name: job.name, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn(`Daily snapshots: ${job.name} not refreshed (${message}). Keeping the committed snapshot and its date.`);
      results.push({ name: job.name, ok: false, error: message });
    }
  }
  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runDailySnapshots({ force: process.argv.includes("--force") });
}
