/**
 * Capture raw full-page product screenshots for the docs site (RAD-427).
 *
 * Companion to `scripts/crop-screens.ts`: this script drives the browser and
 * writes full-page PNGs into `dogfood-output/docs-screens/<section>/`, which the
 * crop script then slices into `docs-new/public/images/docs/<section>/`.
 *
 * Usage:
 *   yarn tsx scripts/capture-screens.ts [--section <section-slug|all>] [--skip-existing]
 *
 * Per-section capture configs live in `scripts/captures/<section>.yaml`.
 * The default `--section` is `all` (every YAML under `scripts/captures/`).
 *
 * All agent-browser invocations go through `npx -y agent-browser@0.33.2`
 * (the Volta-installed binary is broken in this environment). Each section runs
 * in its own named session (`docs-screens-<section>`). Captures are idempotent:
 * existing PNGs are overwritten, or skipped entirely with `--skip-existing`.
 * A per-page failure is collected and reported at the end; the exit code is
 * non-zero when any page failed.
 *
 * Environment adaptations discovered while writing this (all best-effort):
 * - `react-scan` / `react-grab` dev overlays are network-routed to abort so they
 *   cannot cover buttons (they intermittently broke `auth login` and clicks).
 * - The first-run onboarding flag is set in localStorage after login so
 *   authenticated pages do not redirect to `/en/onboarding/welcome` (the
 *   redirect gate races the accounts fetch on a fresh session).
 */
import { spawn } from 'node:child_process';
import { copyFile, mkdir, open, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { load as loadYamlRaw } from 'js-yaml';

const AGENT_BROWSER = 'agent-browser@0.33.2';

/** Workspace root (the directory that owns `dogfood-output/`). */
const ROOT = path.resolve(__dirname, '../..');
/** Per-section capture configs. */
const CAPTURES_DIR = path.resolve(__dirname, 'captures');
/** Raw screenshot output root (mirrors the crop script's RAW_ROOT). */
const RAW_ROOT = (locale: string) => path.resolve(ROOT, 'dogfood-output/docs-screens' + (locale === 'en' ? '' : `/${locale}`));
/** CSS viewport 1440x900 at device-scale-factor 2 → 2880x1800 PNGs. */
const VIEWPORT = '1440 900 2';

const DEFAULT_WAIT_TIMEOUT_MS = 15_000;
const DEFAULT_SETTLE_MS = 1_200;
const LOGIN_ATTEMPTS = 3;
/** Pause between agent-browser invocations — the local daemon wedges under
 *  rapid sequential spawns, so commands are deliberately throttled. */
const COMMAND_INTERVAL_MS = 200;

/**
 * First-run onboarding flag. Setting the unscoped key to a completed state makes
 * the redirect gate in `web/components/onboarding/first-run/FirstRunOnboardingRedirectGate.tsx`
 * a no-op (`shouldShowFirstRunOnboarding()` reads localStorage status).
 */
const ONBOARDING_COMPLETE_JS =
  "localStorage.setItem('wondermoney:first-run-onboarding:v1', JSON.stringify({status:'completed', currentStep:'completion'}));";

/** Remove the react-scan floating widget if it somehow still loaded. */
const REMOVE_REACT_SCAN_JS =
  'document.getElementById("react-scan-root")?.remove();';

/* ----------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------- */

interface CaptureAction {
  type: string;
  /**
   * Locale-specific override map for `click-role`/`click-text`/`wait-text`
   * actions whose `name`/`text` value is otherwise a hardcoded English
   * string (button labels, headings) that will not match the rendered UI
   * in other locales. Falls back to the English `name`/`text` value when
   * the current locale has no entry.
   */
  locales?: { pt?: string; es?: string };
  [key: string]: unknown;
}

/** Resolve the locale-specific override for an action's `name`/`text` field, falling back to English. */
function localizedActionValue(action: CaptureAction, field: 'name' | 'text', locale: string): string {
  const fallback = String(action[field]);
  if (locale !== 'pt' && locale !== 'es') return fallback;
  return action.locales?.[locale] ?? fallback;
}

interface PageSpec {
  slug: string;
  step: string;
  url: string;
  note?: string;
  /** Vault key override for this page (e.g. `docs-screens` for the MFA page). */
  user?: string;
  /** true/false force login on/off; default: off for /auth/* and :3100 pages. */
  login?: boolean;
  /** Final state anchor before the screenshot. */
  anchor?: { text?: string; url?: string; load?: string };
  /** Extra settle delay before the screenshot, in ms. */
  settleMs?: number;
  actions?: CaptureAction[];
}

interface SectionSpec {
  section: string;
  /** Default auth vault key for the section. */
  user?: string;
  pages: PageSpec[];
}

type PageStatus = 'captured' | 'reused' | 'skipped' | 'failed';

interface PageOutcome {
  status: PageStatus;
  outputPath: string;
  error?: string;
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/* ----------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------- */

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** Track which vault user the current session is logged in as. */
const currentUser: { value?: string } = {};

/** Read PNG width/height from the IHDR chunk (no deps). */
async function pngSize(file: string): Promise<{ width: number; height: number } | null> {
  const fd = await open(file, 'r');
  try {
    const buf = Buffer.alloc(24);
    const { bytesRead } = await fd.read(buf, 0, 24, 0);
    if (bytesRead < 24) return null;
    if (buf.readUInt32BE(0) !== 0x89504e47) return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  } finally {
    await fd.close();
  }
}

async function fileKb(file: string): Promise<string> {
  try {
    const s = await (await import('node:fs/promises')).stat(file);
    return `${Math.max(1, Math.round(s.size / 1024))} KB`;
  } catch {
    return '? KB';
  }
}

/** Create `path` with `content` only when it does not already exist. */
async function ensureFile(filePath: string, content: string): Promise<void> {
  if (existsSync(filePath)) return;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
  console.log(`      created ${filePath}`);
}

/** Resolve a config-relative path against the workspace root. */
function resolveRootPath(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(ROOT, p);
}

/* ----------------------------------------------------------------------------
 * agent-browser command runner
 * ------------------------------------------------------------------------- */

function runAgent(
  session: string,
  args: string[],
  opts: { timeoutMs?: number; input?: string; noSession?: boolean } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    const fullArgs = opts.noSession
      ? ['-y', AGENT_BROWSER, ...args]
      : ['-y', AGENT_BROWSER, '--session', session, ...args];
    const child = spawn('npx', fullArgs, {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));

    const timer = setTimeout(() => {
      if (!settled) child.kill('SIGKILL');
    }, opts.timeoutMs ?? 120_000);

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout: stdout.trim(), stderr: stderr.trim() });
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `spawn error: ${err.message}` });
    });

    if (opts.input !== undefined) child.stdin.write(opts.input);
    child.stdin.end();
  });
}

