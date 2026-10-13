import { readdir } from 'node:fs/promises';

const sourceDirectory = new URL('../src/database/migrations/', import.meta.url);
const bundleDirectory = new URL('../dist/database/migrations/', import.meta.url);
const sourcePattern = /^Migration\d+\.ts$/;
const bundlePattern = /^Migration\d+\.js$/;

const sourceMigrations = (await readdir(sourceDirectory)).filter((file) => sourcePattern.test(file));
const bundledMigrations = new Set((await readdir(bundleDirectory)).filter((file) => bundlePattern.test(file)));
const missingMigrations = sourceMigrations
  .map((file) => file.replace(/\.ts$/, '.js'))
  .filter((file) => !bundledMigrations.has(file));

if (sourceMigrations.length === 0) {
  throw new Error('No source migrations were found');
}

if (missingMigrations.length > 0) {
  throw new Error(`Migration bundle is incomplete: ${missingMigrations.join(', ')}`);
}

console.log(`Verified ${sourceMigrations.length} bundled migrations`);
