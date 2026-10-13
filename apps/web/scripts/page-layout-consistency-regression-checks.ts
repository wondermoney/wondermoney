import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

const primitiveFiles = [
  "components/layout/PageShell.tsx",
  "components/layout/PageHeader.tsx",
  "components/layout/SectionHeader.tsx",
];

for (const file of primitiveFiles) {
  assert(existsSync(join(root, file)), `${file} must exist`);
}

function read(relativePath: string) {
  return readFileSync(join(root, relativePath), "utf8");
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

const targets = [
  "app/[locale]/(full-layout)/home-client.tsx",
  "app/[locale]/(full-layout)/reports/page.tsx",
];

for (const target of targets) {
  const source = read(target);

  assert(
    source.includes('import { PageShell } from "@/components/layout/PageShell"'),
    `${target} must import PageShell`,
  );

  assert(
    source.includes('import { PageHeader } from "@/components/layout/PageHeader"'),
    `${target} must import PageHeader`,
  );

  assert(
    !source.includes("p-4 md:p-6 lg:p-8"),
    `${target} must not include page-level padding`,
  );

  assert(!source.includes('<Heading variant="h2"'), `${target} must not use Heading h2`);
}

console.log("Page layout consistency regression checks passed");