/**
 * Strip benign npm/npx noise from stderr so real agent-browser errors surface.
 * npm prints "warn Unknown env config ..." lines on every invocation here.
 */
function cleanAgentError(stderr: string, stdout: string): string {
  const lines = (stderr || stdout)
    .split('\n')
    .filter((l) => !/^npm warn/i.test(l))
    .join('\n')
    .trim();
  return lines || 'no error output';
}

/** Heuristic: the daemon is busy/wedged and the command should be retried. */
function isDaemonIssue(res: RunResult): boolean {
  const text = `${res.stderr} ${res.stdout}`;
  return (
    text.includes('Resource temporarily unavailable') ||
    text.includes('daemon may be busy or unresponsive') ||
    text.includes('Failed to connect') ||
    text.includes('ECONNREFUSED') ||
    text.includes('AgentBrowserError')
  );
}

/**
 * Run a command that must succeed. Retries the whole command for transient
 * "covered by overlay" / daemon-busy hiccups; waits are NOT retried (a timed-out
 * wait is a genuine state failure). A short pause between invocations keeps the
 * local agent-browser daemon from wedging under rapid sequential spawns.
 */
async function runAgentChecked(
  session: string,
  args: string[],
  opts: { timeoutMs?: number; input?: string; retries?: number } = {},
): Promise<RunResult> {
  await delay(COMMAND_INTERVAL_MS);
  const attempts = opts.retries ?? 1;
  let last: RunResult | null = null;
  for (let i = 0; i < attempts; i++) {
    const res = await runAgent(session, args, opts);
    if (res.code === 0) return res;
    last = res;
    if (i + 1 < attempts) {
      await delay(800 * (i + 1) + (isDaemonIssue(res) ? 1_500 : 0));
    }
  }
  const detail = last ? cleanAgentError(last.stderr, last.stdout) : 'no result';
  throw new Error(`agent-browser ${args[0] ?? '(cmd)'} failed: ${truncate(detail, 320)}`);
}

