/**
 * Crop raw full-page screenshots into the docs public images directory.
 *
 * Raw captures live in `dogfood-output/docs-screens/<section>/` (gitignored)
 * at 2x device scale on a 1440x900 viewport. This script crops each to the
 * relevant UI bounds and writes the result to
 * `public/images/docs/<section>/<page-slug>-<step>.png`, which is what the MDX
 * `src="/images/docs/..."` references must point at.
 *
 * Usage:
 *   yarn tsx scripts/crop-screens.ts [--section <section-slug>]
 *
 * Defaults to every section. New screenshots add their entries to the CROPS map
 * below, keyed by `<section>/<page-slug>-<step>.png`. `--locale pt|es` reads
 * `dogfood-output/docs-screens/<locale>/` and writes `public/images/docs/<locale>/`.
 *
 * Crop bounds are in raw PNG pixel coordinates (2x scale). The cropped file
 * keeps the same scale; divide by 2 for the display size used in MDX.
 */
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

interface CropBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The whole 1440x900 viewport at 2x. */
const VIEWPORT: CropBounds = { x: 0, y: 0, width: 2880, height: 1800 };
/** Settings tabs without the sidebar: the main column starts at 248 CSS px. */
const SETTINGS_MAIN: CropBounds = { x: 496, y: 0, width: 2384, height: 1800 };
/**
 * Keep the whole capture. Used for element screenshots (a dialog, a settings section, a
 * household card), which the capture already cut to the element, and for full-page docs
 * captures. Their size differs by locale, so the bounds only cap it; the crop is clamped
 * to the image.
 */
const WHOLE: CropBounds = { x: 0, y: 0, width: 2880, height: 6000 };

/**
 * Crop bounds per screenshot, keyed by `<section>/<page-slug>-<step>.png`.
 */
const CROPS: Record<string, CropBounds> = {
  // start-here
  'start-here/index-overview.png': WHOLE,
  'start-here/create-account-signup-form.png': VIEWPORT,
  'start-here/sign-in-password-recovery-login.png': VIEWPORT,
  'start-here/sign-in-password-recovery-forgot-password.png': VIEWPORT,
  'start-here/multi-factor-authentication-otp.png': VIEWPORT,
  'start-here/understand-dashboard-overview.png': VIEWPORT,

  // accounts-transactions
  'accounts-transactions/index-accounts-overview.png': VIEWPORT,
  'accounts-transactions/connect-bank-account-bank-picker.png': VIEWPORT,
  'accounts-transactions/manual-offline-account-add-form.png': VIEWPORT,
  'accounts-transactions/manage-bank-connections-overview.png': VIEWPORT,
  'accounts-transactions/understand-transactions-list.png': VIEWPORT,
  'accounts-transactions/import-transactions-csv-import-modal.png': VIEWPORT,
  'accounts-transactions/categorize-transactions-category-picker.png': VIEWPORT,
  'accounts-transactions/recurring-payments-detected.png': VIEWPORT,
  'accounts-transactions/missing-duplicate-transactions-review.png': VIEWPORT,

  // budgets
  'budgets/index-overview.png': VIEWPORT,
  'budgets/create-first-budget-household.png': VIEWPORT,
  'budgets/create-first-budget-income.png': VIEWPORT,
  'budgets/household-size-dependents-dependents.png': VIEWPORT,
  'budgets/choose-budget-categories-categories.png': VIEWPORT,
  'budgets/track-monthly-spending-month-detail.png': VIEWPORT,
  'budgets/adjust-delete-budget-overflow-menu.png': VIEWPORT,

  // portfolio-investments
  'portfolio-investments/index-overview.png': VIEWPORT,
  'portfolio-investments/portfolio-metrics-explained-metrics.png': VIEWPORT,
  'portfolio-investments/create-portfolio-dialog.png': VIEWPORT,
  'portfolio-investments/add-portfolio-transactions-modal.png': VIEWPORT,
  'portfolio-investments/import-portfolio-csv-import-modal.png': VIEWPORT,
  'portfolio-investments/holdings-allocation-holdings.png': VIEWPORT,
  'portfolio-investments/performance-benchmarks-performance.png': VIEWPORT,
  'portfolio-investments/troubleshoot-portfolio-imports-error.png': VIEWPORT,
  'portfolio-investments/portfolio-data-lifecycle-transactions.png': VIEWPORT,

  // financial-markets (needs a market data provider: see capture-screens.ts)
  'financial-markets/index-overview.png': VIEWPORT,
  'financial-markets/search-stocks-etfs-ticker-quote.png': VIEWPORT,
  'financial-markets/watchlist-overview.png': VIEWPORT,

  // household
  'household/index-overview.png': VIEWPORT,
  'household/create-a-household-members.png': WHOLE,
  'household/invite-a-member-invite-form.png': WHOLE,
  'household/invite-a-member-pending.png': WHOLE,
  'household/join-a-household-invalid.png': WHOLE,
  'household/shared-context-shared-accounts.png': WHOLE,
  'household/leave-or-remove-leave-dialog.png': WHOLE,
  'household/leave-or-remove-remove-dialog.png': WHOLE,

  // settings-security-privacy
  'settings-security-privacy/index-overview.png': VIEWPORT,
  'settings-security-privacy/profile-preferences-profile.png': WHOLE,
  'settings-security-privacy/email-preferences-notifications.png': WHOLE,
  'settings-security-privacy/appearance-appearance.png': WHOLE,
  'settings-security-privacy/manage-categories-categories.png': SETTINGS_MAIN,
  'settings-security-privacy/assistant-settings-assistant.png': SETTINGS_MAIN,
  // The assistant panel slides in over the right third of the viewport.
  'settings-security-privacy/ai-assistant-consent-consent.png': { x: 1920, y: 0, width: 960, height: 1800 },
  'settings-security-privacy/change-password-change-password.png': WHOLE,
  'settings-security-privacy/two-factor-authentication-mfa.png': WHOLE,
  'settings-security-privacy/delete-account-delete-account.png': WHOLE,
  'settings-security-privacy/delete-account-confirm-dialog.png': WHOLE,
  'settings-security-privacy/data-privacy-connections.png': SETTINGS_MAIN,

  // troubleshooting
  'troubleshooting/index-overview.png': WHOLE,
  'troubleshooting/sign-in-problems-error-state.png': VIEWPORT,
  'troubleshooting/transaction-import-problems-error-state.png': VIEWPORT,
  'troubleshooting/budget-setup-problems-incomplete.png': VIEWPORT,
  'troubleshooting/portfolio-import-problems-error-state.png': VIEWPORT,

  // goals-loans
  'goals-loans/index-overview.png': VIEWPORT,
  'goals-loans/create-fund-goal-dialog.png': VIEWPORT,
  'goals-loans/create-fund-goal-debt-paydown.png': VIEWPORT,
  'goals-loans/link-accounts-goals-link-account.png': VIEWPORT,
  'goals-loans/link-accounts-goals-linked.png': VIEWPORT,
  'goals-loans/loans-overview-empty.png': VIEWPORT,
  'goals-loans/loans-overview-list.png': VIEWPORT,
  'goals-loans/add-loan-credit-facility-drawer.png': VIEWPORT,
  'goals-loans/track-repayments-detail.png': VIEWPORT,
  'goals-loans/track-repayments-link-repayment.png': VIEWPORT,
  'goals-loans/archived-and-restore-archive-dialog.png': VIEWPORT,
  'goals-loans/archived-and-restore-archived-list.png': VIEWPORT,
  'goals-loans/archived-and-restore-empty.png': VIEWPORT,
  'goals-loans/goal-priority-edit-form.png': VIEWPORT,
};

