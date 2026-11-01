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
 * Defaults to the `start-here` section. Future sections add their entries to
 * the CROPS map below, keyed by `<section>/<page-slug>-<step>.png`.
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

/**
 * Crop bounds per screenshot, keyed by `<section>/<page-slug>-<step>.png`.
 */
const CROPS: Record<string, CropBounds> = {
  // glossary-landing
  'glossary-landing/index-overview.png': { x: 0, y: 0, width: 2850, height: 2742 },

  // start-here
  'start-here/index-overview.png': { x: 0, y: 0, width: 2850, height: 2742 },
  'start-here/create-account-signup-form.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'start-here/sign-in-password-recovery-login.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'start-here/sign-in-password-recovery-forgot-password.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'start-here/multi-factor-authentication-otp.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'start-here/connect-first-bank-account-bank-picker.png': { x: 0, y: 0, width: 2880, height: 2262 },
  'start-here/understand-dashboard-overview.png': { x: 0, y: 0, width: 2880, height: 1800 },

  // accounts-transactions
  'accounts-transactions/index-accounts-overview.png': { x: 0, y: 0, width: 2880, height: 2262 },
  'accounts-transactions/connect-bank-account-bank-picker.png': { x: 0, y: 0, width: 2880, height: 2262 },
  'accounts-transactions/manual-offline-account-add-form.png': { x: 0, y: 0, width: 2880, height: 2262 },
  'accounts-transactions/manage-bank-connections-overview.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'accounts-transactions/understand-transactions-list.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'accounts-transactions/import-transactions-csv-import-modal.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'accounts-transactions/categorize-transactions-category-picker.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'accounts-transactions/recurring-payments-detected.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'accounts-transactions/missing-duplicate-transactions-review.png': { x: 0, y: 0, width: 2880, height: 1800 },

  // budgets
  'budgets/index-overview.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'budgets/create-first-budget-household.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'budgets/create-first-budget-income.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'budgets/household-size-dependents-dependents.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'budgets/choose-budget-categories-categories.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'budgets/track-monthly-spending-month-detail.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'budgets/adjust-delete-budget-overflow-menu.png': { x: 0, y: 0, width: 2880, height: 1800 },

  // portfolio-investments
  'portfolio-investments/index-overview.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'portfolio-investments/portfolio-metrics-explained-metrics.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'portfolio-investments/create-portfolio-dialog.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'portfolio-investments/add-portfolio-transactions-modal.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'portfolio-investments/import-portfolio-csv-import-modal.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'portfolio-investments/holdings-allocation-holdings.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'portfolio-investments/performance-benchmarks-performance.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'portfolio-investments/troubleshoot-portfolio-imports-error.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'portfolio-investments/portfolio-data-lifecycle-transactions.png': { x: 0, y: 0, width: 2880, height: 1800 },

  // financial-markets
  'financial-markets/index-overview.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'financial-markets/search-stocks-etfs-ticker-quote.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'financial-markets/watchlist-overview.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'financial-markets/screener-overview.png': { x: 0, y: 0, width: 2880, height: 1800 },


  // household
  'household/index-overview.png': { x: 0, y: 0, width: 2880, height: 950 },
  'household/create-a-household-members.png': { x: 1354, y: 330, width: 1366, height: 195 },
  'household/invite-a-member-invite-form.png': { x: 1354, y: 596, width: 1366, height: 352 },
  'household/invite-a-member-pending.png': { x: 1354, y: 596, width: 1366, height: 170 },
  'household/account-privacy-privacy-toggle.png': { x: 2112, y: 40, width: 768, height: 760 },
  'household/join-a-household-invalid.png': { x: 1640, y: 860, width: 1010, height: 262 },
  'household/shared-context-shared-accounts.png': { x: 512, y: 980, width: 896, height: 330 },
  'household/leave-or-remove-leave-dialog.png': { x: 674, y: 724, width: 1532, height: 352 },
  'household/leave-or-remove-remove-dialog.png': { x: 674, y: 724, width: 1532, height: 352 },

  // settings-security-privacy
  'settings-security-privacy/index-overview.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'settings-security-privacy/profile-preferences-profile.png': { x: 448, y: 64, width: 2432, height: 836 },
  'settings-security-privacy/email-preferences-notifications.png': { x: 448, y: 64, width: 2432, height: 2084 },
  'settings-security-privacy/appearance-appearance.png': { x: 448, y: 64, width: 2432, height: 560 },
  'settings-security-privacy/manage-categories-categories.png': { x: 448, y: 160, width: 2432, height: 1800 },
  'settings-security-privacy/assistant-settings-assistant.png': { x: 448, y: 0, width: 2432, height: 1800 },
  'settings-security-privacy/ai-assistant-consent-consent.png': { x: 1900, y: 0, width: 980, height: 1800 },
  'settings-security-privacy/change-password-change-password.png': { x: 448, y: 160, width: 2432, height: 918 },
  'settings-security-privacy/two-factor-authentication-mfa.png': { x: 448, y: 1078, width: 2432, height: 490 },
  'settings-security-privacy/delete-account-delete-account.png': { x: 448, y: 1568, width: 2432, height: 608 },
  'settings-security-privacy/delete-account-confirm-dialog.png': { x: 600, y: 640, width: 1680, height: 520 },
  'settings-security-privacy/data-privacy-connections.png': { x: 448, y: 64, width: 2432, height: 1736 },

  // troubleshooting
  'troubleshooting/index-overview.png': { x: 0, y: 0, width: 2850, height: 3790 },
  'troubleshooting/sign-in-problems-error-state.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'troubleshooting/transaction-import-problems-error-state.png': { x: 0, y: 0, width: 2880, height: 2262 },
  'troubleshooting/budget-setup-problems-incomplete.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'troubleshooting/portfolio-import-problems-error-state.png': { x: 0, y: 0, width: 2880, height: 1800 },

  // goals-loans
  'goals-loans/index-overview.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'goals-loans/create-fund-goal-dialog.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'goals-loans/create-fund-goal-debt-paydown.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'goals-loans/link-accounts-goals-link-account.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'goals-loans/link-accounts-goals-linked.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'goals-loans/loans-overview-empty.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'goals-loans/loans-overview-list.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'goals-loans/add-loan-credit-facility-drawer.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'goals-loans/track-repayments-detail.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'goals-loans/track-repayments-link-repayment.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'goals-loans/archived-and-restore-archive-dialog.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'goals-loans/archived-and-restore-archived-list.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'goals-loans/archived-and-restore-empty.png': { x: 0, y: 0, width: 2880, height: 1800 },
  'goals-loans/goal-priority-edit-form.png': { x: 0, y: 0, width: 2880, height: 1800 },
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
      .then(async () => {
        const outputSize = (await stat(outputPath)).size;
        const savedKb = Math.max(0, Math.round((sourceSize - outputSize) / 1024));
        console.log(`  cropped ${key} → ${bounds.width}x${bounds.height} (saved ${savedKb} KB)`);
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