/* ----------------------------------------------------------------------------
 * Session setup / login
 * ------------------------------------------------------------------------- */

async function createSession(section: string): Promise<string> {
  const res = await runAgent(section, ['session', 'id', '--scope', 'worktree', '--prefix', `docs-screens-${section}`], {
    timeoutMs: 30_000,
    noSession: true,
  });
  const session = res.stdout.trim().split(/\s+/).pop() ?? `docs-screens-${section}`;
  console.log(`[${section}] session ${session}`);

  // Ensure a clean slate if a previous run left this session alive.
  await runAgent(session, ['close'], { timeoutMs: 30_000 }).catch(() => {});
  // Block the dev-overlay scripts so they cannot cover buttons (react-scan
  // intermittently swallowed the auth submit / click coordinates).
  await runAgent(session, ['network', 'route', '**/react-scan**', '--abort'], { timeoutMs: 30_000 }).catch(() => {});
  await runAgent(session, ['network', 'route', '**/react-grab**', '--abort'], { timeoutMs: 30_000 }).catch(() => {});
  // Launch the browser and set the Retina capture viewport.
  await runAgentChecked(session, ['open', 'about:blank'], { timeoutMs: 60_000 });
  await runAgentChecked(session, ['set', 'viewport', ...VIEWPORT.split(' ')], { timeoutMs: 30_000 });
  return session;
}

async function applyPostLoginFixes(session: string): Promise<void> {
  await runAgent(session, ['eval', '--stdin'], { input: ONBOARDING_COMPLETE_JS, timeoutMs: 30_000 }).catch(() => {});
  await runAgent(session, ['eval', '--stdin'], { input: REMOVE_REACT_SCAN_JS, timeoutMs: 30_000 }).catch(() => {});
}

async function login(session: string, user: string, section: string): Promise<void> {
  let lastError = '';
  for (let attempt = 1; attempt <= LOGIN_ATTEMPTS; attempt++) {
    const res = await runAgent(session, ['auth', 'login', user], { timeoutMs: 120_000 });
    if (res.code === 0) {
      await applyPostLoginFixes(session);
      return;
    }
    lastError = cleanAgentError(res.stderr, res.stdout) || `exit ${res.code}`;
    // Clear cookies so the retry sees a clean login form.
    await runAgent(session, ['cookies', 'clear'], { timeoutMs: 30_000 }).catch(() => {});
    await delay(1_200 * attempt);
  }
  throw new Error(`auth login failed for vault '${user}' (${section}): ${truncate(lastError, 320)}`);
}

function needsLogin(page: PageSpec, section: SectionSpec): boolean {
  if (page.login === false || !section.user) return false;
  if (page.login === true) return true;
  try {
    const u = new URL(page.url);
    if (u.port === '3100') return false; // docs shell, no app auth
    if (u.pathname.includes('/auth/')) return false; // public auth pages
  } catch {
    /* fall through to default */
  }
  return true;
}

/* ----------------------------------------------------------------------------
 * Placeholder resolution (<portfolioId>, <creditId>)
 * ------------------------------------------------------------------------- */