const RAW_ROOT = (locale: string) => path.resolve(__dirname, `../../dogfood-output/docs-screens${locale === 'en' ? '' : `/${locale}`}`);
const OUTPUT_ROOT = (locale: string) => path.resolve(__dirname, `../public/images/docs${locale === 'en' ? '' : `/${locale}`}`);

function parseArgs(argv: string[]): { section: string; locale: string } {
  let section = 'all';
  let locale = 'en';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--section=')) section = arg.slice('--section='.length) || 'all';
    else if (arg === '--section') section = argv[i + 1] ?? 'all';
    else if (arg.startsWith('--locale=')) locale = arg.slice('--locale='.length) || 'en';
    else if (arg === '--locale') locale = argv[i + 1] ?? 'en';
  }
  if (!['en', 'pt', 'es'].includes(locale)) {
    console.error(`Invalid locale "${locale}". Must be one of: en, pt, es.`);
    process.exit(1);
  }
  return { section, locale };
}

async function main(): Promise<void> {
  const { section, locale } = parseArgs(process.argv.slice(2));
  const rawRoot = RAW_ROOT(locale);
  const outputRoot = OUTPUT_ROOT(locale);
  const entries = Object.entries(CROPS).filter(([key]) => section === 'all' || key.startsWith(`${section}/`));

  if (entries.length === 0) {
    console.error(`No crop config found for section "${section}".`);
    process.exit(1);
  }

  if (section === 'all') {
    const sections = [...new Set(entries.map(([key]) => key.split('/')[0]))].sort();
    for (const s of sections) {
      await mkdir(path.join(outputRoot, s), { recursive: true });
    }
  } else {
    await mkdir(path.join(outputRoot, section), { recursive: true });
  }

  console.log(`locale=${locale}, section=${section}`);

  let cropped = 0;
  let skipped = 0;
  for (const [key, bounds] of entries) {
    const sourcePath = path.join(rawRoot, key);
    const outputPath = path.join(outputRoot, key);

    let sourceSize = 0;
    try {
      sourceSize = (await stat(sourcePath)).size;
    } catch {
      // Skip missing source — partial captures are valid (e.g. PT capture
      // missed pages whose action sequences used English button names).
      console.warn(`  - skipped (missing source): ${key}`);
      skipped += 1;
      continue;
    }

    await sharp(sourcePath)
      .metadata()
      .then(async (meta) => {
        // Clamp the extract area to the actual image dimensions so the crop
        // never fails when a raw capture is shorter than the crop config expects
        // (e.g. PT/ES captures that didn't trigger the inner scroll-container
        // expansion the EN captures did).
        const w = Math.min(bounds.width, meta.width - bounds.x);
        const h = Math.min(bounds.height, meta.height - bounds.y);
        if (w <= 0 || h <= 0) {
          console.warn(`  - skipped (bounds ${bounds.x},${bounds.y} ${bounds.width}x${bounds.height} outside image ${meta.width}x${meta.height}): ${key}`);
          return null;
        }
        return sharp(sourcePath)
          .extract({ left: bounds.x, top: bounds.y, width: w, height: h })
          .png({ compressionLevel: 9 })
          .toFile(outputPath);
      })
      .then(async (info) => {
        if (!info) return;
        const outputSize = (await stat(outputPath)).size;
        const savedKb = Math.max(0, Math.round((sourceSize - outputSize) / 1024));
        console.log(`  cropped ${key} → ${info.width}x${info.height} (saved ${savedKb} KB)`);
        cropped += 1;
      })
      .catch((err) => {
        console.error(`  - failed: ${key} — ${err instanceof Error ? err.message : String(err)}`);
      });
  }

  console.log(`summary: ${cropped} cropped · ${skipped} skipped`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
