/**
 * Keep the bank setup guide's Enable Banking values in step with the ones the server hands out.
 *
 * The web setup wizard copies the Control Panel values from `GET /v1/instance`, whose defaults
 * live in `packages/shared/lib/enable-banking/defaults.json`. The guide tells people what those values are on
 * wonder.money, and a person types them into Enable Banking's form, where a wrong Privacy or
 * Terms URL makes a Production application silently refuse to submit. So every locale's guide
 * must quote, in inline code, the default Privacy URL, the default Terms URL and wonder.money's
 * Redirect URL. Other URLs in the guide are fine.
 *
 *   node scripts/check-enable-banking-values.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const defaults = JSON.parse(
  readFileSync(join(root, '..', '..', 'packages', 'shared', 'lib', 'enable-banking', 'defaults.json'), 'utf8'),
);
const LOCALES = ['en', 'pt', 'es'];
/** The hosted instance's API, whose Redirect URL the guide quotes as the example. */
const HOSTED_API_URL = 'https://api.wonder.money';

const expected = {
  'Privacy URL': defaults.privacyUrl,
  'Terms URL': defaults.termsUrl,
  'Redirect URL': `${HOSTED_API_URL}${defaults.callbackPath}`,
};

const failures = [];
for (const locale of LOCALES) {
  const file = join('content', 'docs', locale, 'start-here', 'connect-first-bank-account.mdx');
  const quoted = new Set([...readFileSync(join(root, file), 'utf8').matchAll(/`([^`\s]+)`/gu)].map((match) => match[1]));
  for (const [field, value] of Object.entries(expected)) {
    if (!quoted.has(value)) failures.push(`${file}: does not quote the ${field} \`${value}\``);
  }
}

if (failures.length > 0) {
  console.error('The bank setup guide no longer matches the Enable Banking values the server hands out:');
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error('Fix the guide, or packages/shared/lib/enable-banking/defaults.json, so the two agree.');
  process.exit(1);
}
console.log(`Enable Banking values: the guide quotes them in ${LOCALES.join(', ')}.`);
