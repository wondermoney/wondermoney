import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const repoRoot = resolve(process.cwd());
const packageJsonPath = join(repoRoot, "package.json");
const nextConfigPath = join(repoRoot, "next.config.ts");
const cypressConfigPath = join(repoRoot, "cypress.config.ts");
const nodeModulesPath = join(repoRoot, "node_modules");
const envExamplePath = join(repoRoot, ".env.example");
// better-auth replaced Supabase: web now reaches the API through
// NEXT_PUBLIC_API_URL, and the specs authenticate against it with
// E2E_PORTFOLIO_IMPORT_* email+password credentials.
const requiredEnvVars = [
  "NEXT_PUBLIC_API_URL",
  "NEXT_PUBLIC_POSTHOG_KEY",
];

function info(message: string) {
  console.log(message);
}

function warn(message: string) {
  console.warn(`WARN: ${message}`);
}

function fail(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function redact(value: string | undefined) {
  if (!value) return "<missing>";
  return "<set>";
}

function checkExists(path: string, label: string) {
  if (!existsSync(path)) fail(`${label} missing at ${relative(repoRoot, path)}`);
}

function inspectNodeModules() {
  if (!existsSync(nodeModulesPath)) {
    warn("node_modules is missing; install dependencies before running E2E preflight.");
    return;
  }

  const link = lstatSync(nodeModulesPath);
  if (!link.isSymbolicLink()) {
    info("node_modules is a real directory inside this worktree.");
    return;
  }

  const target = realpathSync(nodeModulesPath);
  const targetRelative = relative(repoRoot, target) || ".";
  const outsideRepo = targetRelative === ".." || targetRelative.startsWith(`..${sep}`);

  if (outsideRepo) {
    warn(
      `node_modules resolves outside the worktree (${target}). Use pnpm dev:webpack for deterministic E2E in this worktree, or install dependencies locally to isolate it.`,
    );
    return;
  }

  info(`node_modules symlink resolves within repo: ${targetRelative}`);
}

function describePort(port: number) {
  try {
    const output = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

    if (!output) {
      info(`port ${port} appears available.`);
      return;
    }

    const lines = output.split("\n").slice(1);
    const owners = lines.map((line) => line.split(/\s+/)[0]).filter(Boolean);
    warn(`port ${port} is already listening (owners: ${owners.join(", ") || "unknown"}). Choose a different port if you do not own the listener.`);
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      status?: number;
      stdout?: string;
      stderr?: string;
    };
    const stderr = (err.stderr ?? "").trim();
    const stdout = (err.stdout ?? "").trim();
    if (err.status === 1 && !stderr && !stdout) {
      info(`port ${port} appears available.`);
      return;
    }
    if (stderr || stdout) {
      warn(`Could not safely inspect port ${port}; ensure it is free before running E2E.`);
      return;
    }
    warn(`Could not safely inspect port ${port}; ensure it is free before running E2E.`);
  }
}

function checkEnvVars() {
  info(`Checking required E2E env vars from ${relative(repoRoot, envExamplePath)} and current environment.`);
  for (const name of requiredEnvVars) {
    const current = process.env[name];
    if (current) {
      info(`- ${name}: set (${redact(current)})`);
    } else {
      warn(`- ${name}: missing`);
    }
  }

  const recaptchaBypass = process.env.E2E_BYPASS_RECAPTCHA ?? process.env.NEXT_PUBLIC_E2E_BYPASS_RECAPTCHA;
  if (recaptchaBypass) {
    info(`- E2E reCAPTCHA bypass: set (${redact(recaptchaBypass)})`);
  } else {
    warn("- E2E reCAPTCHA bypass: missing (needed for non-production automation, if enabled in your lane)");
  }
}

function main() {
  info(`Worktree E2E preflight in ${repoRoot}`);
  checkExists(packageJsonPath, "package.json");
  checkExists(nextConfigPath, "next.config.ts");
  checkExists(cypressConfigPath, "cypress.config.ts");
  inspectNodeModules();
  describePort(Number(process.env.E2E_WEB_PORT ?? 3000));
  describePort(Number(process.env.E2E_API_PORT ?? 3001));
  checkEnvVars();

  assert.ok(true, "preflight completed");
  info("Preflight checks completed.");
}

main();