async function resolveFirstId(session: string, origin: string, listPath: string, hrefMarker: string): Promise<string | null> {
  await runAgent(session, ['open', `${origin}${listPath}`], { timeoutMs: 60_000 }).catch(() => {});
  await runAgent(session, ['wait', '--load', 'networkidle', '--timeout', String(DEFAULT_WAIT_TIMEOUT_MS)], { timeoutMs: 60_000 }).catch(() => {});
  await delay(1_000);
  const script = `(() => {
    const a = document.querySelector('a[href*="${hrefMarker}"]');
    if (!a) return null;
    const href = a.getAttribute('href') || '';
    const parts = href.split("${hrefMarker}");
    const raw = parts.length > 1 ? parts[parts.length - 1] : href;
    return (raw.split('?')[0] || '').replace(/\\/$/, '') || null;
  })()`;
  const res = await runAgent(session, ['eval', '--stdin'], { input: script, timeoutMs: 30_000 });
  const raw = res.stdout.trim();
  if (!raw || raw === 'null') return null;
  return raw.replace(/["\\]/g, '').trim() || null;
}

async function substitutePlaceholders(session: string, url: string, origin: string): Promise<string> {
  let out = url;
  if (url.includes('<portfolioId>')) {
    const id = await resolveFirstId(session, origin, '/en/portfolio', '/portfolio/');
    if (id) out = out.replaceAll('<portfolioId>', id);
  }
  if (url.includes('<creditId>')) {
    const id = await resolveFirstId(session, origin, '/en/credits', '/credits/');
    if (id) out = out.replaceAll('<creditId>', id);
  }
  return out;
}

/* ----------------------------------------------------------------------------
 * Actions
 * ------------------------------------------------------------------------- */

async function runAction(session: string, action: CaptureAction, ctx: { url: string; origin: string; locale: string }): Promise<void> {
  switch (action.type) {
    case 'open': {
      const target = await substitutePlaceholders(session, String(action.url), ctx.origin);
      await runAgentChecked(session, ['open', target], { timeoutMs: 60_000, retries: 2 });
      await runAgentChecked(session, ['wait', '--load', 'networkidle', '--timeout', String(DEFAULT_WAIT_TIMEOUT_MS)], { timeoutMs: 60_000 });
      return;
    }
    case 'click-role': {
      const name = localizedActionValue(action, 'name', ctx.locale);
      const args = ['find', 'role', String(action.role ?? 'button'), 'click', '--name', name];
      if (action.exact) args.push('--exact');
      await runAgentChecked(session, args, { timeoutMs: 45_000, retries: 2 });
      return;
    }
    case 'click-text': {
      const text = localizedActionValue(action, 'text', ctx.locale);
      const args = ['find', 'text', text, 'click'];
      if (action.exact) args.push('--exact');
      await runAgentChecked(session, args, { timeoutMs: 45_000, retries: 2 });
      return;
    }
    case 'click-ref': {
      await runAgentChecked(session, ['click', String(action.selector)], { timeoutMs: 45_000, retries: 2 });
      return;
    }
    case 'click-first': {
      await runAgentChecked(session, ['find', 'first', String(action.selector), 'click'], { timeoutMs: 45_000, retries: 2 });
      return;
    }
    case 'fill': {
      await runAgentChecked(session, ['fill', String(action.ref), String(action.value)], { timeoutMs: 45_000 });
      return;
    }
    case 'wait-text': {
      const text = localizedActionValue(action, 'text', ctx.locale);
      await runAgentChecked(session, ['wait', '--text', text, '--timeout', String(action.timeout ?? DEFAULT_WAIT_TIMEOUT_MS)], { timeoutMs: 60_000 });
      return;
    }
    case 'wait-url': {
      await runAgentChecked(session, ['wait', '--url', String(action.pattern), '--timeout', String(action.timeout ?? DEFAULT_WAIT_TIMEOUT_MS)], { timeoutMs: 60_000 });
      return;
    }
    case 'wait-load': {
      const args = ['wait', '--load', String(action.state ?? 'networkidle')];
      if (action.timeout) args.push('--timeout', String(action.timeout));
      await runAgentChecked(session, args, { timeoutMs: 60_000 });
      return;
    }
    case 'eval': {
      await runAgentChecked(session, ['eval', '--stdin'], { input: String(action.script), timeoutMs: 45_000 });
      return;
    }
    case 'set-local-storage': {
      const raw = action.value;
      const value = typeof raw === 'string' ? raw : JSON.stringify(raw);
      const script = `localStorage.setItem(${JSON.stringify(String(action.key))}, ${JSON.stringify(value)});`;
      await runAgentChecked(session, ['eval', '--stdin'], { input: script, timeoutMs: 45_000 });
      return;
    }
    case 'create-file': {
      await ensureFile(String(action.path), String(action.content ?? ''));
      return;
    }
    case 'upload-file': {
      const filePath = String(action.path ?? '/tmp/malformed.csv');
      await ensureFile(filePath, String(action.content ?? 'foo,bar,baz'));
      await runAgentChecked(session, ['upload', String(action.ref), filePath], { timeoutMs: 45_000 });
      return;
    }
    case 'reuse':
      return; // handled at page level before capture
    default:
      throw new Error(`unknown action type "${action.type}" (page ${ctx.url})`);
  }
}

/* ----------------------------------------------------------------------------
 * Page capture
 * ------------------------------------------------------------------------- */

async function capturePage(session: string, section: SectionSpec, page: PageSpec, skipExisting: boolean, locale: string): Promise<PageOutcome> {
  const user = page.user ?? section.user;
  const rawRoot = RAW_ROOT(locale);
  const outputPath = path.join(rawRoot, section.section, `${page.slug}-${page.step}.png`);
  const reuse = page.actions?.find((a) => a.type === 'reuse');

  if (skipExisting && existsSync(outputPath)) {
    return { status: 'skipped', outputPath };
  }

  await mkdir(path.dirname(outputPath), { recursive: true });

  if (reuse) {
    const from = resolveRootPath(String(reuse.from));
    if (!existsSync(from)) {
      return { status: 'failed', outputPath, error: `reuse source missing: ${from}` };
    }
    await copyFile(from, outputPath);
    return { status: 'reused', outputPath };
  }

  const origin = (() => {
    try {
      return new URL(page.url).origin;
    } catch {
      return 'http://localhost:60637';
    }
  })();

  try {
    // Ensure the right user is logged in (login if not already).
    if (needsLogin(page, section) && user) {
      if (currentUser.value && currentUser.value !== user) {
        // Switching users: clear cookies so `auth login` sees a clean form.
        await runAgent(session, ['cookies', 'clear'], { timeoutMs: 30_000 }).catch(() => {});
      }
      if (currentUser.value !== user) {
        await login(session, user, section.section);
        currentUser.value = user;
      }
    }

    const url = await substitutePlaceholders(session, rewriteLocale(page.url, locale), origin);
    await runAgentChecked(session, ['open', url], { timeoutMs: 60_000 });
    await runAgentChecked(session, ['wait', '--load', 'networkidle', '--timeout', String(DEFAULT_WAIT_TIMEOUT_MS)], { timeoutMs: 60_000 });

    // Pre-screenshot actions (login-if-not-already, clicks, fills, waits, evals).
    for (const action of page.actions ?? []) {
      await runAction(session, action, { url, origin, locale });
    }

    // Page anchor — confirm the target state rendered.
    if (page.anchor?.text) {
      await runAgentChecked(session, ['wait', '--text', page.anchor.text, '--timeout', String(DEFAULT_WAIT_TIMEOUT_MS)], { timeoutMs: 60_000 });
    } else if (page.anchor?.url) {
      await runAgentChecked(session, ['wait', '--url', page.anchor.url, '--timeout', String(DEFAULT_WAIT_TIMEOUT_MS)], { timeoutMs: 60_000 });
    } else if (page.anchor?.load) {
      await runAgentChecked(session, ['wait', '--load', page.anchor.load, '--timeout', String(DEFAULT_WAIT_TIMEOUT_MS)], { timeoutMs: 60_000 });
    }

    // Let SPA content settle, then one final networkidle before the shot.
    await delay(page.settleMs ?? DEFAULT_SETTLE_MS);
    await runAgent(session, ['wait', '--load', 'networkidle', '--timeout', String(DEFAULT_WAIT_TIMEOUT_MS)], { timeoutMs: 60_000 });

    await runAgentChecked(session, ['screenshot', '--full', outputPath], { timeoutMs: 90_000 });
    return { status: 'captured', outputPath };
  } catch (err) {
    return { status: 'failed', outputPath, error: err instanceof Error ? err.message : String(err) };
  }
}

/* ----------------------------------------------------------------------------
 * Section orchestration
 * ------------------------------------------------------------------------- */

async function loadSections(sectionArg: string): Promise<SectionSpec[]> {
  if (sectionArg === 'all') {
    const files = (await readdir(CAPTURES_DIR)).filter((f) => /\.ya?ml$/.test(f)).sort();
    if (files.length === 0) {
      console.error(`No capture configs found in ${CAPTURES_DIR}`);
      process.exit(1);
    }
    const out: SectionSpec[] = [];
    for (const f of files) out.push(await loadYaml(path.join(CAPTURES_DIR, f)));
    return out;
  }
  const file = path.join(CAPTURES_DIR, `${sectionArg}.yaml`);
  if (!existsSync(file)) {
    console.error(`No capture config found for section "${sectionArg}" (expected ${file}).`);
    console.error('Valid sections: any <section>.yaml under scripts/captures/, or "all".');
    process.exit(1);
  }
  return [await loadYaml(file)];
}

async function loadYaml(file: string): Promise<SectionSpec> {
  const raw = await readFile(file, 'utf8');
  const parsed = loadYamlRaw(raw) as Partial<SectionSpec> | null;
  if (!parsed || !parsed.section || !Array.isArray(parsed.pages)) {
    console.error(`Invalid capture config: ${file} (missing "section" or "pages").`);
    process.exit(1);
  }
  return parsed as SectionSpec;
}

function printUsage(): void {
  console.log(`Usage: yarn tsx scripts/capture-screens.ts [--section <slug|all>] [--skip-existing] [--locale <en|pt|es>]

Captures full-page product screenshots for the docs site into
dogfood-output/docs-screens/<locale>/<section>/ using agent-browser@0.33.2.

Options:
  --section <slug|all>  Section to capture (default: all)
  --skip-existing       Skip pages whose output PNG already exists
  --locale <en|pt|es>   Locale to capture (default: en). Rewrites /en/ in URLs
                        and writes outputs to dogfood-output/docs-screens/<locale>/.
  --help                Show this help`);
}

function parseArgs(argv: string[]): { section: string; skipExisting: boolean; locale: string } {
  const args = argv.slice(2);
  let section = 'all';
  let skipExisting = false;
  let locale = 'en';
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--skip-existing') skipExisting = true;
    else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else if (arg.startsWith('--section=')) section = arg.slice('--section='.length) || 'all';
    else if (arg === '--section') section = args[i + 1] ?? 'all';
    else if (arg.startsWith('--locale=')) locale = arg.slice('--locale='.length) || 'en';
    else if (arg === '--locale') locale = args[i + 1] ?? 'en';
  }
  if (!['en', 'pt', 'es'].includes(locale)) {
    console.error(`Invalid locale "${locale}". Must be one of: en, pt, es.`);
    process.exit(1);
  }
  return { section, skipExisting, locale };
}

function rewriteLocale(url: string, locale: string): string {
  if (locale === 'en') return url;
  return url.replace(/\/en\//g, `/${locale}/`);
}

async function main(): Promise<void> {
  const { section: sectionArg, skipExisting, locale } = parseArgs(process.argv);
  const sections = await loadSections(sectionArg);

  const totals = { captured: 0, reused: 0, skipped: 0, failed: 0 };
  const failures: { section: string; page: string; error: string }[] = [];
  const rawRoot = path.join('dogfood-output/docs-screens' + (locale === 'en' ? '' : `/${locale}`));

  for (const section of sections) {
    const session = await createSession(section.section);
    console.log(`[${section.section}] ${section.pages.length} page(s), locale=${locale}, vault "${section.user ?? '(none)'}"`);

    const counts = { captured: 0, reused: 0, skipped: 0, failed: 0 };
    try {
      for (const page of section.pages) {
        const label = `${page.slug}/${page.step}`;
        const localizedUrl = rewriteLocale(page.url, locale);
        console.log(`[${section.section}] ${label} → ${localizedUrl}`);
        const outcome = await capturePage(session, section, page, skipExisting, locale);
        counts[outcome.status] += 1;

        if (outcome.status === 'captured') {
          const size = await pngSize(outcome.outputPath);
          const dims = size ? `${size.width}x${size.height}` : 'unknown size';
          console.log(`  ✓ captured ${path.relative(ROOT, outcome.outputPath)} (${dims}, ${await fileKb(outcome.outputPath)})`);
        } else if (outcome.status === 'reused') {
          console.log(`  ♻ reused  ${path.relative(ROOT, outcome.outputPath)}`);
        } else if (outcome.status === 'skipped') {
          console.log(`  - skipped ${path.relative(ROOT, outcome.outputPath)} (exists)`);
        } else {
          console.log(`  ✗ failed  ${path.relative(ROOT, outcome.outputPath)} — ${outcome.error}`);
          failures.push({ section: section.section, page: label, error: outcome.error ?? 'unknown error' });
        }
      }
    } finally {
      await runAgent(session, ['close'], { timeoutMs: 30_000 }).catch(() => {});
    }

    totals.captured += counts.captured;
    totals.reused += counts.reused;
    totals.skipped += counts.skipped;
    totals.failed += counts.failed;

    console.log(
      `[${section.section}] summary: ${counts.captured} captured · ${counts.reused} reused · ${counts.skipped} skipped · ${counts.failed} failed → ${path.join(rawRoot, section.section)}`,
    );
  }

  console.log('\n=== capture summary ===');
  console.log(`locale: ${locale} · sections: ${sections.length} · captured: ${totals.captured} · reused: ${totals.reused} · skipped: ${totals.skipped} · failed: ${totals.failed}`);
  if (failures.length > 0) {
    console.log('\nFailed pages:');
    for (const f of failures) console.log(`  - ${f.section}/${f.page}: ${f.error}`);
  }

  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
